// Lumora's custom 3D models. Every model is built procedurally from geometry
// (no downloaded assets), so they're tiny, crisp at any resolution and themeable.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export type Updater = (t: number, hover: number) => void;
export type ModelFactory = (color: THREE.Color) => THREE.Group;

const GOLD = new THREE.Color('#ffc861');
const CREAM = new THREE.Color('#fff4e0');
const INK = new THREE.Color('#1b1640');

// ---------- materials ----------
export function glossy(color: THREE.Color | string, opts: Partial<THREE.MeshPhysicalMaterialParameters> = {}) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.22,
    metalness: 0.05,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    iridescence: 0.35,
    iridescenceIOR: 1.4,
    sheen: 0.4,
    sheenColor: new THREE.Color('#ffffff'),
    ...opts,
  });
}
export function metal(color: THREE.Color | string, roughness = 0.28) {
  return new THREE.MeshPhysicalMaterial({ color, metalness: 0.92, roughness, clearcoat: 0.6, clearcoatRoughness: 0.2 });
}
export function glow(color: THREE.Color | string, intensity = 1.6) {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
}
function additive(color: THREE.Color | string, opacity = 0.6) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
}
const lighten = (c: THREE.Color, amt: number) => c.clone().lerp(new THREE.Color('#ffffff'), amt);
const darken = (c: THREE.Color, amt: number) => c.clone().lerp(INK, amt);

function extrude(shape: THREE.Shape, depth: number, bevel = 0.06, segments = 4) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: segments,
    curveSegments: 24,
  });
  g.center();
  return g;
}

function group(update?: Updater, ...children: THREE.Object3D[]) {
  const g = new THREE.Group();
  children.forEach((c) => g.add(c));
  if (update) g.userData.update = update;
  return g;
}

// ---------- shapes ----------
export function gearShape(teeth: number, rOuter: number, rRoot: number, rHole: number) {
  const s = new THREE.Shape();
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const pts: [number, number][] = [
      [rRoot, a],
      [rOuter, a + step * 0.18],
      [rOuter, a + step * 0.48],
      [rRoot, a + step * 0.66],
    ];
    pts.forEach(([r, ang], j) => {
      const x = Math.cos(ang) * r;
      const y = Math.sin(ang) * r;
      if (i === 0 && j === 0) s.moveTo(x, y);
      else s.lineTo(x, y);
    });
  }
  s.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, rHole, 0, Math.PI * 2, true);
  s.holes.push(hole);
  return s;
}

export function shieldShape(scale = 1) {
  const s = new THREE.Shape();
  const k = scale;
  s.moveTo(0, 0.95 * k);
  s.bezierCurveTo(0.35 * k, 0.95 * k, 0.6 * k, 0.86 * k, 0.76 * k, 0.74 * k);
  s.bezierCurveTo(0.78 * k, 0.1 * k, 0.56 * k, -0.56 * k, 0, -0.98 * k);
  s.bezierCurveTo(-0.56 * k, -0.56 * k, -0.78 * k, 0.1 * k, -0.76 * k, 0.74 * k);
  s.bezierCurveTo(-0.6 * k, 0.86 * k, -0.35 * k, 0.95 * k, 0, 0.95 * k);
  return s;
}

function checkShape() {
  const s = new THREE.Shape();
  const p: [number, number][] = [[-0.34, 0.04], [-0.12, -0.2], [0.36, 0.3], [0.26, 0.4], [-0.12, 0.0], [-0.24, 0.14]];
  p.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  return s;
}

