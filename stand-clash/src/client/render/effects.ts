// Pooled visual effects. Everything is preallocated so combat never allocates per hit.
import * as THREE from 'three';
import type { Projectile } from '../../shared/sim';
import { knifeGeometry } from './models';

// ------------------------------------------------------------------ particles
const MAX_P = 2400;

class Particles {
  points: THREE.Points;
  private pos = new Float32Array(MAX_P * 3);
  private col = new Float32Array(MAX_P * 3);
  private size = new Float32Array(MAX_P);
  private alpha = new Float32Array(MAX_P);
  private vel = new Float32Array(MAX_P * 3);
  private life = new Float32Array(MAX_P);
  private maxLife = new Float32Array(MAX_P);
  private grav = new Float32Array(MAX_P);
  private size0 = new Float32Array(MAX_P);
  private next = 0;
  private geo: THREE.BufferGeometry;

  constructor(additive: boolean) {
    const g = (this.geo = new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA;
        void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0);
        gl_PointSize = size * (520.0 / max(-mv.z, 0.1)); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC; varying float vA;
        void main(){ vec2 q = abs(gl_PointCoord - 0.5); if (max(q.x,q.y) > 0.5) discard;
        float edge = max(q.x,q.y) > 0.38 ? 0.6 : 1.0; gl_FragColor = vec4(vC * edge, vA); }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: THREE.Color, size: number, life: number, gravity = 0) {
    const i = this.next;
    this.next = (this.next + 1) % MAX_P;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = color.r;
    this.col[i * 3 + 1] = color.g;
    this.col[i * 3 + 2] = color.b;
    this.size0[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = gravity;
  }

  update(dt: number, frozen: boolean) {
    for (let i = 0; i < MAX_P; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      if (!frozen) {
        this.life[i] -= dt;
        this.vel[i * 3 + 1] -= this.grav[i] * dt;
        const drag = Math.exp(-2.5 * dt);
        this.vel[i * 3] *= drag;
        this.vel[i * 3 + 2] *= drag;
        this.pos[i * 3] += this.vel[i * 3] * dt;
        this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
        this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      }
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      this.alpha[i] = Math.min(1, k * 1.6);
      this.size[i] = this.size0[i] * (0.4 + 0.6 * k);
    }
    for (const n of ['position', 'color', 'size', 'alpha']) (this.geo.attributes[n] as THREE.BufferAttribute).needsUpdate = true;
  }
}

// ------------------------------------------------------------------ canvas textures
function starburstTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const spikes = 14;
  const draw = (rOut: number, rIn: number, fill: string) => {
    g.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 ? rIn : rOut * (0.85 + ((i * 37) % 7) / 40);
      const a = (i / (spikes * 2)) * Math.PI * 2;
      g.lineTo(128 + Math.cos(a) * r, 128 + Math.sin(a) * r);
    }
    g.closePath();
    g.fillStyle = fill;
    g.fill();
  };
  g.lineJoin = 'miter';
  draw(124, 60, '#1a0d24');
  draw(112, 52, '#ffffff');
  draw(80, 38, '#ffe45c');
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glyphTexture(text: string, fill: string, stroke: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.font = '900 104px "Noto Sans JP", "Hiragino Kaku Gothic Pro", "Yu Gothic", "Meiryo", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 14;
  g.strokeStyle = stroke;
  g.strokeText(text, 64, 68);
  g.fillStyle = fill;
  g.fillText(text, 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function trailTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 128, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(0, 16);
  g.lineTo(128, 2);
  g.lineTo(128, 30);
  g.closePath();
  g.fill();
  return new THREE.CanvasTexture(c);
}

interface Pooled<T extends THREE.Object3D> {
  obj: T;
  t: number;
  life: number;
  active: boolean;
  data: Record<string, number>;
}

// ------------------------------------------------------------------ main FX manager
export class Effects {
  group = new THREE.Group();
  add = new Particles(true);
  dust = new Particles(false);
  private rings: Pooled<THREE.Mesh>[] = [];
  private bursts: Pooled<THREE.Sprite>[] = [];
  private trails: Pooled<THREE.Mesh>[] = [];
  private menace: Pooled<THREE.Sprite>[] = [];
  private knives: THREE.InstancedMesh;
  private bullets: THREE.InstancedMesh;
  private tsSphere: THREE.Mesh;
  private tsT = -1;
  private tsMode: 'in' | 'out' = 'in';
  private tsRadius = 38;
  private c = new THREE.Color();
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3();
  private nrm = new THREE.Vector3();
  frozenWorld = false;

  constructor(private camera: THREE.Camera) {
    this.group.add(this.add.points, this.dust.points);
    const ringGeo = new THREE.RingGeometry(0.85, 1, 40);
    for (let i = 0; i < 20; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.visible = false;
      this.group.add(m);
      this.rings.push({ obj: m, t: 0, life: 0, active: false, data: {} });
    }
    const starTex = starburstTexture();
    for (let i = 0; i < 14; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex, transparent: true, depthWrite: false, depthTest: true }));
      s.visible = false;
      s.renderOrder = 5;
      this.group.add(s);
      this.bursts.push({ obj: s, t: 0, life: 0, active: false, data: {} });
    }
    const trailGeo = new THREE.PlaneGeometry(1, 1);
    trailGeo.translate(-0.5, 0, 0);
    const tt = trailTexture();
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({ map: tt, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.visible = false;
      this.group.add(m);
      this.trails.push({ obj: m, t: 0, life: 0, active: false, data: {} });
    }
    const goTex = glyphTexture('ゴ', '#b14dff', '#1a0726');
    const goTex2 = glyphTexture('ド', '#ff4da6', '#1a0726');
    for (let i = 0; i < 28; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: i % 4 === 3 ? goTex2 : goTex, transparent: true, depthWrite: false }));
      s.visible = false;
      this.group.add(s);
      this.menace.push({ obj: s, t: 0, life: 0, active: false, data: {} });
    }
    const kmat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x555555 });
    this.knives = new THREE.InstancedMesh(knifeGeometry(), kmat, 96);
    this.knives.count = 0;
    this.knives.frustumCulled = false;
    this.group.add(this.knives);
    this.bullets = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.12, 0.5), new THREE.MeshBasicMaterial({ color: 0xffd23f }), 48);
    this.bullets.count = 0;
    this.bullets.frustumCulled = false;
    this.group.add(this.bullets);
    this.tsSphere = new THREE.Mesh(
      new THREE.SphereGeometry(1, 48, 24),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: { col: { value: new THREE.Color(0x9b7bff) }, alpha: { value: 1 } },
        vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
        fragmentShader: `uniform vec3 col; uniform float alpha; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.5); gl_FragColor = vec4(col * (0.25 + f*1.6), (0.12 + f) * alpha); }`,
      }),
    );
    this.tsSphere.visible = false;
    this.tsSphere.renderOrder = 4;
    this.group.add(this.tsSphere);
  }

  private take<T extends THREE.Object3D>(pool: Pooled<T>[]): Pooled<T> {
    let best = pool[0];
    for (const p of pool) {
      if (!p.active) return p;
      if (p.t / p.life > best.t / best.life) best = p;
    }
    return best;
  }

  /** Make every pooled object renderable so the renderer can pre-compile all effect shaders. */
  setWarm(on: boolean) {
    const all: THREE.Object3D[] = [...this.rings.map((r) => r.obj), ...this.bursts.map((b) => b.obj), ...this.trails.map((t) => t.obj), ...this.menace.map((m) => m.obj), this.tsSphere];
    for (const o of all) o.visible = on;
    this.knives.count = on ? 1 : 0;
    this.bullets.count = on ? 1 : 0;
    if (!on) {
      for (const p of [...this.rings, ...this.bursts, ...this.trails, ...this.menace]) p.active = false;
      this.tsT = -1;
    }
  }

  // ---------------------------------------------------------------- spawners
  sparks(pos: THREE.Vector3, color: number, n = 14, speed = 9, size = 0.18) {
    this.c.setHex(color);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const b = Math.random() * Math.PI - Math.PI / 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.add.spawn(pos.x, pos.y, pos.z, Math.cos(a) * Math.cos(b) * s, Math.sin(b) * s + 2, Math.sin(a) * Math.cos(b) * s, this.c, size * (0.6 + Math.random()), 0.25 + Math.random() * 0.25, 12);
    }
  }

  dustPuff(pos: THREE.Vector3, n = 10, spread = 4, color = 0xd8cfc0) {
    this.c.setHex(color);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = spread * (0.5 + Math.random() * 0.5);
      this.dust.spawn(pos.x, pos.y + 0.1, pos.z, Math.cos(a) * s, 0.5 + Math.random() * 1.5, Math.sin(a) * s, this.c, 0.35 + Math.random() * 0.25, 0.4 + Math.random() * 0.3, -1);
    }
  }

  aura(pos: THREE.Vector3, color: number, radius = 0.6, height = 1.9, n = 1) {
    this.c.setHex(color);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = radius * (0.5 + Math.random() * 0.6);
      this.add.spawn(pos.x + Math.cos(a) * r, pos.y + Math.random() * height, pos.z + Math.sin(a) * r, 0, 1.6 + Math.random() * 1.6, 0, this.c, 0.1 + Math.random() * 0.12, 0.5 + Math.random() * 0.4, -1.5);
    }
  }

  ring(pos: THREE.Vector3, color: number, from = 0.3, to = 2.4, life = 0.3, flat = false) {
    const r = this.take(this.rings);
    r.active = true;
    r.t = 0;
    r.life = life;
    r.data = { from, to, flat: flat ? 1 : 0 };
    r.obj.position.copy(pos);
    (r.obj.material as THREE.MeshBasicMaterial).color.setHex(color);
    r.obj.visible = true;
    if (flat) r.obj.rotation.set(-Math.PI / 2, 0, 0);
  }

  burst(pos: THREE.Vector3, size = 1.4, life = 0.16) {
    const b = this.take(this.bursts);
    b.active = true;
    b.t = 0;
    b.life = life;
    b.data = { size };
    b.obj.position.copy(pos);
    b.obj.material.rotation = Math.random() * Math.PI;
    b.obj.visible = true;
  }

  trail(from: THREE.Vector3, to: THREE.Vector3, color: number, width = 0.5, life = 0.14) {
    const t = this.take(this.trails);
    t.active = true;
    t.t = 0;
    t.life = life;
    t.data = { w: width };
    const m = t.obj;
    m.position.copy(to);
    this.v.subVectors(to, from);
    const len = this.v.length();
    m.scale.set(len, width, 1);
    // orient plane's +X along the trail direction and face the camera as much as possible
    const dir = this.v.normalize();
    const camDir = this.s.subVectors(this.camera.position, to).normalize();
    const up = this.up.crossVectors(dir, camDir).normalize();
    const nrm = this.nrm.crossVectors(dir, up).normalize();
    this.m4.makeBasis(dir, up, nrm);
    m.quaternion.setFromRotationMatrix(this.m4);
    (m.material as THREE.MeshBasicMaterial).color.setHex(color);
    m.visible = true;
  }

  menacing(pos: THREE.Vector3, n = 3, spread = 1.6) {
    for (let i = 0; i < n; i++) {
      const s = this.take(this.menace);
      s.active = true;
      s.t = 0;
      s.life = 1.4 + Math.random() * 0.6;
      s.data = { x: pos.x + (Math.random() - 0.5) * spread * 2, y: pos.y + Math.random() * 1.6, z: pos.z + (Math.random() - 0.5) * spread * 2, ph: Math.random() * 6, sz: 0.55 + Math.random() * 0.35 };
      s.obj.visible = true;
    }
  }

  timeStopWave(center: THREE.Vector3, color: number, radius: number, mode: 'in' | 'out') {
    this.tsSphere.position.copy(center);
    ((this.tsSphere.material as THREE.ShaderMaterial).uniforms.col.value as THREE.Color).setHex(color);
    this.tsT = 0;
    this.tsMode = mode;
    this.tsRadius = radius;
    this.tsSphere.visible = true;
  }

  // ---------------------------------------------------------------- per frame
  update(dt: number, projectiles: Projectile[]) {
    this.add.update(dt, false);
    this.dust.update(dt, this.frozenWorld);
    for (const r of this.rings) {
      if (!r.active) continue;
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) {
        r.active = false;
        r.obj.visible = false;
        continue;
      }
      const e = 1 - Math.pow(1 - k, 3);
      r.obj.scale.setScalar(r.data.from + (r.data.to - r.data.from) * e);
      if (!r.data.flat) r.obj.quaternion.copy(this.camera.quaternion);
      (r.obj.material as THREE.MeshBasicMaterial).opacity = 1 - k;
    }
    for (const b of this.bursts) {
      if (!b.active) continue;
      b.t += dt;
      const k = b.t / b.life;
      if (k >= 1) {
        b.active = false;
        b.obj.visible = false;
        continue;
      }
      const s = b.data.size * (k < 0.3 ? 0.6 + k * 1.6 : 1.08 - (k - 0.3) * 0.4);
      b.obj.scale.set(s, s, 1);
      b.obj.material.opacity = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
    }
    for (const t of this.trails) {
      if (!t.active) continue;
      t.t += dt;
      const k = t.t / t.life;
      if (k >= 1) {
        t.active = false;
        t.obj.visible = false;
        continue;
      }
      (t.obj.material as THREE.MeshBasicMaterial).opacity = 1 - k;
      t.obj.scale.y = t.data.w * (1 - k * 0.6);
    }
    for (const m of this.menace) {
      if (!m.active) continue;
      m.t += dt;
      const k = m.t / m.life;
      if (k >= 1) {
        m.active = false;
        m.obj.visible = false;
        continue;
      }
      const d = m.data;
      const wob = Math.sin(m.t * 9 + d.ph) * 0.08;
      m.obj.position.set(d.x + wob, d.y + m.t * 0.7, d.z);
      const pulse = d.sz * (1 + Math.sin(m.t * 14 + d.ph) * 0.08) * (k < 0.15 ? k / 0.15 : 1);
      m.obj.scale.set(pulse, pulse, 1);
      m.obj.material.rotation = Math.sin(m.t * 5 + d.ph) * 0.15;
      m.obj.material.opacity = k > 0.75 ? (1 - k) / 0.25 : 1;
    }
    if (this.tsT >= 0) {
      this.tsT += dt;
      const dur = this.tsMode === 'in' ? 1.1 : 0.7;
      const k = this.tsT / dur;
      if (k >= 1) {
        this.tsT = -1;
        this.tsSphere.visible = false;
      } else {
        const mat = this.tsSphere.material as THREE.ShaderMaterial;
        const r = this.tsMode === 'in' ? this.tsRadius * Math.sin(k * Math.PI) : this.tsRadius * (1 - k);
        this.tsSphere.scale.setScalar(Math.max(0.1, r));
        mat.uniforms.alpha.value = this.tsMode === 'in' ? 1 - k * 0.6 : 1 - k;
      }
    }
    // projectiles
    let kn = 0;
    let bn = 0;
    for (const p of projectiles) {
      this.v.set(p.pos.x, p.pos.y, p.pos.z);
      const sp = Math.hypot(p.vel.x, p.vel.y, p.vel.z);
      if (sp > 0.01) {
        this.e.set(-Math.asin(Math.max(-1, Math.min(1, p.vel.y / sp))), Math.atan2(p.vel.x, p.vel.z), 0, 'YXZ');
        this.q.setFromEuler(this.e);
      }
      if (p.kind === 'knife' && kn < 96) {
        this.m4.compose(this.v, this.q, this.s.set(1.8, 1.8, 1.8));
        this.knives.setMatrixAt(kn++, this.m4);
        if (!p.frozen && !p.stuck && Math.random() < 0.5) this.add.spawn(p.pos.x, p.pos.y, p.pos.z, 0, 0, 0, this.c.setHex(0xfff0a0), 0.1, 0.12);
        // knives hanging in stopped time glint gold
        if (p.frozen && Math.random() < 0.12) this.add.spawn(p.pos.x, p.pos.y, p.pos.z, 0, 0.3, 0, this.c.setHex(0xffd23f), 0.16, 0.35);
      } else if (p.kind === 'bullet' && bn < 48) {
        this.m4.compose(this.v, this.q, this.s.set(1, 1, 1));
        this.bullets.setMatrixAt(bn++, this.m4);
        if (!p.frozen) this.add.spawn(p.pos.x, p.pos.y, p.pos.z, 0, 0, 0, this.c.setHex(0xffa000), 0.12, 0.1);
      }
    }
    this.knives.count = kn;
    this.bullets.count = bn;
    this.knives.instanceMatrix.needsUpdate = true;
    this.bullets.instanceMatrix.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ 2D overlay: speed lines + flashes
