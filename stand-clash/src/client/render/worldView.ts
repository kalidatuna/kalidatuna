// Builds the town meshes from the shared layout using instancing (one draw call per material kind).
import * as THREE from 'three';
import { World, WBox, MatKind, Sign } from '../../shared/world';

/** 16x16 pixel noise texture that gives every surface a Minecraft-like grain. */
function pixelTexture(): THREE.DataTexture {
  const n = 16;
  const data = new Uint8Array(n * n * 4);
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n * n; i++) {
    const v = 205 + Math.floor(r() * 50);
    const edge = i % n === 0 || Math.floor(i / n) === 0 ? 0.88 : 1;
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = Math.floor(v * edge);
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, n, n);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapLinearFilter;
  t.generateMipmaps = true;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

/** Lambert material that samples the pixel texture with world-space (triplanar-ish) UVs. */
export function blockMaterial(tex: THREE.Texture, texScale: number, opts: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ ...opts });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.pixTex = { value: tex };
    sh.uniforms.texScale = { value: texScale };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 wp4 = vec4(transformed, 1.0);
        vec3 wn = objectNormal;
        #ifdef USE_INSTANCING
          wp4 = instanceMatrix * wp4;
          wn = mat3(instanceMatrix) * wn;
        #endif
        vWP = (modelMatrix * wp4).xyz;
        vWN = normalize(mat3(modelMatrix) * wn);`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;\nuniform sampler2D pixTex;\nuniform float texScale;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 an = abs(vWN);
        vec2 puv = an.y > 0.5 ? vWP.xz : (an.x > an.z ? vWP.zy : vWP.xy);
        float px = texture2D(pixTex, puv * texScale).r;
        diffuseColor.rgb *= px * 1.12;`,
      );
  };
  return m;
}