export function bubbleShape(w = 1.6, h = 1.1, r = 0.34) {
  const x = -w / 2;
  const y = -h / 2;
  const s = new THREE.Shape();
  s.moveTo(x + r, y);
  s.lineTo(x + 0.44, y);
  s.lineTo(x + 0.16, y - 0.4);
  s.lineTo(x + 0.76, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

export function sparkleShape(inner = 0.14) {
  const s = new THREE.Shape();
  s.moveTo(0, 1);
  s.quadraticCurveTo(inner, inner, 1, 0);
  s.quadraticCurveTo(inner, -inner, 0, -1);
  s.quadraticCurveTo(-inner, -inner, -1, 0);
  s.quadraticCurveTo(-inner, inner, 0, 1);
  return s;
}

function arrowShape() {
  const s = new THREE.Shape();
  const p: [number, number][] = [[-0.08, -0.6], [0.08, -0.6], [0.08, 0.2], [0.24, 0.2], [0, 0.6], [-0.24, 0.2], [-0.08, 0.2]];
  p.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  return s;
}

// ---------- module models ----------

/** Foundations: a crystalline neural core inside a wire lattice with orbiting signals. */
export const orb: ModelFactory = (color) => {
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 1), glossy(color, { flatShading: true, roughness: 0.12 }));
  const latticeGeo = new THREE.IcosahedronGeometry(1.02, 1);
  const lattice = new THREE.LineSegments(new THREE.EdgesGeometry(latticeGeo), new THREE.LineBasicMaterial({ color: lighten(color, 0.5), transparent: true, opacity: 0.55 }));
  const nodes = new THREE.Group();
  const nodeGeo = new THREE.SphereGeometry(0.045, 12, 12);
  const nodeMat = glow(lighten(color, 0.6), 2.2);
  const pos = latticeGeo.getAttribute('position');
  const seen = new Set<string>();
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    const key = v.toArray().map((n) => n.toFixed(2)).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    const n = new THREE.Mesh(nodeGeo, nodeMat);
    n.position.copy(v);
    nodes.add(n);
  }
  const ringMat = additive(lighten(color, 0.3), 0.7);
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(1.28, 0.012, 8, 128), ringMat);
  const ring2 = ring1.clone();
  ring1.rotation.x = Math.PI / 2.6;
  ring2.rotation.set(Math.PI / 3, Math.PI / 4, 0);
  const signal = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 16), glow(GOLD, 2.5));
  const signal2 = signal.clone();
  const spin = new THREE.Group();
  spin.add(lattice, nodes);
  const g = group((t, hover) => {
    core.rotation.set(t * 0.4, t * 0.6, 0);
    spin.rotation.y = t * (0.25 + hover * 0.6);
    spin.rotation.x = Math.sin(t * 0.3) * 0.2;
    const a = t * 1.6;
    signal.position.set(Math.cos(a) * 1.28, 0, Math.sin(a) * 1.28).applyEuler(ring1.rotation);
    signal2.position.set(Math.cos(-a * 0.8) * 1.28, Math.sin(-a * 0.8) * 1.28, 0).applyEuler(new THREE.Euler(Math.PI / 3 - Math.PI / 2, Math.PI / 4, 0));
  }, core, spin, ring1, ring2, signal, signal2);
  g.userData.fit = 1.4;
  return g;
};

/** Prompting: a glossy speech bubble with a typing indicator and a reply bubble. */
export const bubble: ModelFactory = (color) => {
  const main = new THREE.Mesh(extrude(bubbleShape(), 0.28, 0.09), glossy(color));
  const dots = [0, 1, 2].map((i) => {
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 24), glossy(CREAM, { iridescence: 0 }));
    d.position.set((i - 1) * 0.38, 0.05, 0.25);
    return d;
  });
  const reply = new THREE.Mesh(extrude(bubbleShape(1.0, 0.66, 0.24), 0.2, 0.07), glossy(lighten(color, 0.55)));
  reply.scale.x = -1;
  reply.position.set(0.62, 0.78, -0.45);
  const front = group(undefined, main, ...dots);
  return group((t, hover) => {
    dots.forEach((d, i) => (d.position.y = 0.05 + Math.max(0, Math.sin(t * 5 - i * 0.7)) * 0.14));
    front.rotation.y = Math.sin(t * 0.7) * 0.35 + hover * 0.3;
    front.rotation.x = Math.sin(t * 0.5) * 0.08;
    reply.position.y = 0.78 + Math.sin(t * 1.2) * 0.06;
    reply.rotation.y = Math.sin(t * 0.7 + 1) * 0.3;
  }, front, reply);
};