export class ScreenFX {
  private ctx: CanvasRenderingContext2D;
  private speed = 0;
  private flash = 0;
  private flashColor = '255,255,255';
  private focus = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    const resize = () => {
      canvas.width = Math.floor(window.innerWidth / 2);
      canvas.height = Math.floor(window.innerHeight / 2);
    };
    resize();
    window.addEventListener('resize', resize);
  }

  speedLines(amount: number) {
    this.speed = Math.max(this.speed, amount);
  }
  focusLines(amount: number) {
    this.focus = Math.max(this.focus, amount);
  }
  doFlash(amount: number, rgb = '255,255,255') {
    this.flash = Math.max(this.flash, amount);
    this.flashColor = rgb;
  }

  update(dt: number) {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const amt = Math.max(this.speed, this.focus);
    if (amt > 0.02) {
      const cx = w / 2;
      const cy = h / 2;
      const n = Math.floor(30 + amt * 50);
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.55, amt * 0.6)})`;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const r0 = Math.max(w, h) * (0.32 + Math.random() * 0.2 + (1 - amt) * 0.15);
        const r1 = Math.max(w, h) * 0.75;
        const wd = 0.006 + Math.random() * 0.01;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        ctx.lineTo(cx + Math.cos(a - wd) * r1, cy + Math.sin(a - wd) * r1);
        ctx.lineTo(cx + Math.cos(a + wd) * r1, cy + Math.sin(a + wd) * r1);
        ctx.closePath();
        ctx.fill();
      }
      if (this.focus > 0.02) {
        ctx.fillStyle = `rgba(20,0,30,${this.focus * 0.35})`;
        for (let i = 0; i < 24; i++) {
          const a = Math.random() * Math.PI * 2;
          const r0 = Math.max(w, h) * (0.42 + Math.random() * 0.1);
          const r1 = Math.max(w, h) * 0.75;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
          ctx.lineTo(cx + Math.cos(a - 0.012) * r1, cy + Math.sin(a - 0.012) * r1);
          ctx.lineTo(cx + Math.cos(a + 0.012) * r1, cy + Math.sin(a + 0.012) * r1);
          ctx.fill();
        }
      }
    }
    if (this.flash > 0.01) {
      ctx.fillStyle = `rgba(${this.flashColor},${Math.min(0.6, this.flash)})`;
      ctx.fillRect(0, 0, w, h);
    }
    this.speed = Math.max(0, this.speed - dt * 3.5);
    this.focus = Math.max(0, this.focus - dt * 2.5);
    this.flash = Math.max(0, this.flash - dt * 4);
  }
}

// ------------------------------------------------------------------ DOM damage numbers / floating shouts
export class FloatText {
  private pool: { el: HTMLDivElement; t: number; life: number; pos: THREE.Vector3; vy: number; active: boolean; dx: number }[] = [];
  private v = new THREE.Vector3();

  constructor(private root: HTMLElement, private camera: THREE.Camera) {
    for (let i = 0; i < 48; i++) {
      const el = document.createElement('div');
      el.className = 'float-text';
      el.style.display = 'none';
      root.appendChild(el);
      this.pool.push({ el, t: 0, life: 1, pos: new THREE.Vector3(), vy: 0, active: false, dx: 0 });
    }
  }

  spawn(pos: THREE.Vector3, text: string, cls: string, life = 0.9, vy = 1.4) {
    let p = this.pool.find((x) => !x.active);
    if (!p) p = this.pool.reduce((a, b) => (a.t / a.life > b.t / b.life ? a : b));
    p.active = true;
    p.t = 0;
    p.life = life;
    p.pos.copy(pos);
    p.vy = vy;
    p.dx = (Math.random() - 0.5) * 30;
    p.el.className = 'float-text ' + cls;
    p.el.textContent = text;
    p.el.style.display = 'block';
  }

  update(dt: number) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const p of this.pool) {
      if (!p.active) continue;
      p.t += dt;
      if (p.t >= p.life) {
        p.active = false;
        p.el.style.display = 'none';
        continue;
      }
      p.pos.y += p.vy * dt;
      this.v.copy(p.pos).project(this.camera);
      if (this.v.z > 1) {
        p.el.style.display = 'none';
        continue;
      }
      p.el.style.display = 'block';
      const k = p.t / p.life;
      const x = (this.v.x * 0.5 + 0.5) * w + p.dx * k;
      const y = (-this.v.y * 0.5 + 0.5) * h;
      const sc = k < 0.12 ? 0.5 + (k / 0.12) * 0.8 : 1.3 - Math.min(0.3, (k - 0.12) * 0.6);
      p.el.style.transform = `translate(-50%,-50%) translate(${x.toFixed(1)}px,${y.toFixed(1)}px) scale(${sc.toFixed(3)})`;
      p.el.style.opacity = k > 0.7 ? ((1 - k) / 0.3).toFixed(3) : '1';
    }
  }
}