function signTexture(s: Sign): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  const aspect = s.w / s.h;
  c.height = 128;
  c.width = Math.min(1024, Math.round(128 * aspect));
  const g = c.getContext('2d')!;
  if (s.text === '@clock') {
    c.width = 256;
    c.height = 256;
    g.fillStyle = s.bg;
    g.beginPath();
    g.arc(128, 128, 120, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 12;
    g.strokeStyle = '#333';
    g.stroke();
    g.fillStyle = '#222';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.fillRect(128 + Math.sin(a) * 96 - 6, 128 - Math.cos(a) * 96 - 6, 12, 12);
    }
    g.lineCap = 'round';
    g.lineWidth = 10;
    g.beginPath();
    g.moveTo(128, 128);
    g.lineTo(128 + 50, 128 - 30);
    g.stroke();
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(128, 128);
    g.lineTo(128 - 10, 128 - 85);
    g.stroke();
  } else {
    g.fillStyle = s.bg;
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 10;
    g.strokeRect(5, 5, c.width - 10, c.height - 10);
    g.fillStyle = s.fg;
    g.font = `900 ${Math.min(84, (c.width / s.text.length) * 1.5)}px Impact, "Arial Black", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 6;
    g.strokeStyle = '#000';
    g.strokeText(s.text, c.width / 2, c.height / 2 + 4);
    g.fillText(s.text, c.width / 2, c.height / 2 + 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class WorldView {
  group = new THREE.Group();
  lampMat: THREE.MeshBasicMaterial;
  waterMat: THREE.MeshLambertMaterial;
  private t = 0;

  constructor(world: World) {
    const tex = pixelTexture();
    const unit = new THREE.BoxGeometry(1, 1, 1);
    unit.translate(0, 0.5, 0);
    const mats: Record<MatKind, THREE.Material> = {
      wall: blockMaterial(tex, 0.5),
      roof: blockMaterial(tex, 1),
      stone: blockMaterial(tex, 0.7),
      wood: blockMaterial(tex, 1.5),
      leaf: blockMaterial(tex, 1.2),
      glass: new THREE.MeshLambertMaterial({ emissive: 0x111822 }),
      metal: blockMaterial(tex, 1.5),
      road: blockMaterial(tex, 0.25),
      lamp: new THREE.MeshBasicMaterial({ color: 0xfff2b0 }),
      water: new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.82, emissive: 0x0a2a44 }),
      grass: blockMaterial(tex, 0.35),
      trim: blockMaterial(tex, 1),
      cloth: blockMaterial(tex, 1),
      paint: new THREE.MeshBasicMaterial({ color: 0xf5f0d0 }),
    };
    this.lampMat = mats.lamp as THREE.MeshBasicMaterial;
    this.waterMat = mats.water as THREE.MeshLambertMaterial;
    const groups = new Map<MatKind, WBox[]>();
    for (const b of world.boxes) {
      let arr = groups.get(b.mat);
      if (!arr) groups.set(b.mat, (arr = []));
      arr.push(b);
    }
    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();
    const outlined: WBox[] = [];
    for (const [kind, list] of groups) {
      const mesh = new THREE.InstancedMesh(unit, mats[kind], list.length);
      list.forEach((b, i) => {
        const sx = b.max.x - b.min.x;
        const sy = b.max.y - b.min.y;
        const sz = b.max.z - b.min.z;
        m4.makeScale(sx, sy, sz).setPosition((b.min.x + b.max.x) / 2, b.min.y, (b.min.z + b.max.z) / 2);
        mesh.setMatrixAt(i, m4);
        col.setHex(b.color);
        mesh.setColorAt(i, col);
        if (b.outline) outlined.push(b);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      const big = kind === 'grass' || kind === 'road' || kind === 'water' || kind === 'paint';
      mesh.castShadow = !big && kind !== 'glass' && kind !== 'lamp';
      mesh.receiveShadow = kind !== 'lamp';
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    // Inverted-hull comic outlines for buildings and big props
    const outlineMat = new THREE.MeshBasicMaterial({ color: 0x1a1020, side: THREE.BackSide });
    const om = new THREE.InstancedMesh(unit, outlineMat, outlined.length);
    const T = 0.07;
    outlined.forEach((b, i) => {
      const sx = b.max.x - b.min.x + T * 2;
      const sy = b.max.y - b.min.y + T * 2;
      const sz = b.max.z - b.min.z + T * 2;
      m4.makeScale(sx, sy, sz).setPosition((b.min.x + b.max.x) / 2, b.min.y - T, (b.min.z + b.max.z) / 2);
      om.setMatrixAt(i, m4);
    });
    om.instanceMatrix.needsUpdate = true;
    om.frustumCulled = false;
    this.group.add(om);

    // Signs
    for (const s of world.signs) {
      const tex2 = signTexture(s);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), new THREE.MeshBasicMaterial({ map: tex2 }));
      mesh.position.set(s.pos.x, s.pos.y, s.pos.z);
      mesh.rotation.y = s.yaw;
      this.group.add(mesh);
      const back = new THREE.Mesh(new THREE.BoxGeometry(s.w + 0.2, s.h + 0.2, 0.15), new THREE.MeshLambertMaterial({ color: 0x222222 }));
      back.position.copy(mesh.position);
      back.rotation.y = s.yaw;
      back.translateZ(-0.09);
      this.group.add(back);
    }
  }

  update(dt: number) {
    this.t += dt;
    this.waterMat.emissive.setHSL(0.56, 0.6, 0.12 + Math.sin(this.t * 1.5) * 0.03);
  }
}

/** Gradient sky dome with a stylised sun. */
export function makeSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(600, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x3a2a8c) },
      mid: { value: new THREE.Color(0xd96aa7) },
      bottom: { value: new THREE.Color(0xffc27a) },
      sunDir: { value: new THREE.Vector3(0.4, 0.35, 0.85).normalize() },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; uniform vec3 sunDir; varying vec3 vDir;
      void main(){
        float h = vDir.y;
        vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.7, h)) : mix(bottom, mid, smoothstep(-0.1, 0.12, h));
        float s = max(dot(vDir, sunDir), 0.0);
        c += vec3(1.0, 0.85, 0.5) * pow(s, 300.0) * 2.0 + vec3(1.0,0.6,0.4) * pow(s, 8.0) * 0.35;
        // blocky clouds
        vec2 q = floor(vDir.xz / max(h, 0.08) * 6.0);
        float n = fract(sin(dot(q, vec2(12.9898, 78.233))) * 43758.5453);
        if (h > 0.08 && n > 0.86) c = mix(c, vec3(1.0, 0.92, 0.95), 0.55 * smoothstep(0.08, 0.3, h));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  m.renderOrder = -10;
  return m;
}