/** Everyday life: a cosy little house with glowing windows and an orbiting sun. */
export const home: ModelFactory = (color) => {
  const body = new THREE.Mesh(new RoundedBoxGeometry(1.2, 0.85, 1.0, 4, 0.06), glossy(CREAM, { iridescence: 0 }));
  body.position.y = -0.25;
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-0.78, 0);
  roofShape.lineTo(0, 0.62);
  roofShape.lineTo(0.78, 0);
  roofShape.closePath();
  const roof = new THREE.Mesh(extrude(roofShape, 1.15, 0.05), glossy(color));
  roof.position.y = 0.42;
  const chimney = new THREE.Mesh(new RoundedBoxGeometry(0.18, 0.4, 0.18, 2, 0.03), glossy(darken(color, 0.2)));
  chimney.position.set(0.36, 0.62, -0.2);
  const door = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.42, 0.06, 2, 0.03), glossy(darken(color, 0.35)));
  door.position.set(0, -0.46, 0.5);
  const winMat = glow(new THREE.Color('#ffd27a'), 1.8);
  const w1 = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.22, 0.05, 2, 0.02), winMat);
  w1.position.set(-0.34, -0.15, 0.5);
  const w2 = w1.clone();
  w2.position.x = 0.34;
  const sun = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 24), glow(GOLD, 2));
  const house = group(undefined, body, roof, chimney, door, w1, w2);
  return group((t, hover) => {
    house.rotation.y = Math.sin(t * 0.5) * 0.5 + hover * 0.4 - 0.3;
    sun.position.set(Math.cos(t * 0.8) * 1.15, 0.7 + Math.sin(t * 0.8) * 0.25, Math.sin(t * 0.8) * 0.6);
    (winMat as THREE.MeshStandardMaterial).emissiveIntensity = 1.5 + Math.sin(t * 2) * 0.3;
  }, house, sun);
};

/** Work: a laptop with a live dashboard on screen. */
export const laptop: ModelFactory = (color) => {
  const shell = metal(new THREE.Color('#c9cbe0'), 0.35);
  const base = new THREE.Mesh(new RoundedBoxGeometry(1.7, 0.08, 1.1, 3, 0.04), shell);
  base.position.y = -0.45;
  const pad = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.01, 0.3, 2, 0.005), glossy(new THREE.Color('#9aa0c3')));
  pad.position.set(0, -0.405, 0.3);
  const hinge = new THREE.Group();
  hinge.position.set(0, -0.42, -0.53);
  const lid = new THREE.Mesh(new RoundedBoxGeometry(1.7, 1.08, 0.06, 3, 0.03), shell);
  lid.position.y = 0.54;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.56, 0.94), new THREE.MeshBasicMaterial({ color: '#120f2c' }));
  screen.position.set(0, 0.54, 0.032);
  hinge.add(lid, screen);
  const bars: THREE.Mesh[] = [];
  const barColors = [color, lighten(color, 0.4), new THREE.Color('#ff7ad9'), new THREE.Color('#5cc8ff'), GOLD];
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 1), glow(barColors[i], 1.4));
    b.position.set(-0.48 + i * 0.24, 0.3, 0.036);
    hinge.add(b);
    bars.push(b);
  }
  const line = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.03), glow(CREAM, 1));
  line.position.set(0, 0.88, 0.036);
  hinge.add(line);
  hinge.rotation.x = -0.18;
  const root = group(undefined, base, pad, hinge);
  return group((t, hover) => {
    root.rotation.y = Math.sin(t * 0.45) * 0.45 + hover * 0.35;
    root.rotation.x = 0.25;
    bars.forEach((b, i) => {
      const h = 0.18 + (Math.sin(t * 1.4 + i * 1.1) * 0.5 + 0.5) * 0.4 + i * 0.04;
      b.scale.y = h;
      b.position.y = 0.16 + h / 2;
    });
  }, root);
};

/** Skills: reusable building blocks that assemble themselves. */
export const blocks: ModelFactory = (color) => {
  const palette = [color, lighten(color, 0.45), new THREE.Color('#8b7bff'), GOLD];
  const spots: [number, number, number][] = [[-0.36, -0.36, 0], [0.36, -0.36, 0], [0, 0.36, 0], [0.36, 0.36, -0.5]];
  const cubes = spots.map((p, i) => {
    const m = new THREE.Mesh(new RoundedBoxGeometry(0.66, 0.66, 0.66, 4, 0.12), glossy(palette[i]));
    m.userData.home = new THREE.Vector3(...p);
    const glyph = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.035, 12, 32), glow(CREAM, 1.2));
    glyph.position.z = 0.335;
    if (i % 2) glyph.rotation.z = Math.PI / 4;
    m.add(glyph);
    return m;
  });
  const root = group(undefined, ...cubes);
  return group((t, hover) => {
    root.rotation.y = t * 0.35 + hover * 0.5;
    root.rotation.x = 0.35 + Math.sin(t * 0.4) * 0.1;
    cubes.forEach((c, i) => {
      const out = (Math.sin(t * 0.9 + i * 1.3) * 0.5 + 0.5) * (0.12 + hover * 0.25);
      c.position.copy(c.userData.home).multiplyScalar(1 + out);
      c.rotation.z = Math.sin(t + i) * 0.08;
    });
  }, root);
};

/** Automation: interlocking gears turning together. */
export const gears: ModelFactory = (color) => {
  const big = new THREE.Mesh(extrude(gearShape(14, 0.78, 0.64, 0.2), 0.22, 0.04, 2), metal(GOLD, 0.25));
  const small = new THREE.Mesh(extrude(gearShape(9, 0.52, 0.39, 0.13), 0.22, 0.04, 2), metal(color, 0.25));
  const tiny = new THREE.Mesh(extrude(gearShape(7, 0.36, 0.25, 0.09), 0.2, 0.04, 2), metal(lighten(color, 0.4), 0.3));
  big.position.set(-0.36, -0.15, 0);
  small.position.set(0.82, 0.32, 0);
  tiny.position.set(0.16, 0.92, 0.0);
  const hubMat = glossy(INK);
  [big, small, tiny].forEach((g) => {
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.34, 24), hubMat);
    hub.rotation.x = Math.PI / 2;
    g.add(hub);
  });
  const root = group(undefined, big, small, tiny);
  root.position.set(-0.15, -0.2, 0);
  return group((t, hover) => {
    const speed = 0.6 + hover * 1.6;
    big.rotation.z = t * speed * 0.5;
    small.rotation.z = -t * speed * 0.5 * (14 / 9) + 0.18;
    tiny.rotation.z = t * speed * 0.5 * (14 / 7) + 0.3;
    root.rotation.y = Math.sin(t * 0.4) * 0.5;
    root.rotation.x = Math.sin(t * 0.3) * 0.15;
  }, root);
};

/** Creative: a glass prism splitting a beam of light into a spectrum. */
export const prism: ModelFactory = (color) => {
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.62, 0.62, 0.9, 3, 1),
    glossy(lighten(color, 0.7), { transparent: true, opacity: 0.82, roughness: 0.05, iridescence: 1, flatShading: true }),
  );
  body.rotation.x = Math.PI / 2;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.4, 12), additive('#ffffff', 0.9));
  beam.rotation.z = Math.PI / 2.4;
  beam.position.set(-1.0, 0.25, 0);
  const spectrum = ['#ff5c7a', '#ff8a5c', '#ffd166', '#7ee081', '#5cc8ff', '#8b7bff'];
  const rays = new THREE.Group();
  spectrum.forEach((c, i) => {
    const r = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.05, 0.05), additive(c, 0.85));
    r.geometry.translate(0.65, 0, 0);
    r.rotation.z = -0.05 - i * 0.075;
    rays.add(r);
  });
  rays.position.set(0.3, 0, 0);
  const root = group(undefined, body, beam, rays);
  return group((t, hover) => {
    body.rotation.y = t * 0.5;
    root.rotation.y = Math.sin(t * 0.4) * 0.35;
    rays.children.forEach((r, i) => ((r as THREE.Mesh).scale.x = 0.85 + Math.sin(t * 2 + i) * 0.12 + hover * 0.2));
  }, root);
};

/** Earn & grow: a stack of coins with a rising arrow. */
export const coins: ModelFactory = (color) => {
  const profile = [
    [0, -0.08], [0.42, -0.08], [0.47, -0.06], [0.49, 0], [0.47, 0.06], [0.42, 0.08], [0.36, 0.08], [0.35, 0.06], [0, 0.06],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const coinGeo = new THREE.LatheGeometry(profile, 48);
  const coinMat = metal(GOLD, 0.22);
  const stack = new THREE.Group();
  const heights = [0, 0.17, 0.34, 0.51, 0.68];
  heights.forEach((y, i) => {
    const c = new THREE.Mesh(coinGeo, coinMat);
    c.position.set(Math.sin(i * 1.7) * 0.04 - 0.35, y - 0.55, Math.cos(i * 1.3) * 0.04);
    stack.add(c);
  });
  const flip = new THREE.Mesh(coinGeo, coinMat);
  flip.rotation.x = Math.PI / 2;
  const arrow = new THREE.Mesh(extrude(arrowShape(), 0.16, 0.04), glossy(color));
  arrow.position.set(0.5, 0.0, 0);
  arrow.rotation.z = -0.5;
  const root = group(undefined, stack, flip, arrow);
  return group((t, hover) => {
    root.rotation.y = Math.sin(t * 0.5) * 0.4 + hover * 0.3;
    flip.position.set(-0.35, 0.55 + Math.abs(Math.sin(t * 1.5)) * 0.35, 0);
    flip.rotation.y = t * 4;
    arrow.position.y = Math.sin(t * 1.2) * 0.08;
  }, root);
};

/** Safety: a shield with a glowing check mark. */
export const shield: ModelFactory = (color) => {
  const outer = new THREE.Mesh(extrude(shieldShape(1), 0.18, 0.07), metal(lighten(color, 0.15), 0.3));
  const inner = new THREE.Mesh(extrude(shieldShape(0.78), 0.16, 0.05), glossy(darken(color, 0.3)));
  inner.position.z = 0.12;
  const check = new THREE.Mesh(extrude(checkShape(), 0.1, 0.03), glow(CREAM, 1.5));
  check.position.set(0, 0.02, 0.26);
  check.scale.setScalar(1.25);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(1.18, 0.012, 8, 128), additive(lighten(color, 0.4), 0.6));
  const root = group(undefined, outer, inner, check);
  return group((t, hover) => {
    root.rotation.y = Math.sin(t * 0.6) * 0.6 + hover * 0.4;
    halo.rotation.set(Math.PI / 2 + Math.sin(t * 0.7) * 0.3, 0, t * 0.5);
    check.scale.setScalar(1.25 + Math.sin(t * 2.2) * 0.04);
  }, root, halo);
};

/** Power-user: a rocket with a flickering flame. */
export const rocket: ModelFactory = (color) => {
  const profile = [
    [0, -0.78], [0.22, -0.76], [0.32, -0.5], [0.35, -0.1], [0.32, 0.3], [0.22, 0.62], [0.1, 0.84], [0, 0.92],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 48), glossy(CREAM, { iridescence: 0.2 }));
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0);
  finShape.lineTo(0.32, -0.32);
  finShape.lineTo(0.32, -0.5);
  finShape.lineTo(0, -0.34);
  finShape.closePath();
  const finGeo = extrude(finShape, 0.06, 0.02, 2);
  const fins = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const f = new THREE.Mesh(finGeo, glossy(color));
    const holder = new THREE.Group();
    f.position.set(0.38, -0.45, 0);
    holder.add(f);
    holder.rotation.y = (i * Math.PI * 2) / 3;
    fins.add(holder);
  }
  const windowRing = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.03, 12, 32), metal(GOLD));
  windowRing.position.set(0, 0.2, 0.33);
  const glass = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 24), glossy(new THREE.Color('#5cc8ff'), { iridescence: 1 }));
  glass.position.set(0, 0.2, 0.3);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.335, 0.03, 12, 48), glossy(color));
  band.rotation.x = Math.PI / 2;
  band.position.y = -0.15;
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.6, 24, 1, true), additive('#ffb347', 0.9));
  flame.rotation.x = Math.PI;
  flame.position.y = -1.05;
  const core = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.36, 16, 1, true), additive('#fff4e0', 1));
  core.rotation.x = Math.PI;
  core.position.y = -0.95;
  const ship = group(undefined, body, fins, windowRing, glass, band, flame, core);
  ship.rotation.z = -0.55;
  return group((t, hover) => {
    ship.position.y = Math.sin(t * 1.4) * 0.08;
    ship.rotation.y = t * 0.6;
    const f = 1 + Math.sin(t * 22) * 0.12 + hover * 0.4;
    flame.scale.set(1, f, 1);
    core.scale.set(1, f * 0.9, 1);
  }, ship);
};

// ---------- feature models ----------

/** Paywall: a padlock that wiggles invitingly. */
export const lock: ModelFactory = (color) => {
  const body = new THREE.Mesh(new RoundedBoxGeometry(1.1, 0.86, 0.44, 4, 0.12), metal(GOLD, 0.25));
  body.position.y = -0.3;
  const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.08, 16, 48, Math.PI), metal(new THREE.Color('#d8dbf0'), 0.2));
  shackle.position.y = 0.32;
  const legs = [-0.34, 0.34].map((x) => {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.3, 16), shackle.material);
    l.position.set(x, 0.17, 0);
    return l;
  });
  const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.05, 24), glow(color, 2));
  hole.rotation.x = Math.PI / 2;
  hole.position.set(0, -0.22, 0.23);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.05), glow(color, 2));
  slot.position.set(0, -0.36, 0.23);
  const root = group(undefined, body, shackle, ...legs, hole, slot);
  return group((t, hover) => {
    root.rotation.y = Math.sin(t * 0.8) * 0.4;
    root.rotation.z = Math.sin(t * 6) * 0.03 * (1 + hover * 3);
    shackle.position.y = 0.32 + hover * 0.12;
  }, root);
};

/** Certificate: a trophy cup with a star. */
export const trophy: ModelFactory = (color) => {
  const profile = [
    [0, -0.95], [0.5, -0.95], [0.5, -0.82], [0.22, -0.76], [0.12, -0.55], [0.1, -0.3], [0.2, -0.16], [0.5, 0.02], [0.62, 0.42], [0.64, 0.82], [0.58, 0.84], [0.54, 0.46], [0.42, 0.14], [0.0, 0.04],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const cup = new THREE.Mesh(new THREE.LatheGeometry(profile, 64), metal(GOLD, 0.2));
  const handles = [-1, 1].map((s) => {
    const h = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.045, 12, 32, Math.PI), cup.material);
    h.rotation.z = s > 0 ? -Math.PI / 2 : Math.PI / 2;
    h.position.set(s * 0.64, 0.42, 0);
    return h;
  });
  const star = new THREE.Mesh(extrude(sparkleShape(0.3), 0.06, 0.02), glow(color, 1.8));
  star.scale.setScalar(0.22);
  star.position.set(0, 0.42, 0.62);
  const root = group(undefined, cup, ...handles, star);
  return group((t, hover) => {
    root.rotation.y = Math.sin(t * 0.6) * 0.6 + hover * 0.5;
    star.rotation.z = t;
  }, root);
};

/** Playbooks / glossary: an open book with floating pages. */
export const book: ModelFactory = (color) => {
  const coverMat = glossy(color);
  const pageMat = glossy(CREAM, { iridescence: 0, roughness: 0.5, clearcoat: 0 });
  const left = new THREE.Group();
  const right = new THREE.Group();
  const coverL = new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.05, 1.25, 2, 0.02), coverMat);
  coverL.position.x = -0.45;
  const pagesL = new THREE.Mesh(new RoundedBoxGeometry(0.84, 0.08, 1.16, 2, 0.02), pageMat);
  pagesL.position.set(-0.44, 0.06, 0);
  left.add(coverL, pagesL);
  const coverR = coverL.clone();
  coverR.position.x = 0.45;
  const pagesR = pagesL.clone();
  pagesR.position.x = 0.44;
  right.add(coverR, pagesR);
  left.rotation.z = 0.22;
  right.rotation.z = -0.22;
  const flutter = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.1, 8, 1), new THREE.MeshStandardMaterial({ color: CREAM, side: THREE.DoubleSide, roughness: 0.6 }));
  flutter.geometry.translate(0.4, 0, 0);
  flutter.rotation.x = -Math.PI / 2;
  const fl = new THREE.Group();
  fl.add(flutter);
  fl.position.y = 0.12;
  const root = group(undefined, left, right, fl);
  root.rotation.x = 0.7;
  return group((t, hover) => {
    root.rotation.y = Math.sin(t * 0.5) * 0.4;
    fl.rotation.z = Math.PI * (0.15 + (Math.sin(t * (1 + hover)) * 0.5 + 0.5) * 0.7);
  }, root);
};

/** Prompt library: a cluster of sparkles. */
export const sparkle: ModelFactory = (color) => {
  const big = new THREE.Mesh(extrude(sparkleShape(), 0.22, 0.05), glossy(color, { iridescence: 0.8 }));
  big.scale.setScalar(0.78);
  const s1 = new THREE.Mesh(extrude(sparkleShape(), 0.2, 0.04), glossy(GOLD));
  s1.scale.setScalar(0.3);
  s1.position.set(0.8, 0.62, 0.2);
  const s2 = new THREE.Mesh(extrude(sparkleShape(), 0.2, 0.04), glossy(lighten(color, 0.5)));
  s2.scale.setScalar(0.22);
  s2.position.set(-0.8, -0.58, 0.1);
  return group((t, hover) => {
    big.rotation.y = Math.sin(t * 0.9) * 0.6 + hover;
    big.rotation.z = Math.sin(t * 0.5) * 0.15;
    s1.rotation.z = t * 1.2;
    s2.rotation.z = -t * 1.5;
    s1.scale.setScalar(0.3 + Math.sin(t * 2) * 0.04);
  }, big, s1, s2);
};

/** Tool finder: a compass. */
export const compass: ModelFactory = (color) => {
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.09, 16, 64), metal(GOLD, 0.25));
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.06, 64), glossy(INK));
  face.rotation.x = Math.PI / 2;
  const needle = new THREE.Group();
  const nShape = new THREE.Shape();
  nShape.moveTo(0, 0.68);
  nShape.lineTo(0.1, 0);
  nShape.lineTo(-0.1, 0);
  nShape.closePath();
  const n1 = new THREE.Mesh(extrude(nShape, 0.05, 0.015), glow(color, 1.6));
  n1.position.y = 0.34;
  const n2 = new THREE.Mesh(extrude(nShape, 0.05, 0.015), glossy(CREAM));
  n2.position.y = -0.34;
  n2.rotation.z = Math.PI;
  needle.add(n1, n2);
  needle.position.z = 0.08;
  const pin = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 16), metal(GOLD));
  pin.position.z = 0.1;
  const ticks = new THREE.Group();
  for (let i = 0; i < 12; i++) {
    const tk = new THREE.Mesh(new THREE.BoxGeometry(0.03, i % 3 ? 0.06 : 0.12, 0.02), glow(lighten(color, 0.5), 1));
    const a = (i / 12) * Math.PI * 2;
    tk.position.set(Math.sin(a) * 0.68, Math.cos(a) * 0.68, 0.045);
    tk.rotation.z = -a;
    ticks.add(tk);
  }
  const root = group(undefined, face, rim, ticks, needle, pin);
  return group((t, hover) => {
    root.rotation.y = Math.sin(t * 0.5) * 0.5;
    root.rotation.x = -0.3;
    needle.rotation.z = Math.sin(t * 0.9) * 0.6 + Math.sin(t * 2.3) * 0.15 + hover * 2;
  }, root);
};

/** Hero: a luminous core wrapped in rings, orbited by miniature module models. */
export const hero: ModelFactory = (color) => {
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.72, 0), glossy(color, { flatShading: true, iridescence: 1, roughness: 0.08 }));
  const inner = new THREE.Mesh(new THREE.OctahedronGeometry(0.4, 0), glow(GOLD, 2.2));
  const shell = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.0, 1)),
    new THREE.LineBasicMaterial({ color: lighten(color, 0.55), transparent: true, opacity: 0.35 }),
  );
  const rings = [0, 1, 2].map((i) => {
    const r = new THREE.Mesh(new THREE.TorusGeometry(1.35 + i * 0.28, 0.014, 8, 160), additive(['#8b7bff', '#5cc8ff', '#ff7ad9'][i], 0.75));
    r.rotation.set(Math.PI / 2 + (i - 1) * 0.5, i * 0.6, 0);
    return r;
  });
  const minis = [gears, bubble, shield, sparkle, coins, rocket].map((f, i) => {
    const m = f(new THREE.Color(['#ffd166', '#5cc8ff', '#5ce1e6', '#ff7ad9', '#7ee081', '#b48cff'][i]));
    m.scale.setScalar(0.24);
    return m;
  });
  const orbit = new THREE.Group();
  minis.forEach((m) => orbit.add(m));
  // Star field
  const count = 420;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const palette = ['#8b7bff', '#5cc8ff', '#ff7ad9', '#ffd166', '#ffffff'].map((c) => new THREE.Color(c));
  for (let i = 0; i < count; i++) {
    const r = 2.2 + Math.random() * 2.6;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    positions.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.6, r * Math.sin(ph) * Math.sin(th)], i * 3);
    const c = palette[i % palette.length];
    colors.set([c.r, c.g, c.b], i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ size: 0.035, vertexColors: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  const g = group((t, hover) => {
    core.rotation.set(t * 0.3, t * 0.45, 0);
    inner.rotation.set(-t * 0.6, t * 0.8, 0);
    shell.rotation.y = -t * 0.15;
    rings.forEach((r, i) => (r.rotation.z = t * (0.2 + i * 0.12) * (i % 2 ? -1 : 1)));
    minis.forEach((m, i) => {
      const a = t * 0.35 + (i / minis.length) * Math.PI * 2;
      const rad = 1.78 + Math.sin(t * 0.8 + i) * 0.06;
      m.position.set(Math.cos(a) * rad, Math.sin(a * 2 + i) * 0.35, Math.sin(a) * rad * 0.55);
      (m.userData.update as Updater | undefined)?.(t + i, 0);
    });
    stars.rotation.y = t * 0.03;
    g.rotation.x = hover * 0.15;
  }, core, inner, shell, ...rings, orbit, stars);
  g.userData.noFit = true;
  return g;
};

export const MODELS: Record<string, ModelFactory> = {
  orb, bubble, home, laptop, blocks, gears, prism, coins, shield, rocket,
  lock, trophy, book, sparkle, compass, hero,
};

/** Builds a model by name, normalised to fit a unit sphere (except the hero). */
export function buildModel(name: string, color: string): THREE.Group {
  const factory = MODELS[name] ?? MODELS.orb;
  const model = factory(new THREE.Color(color));
  if (!model.userData.noFit) {
    model.userData.update?.(0, 0);
    const sphere = new THREE.Box3().setFromObject(model).getBoundingSphere(new THREE.Sphere());
    const s = sphere.radius > 0 ? (1.15 * (model.userData.fit ?? 1)) / sphere.radius : 1;
    const wrapper = new THREE.Group();
    model.position.sub(sphere.center.multiplyScalar(s));
    model.scale.multiplyScalar(s);
    wrapper.add(model);
    wrapper.userData.update = model.userData.update;
    return wrapper;
  }
  return model;
}
