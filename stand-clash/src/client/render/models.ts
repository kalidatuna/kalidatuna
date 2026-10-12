// Code-generated blocky character and Stand models. Each joint is one merged, vertex-coloured mesh
// plus an inverted-hull outline mesh, so a full character costs ~22 draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CharId } from '../../shared/characters';

export type JointName = 'pelvis' | 'torso' | 'head' | 'shL' | 'elL' | 'shR' | 'elR' | 'hipL' | 'knL' | 'hipR' | 'knR' | 'cape';
export const JOINTS: JointName[] = ['pelvis', 'torso', 'head', 'shL', 'elL', 'shR', 'elR', 'hipL', 'knL', 'hipR', 'knR', 'cape'];

interface BoxSpec {
  j: JointName;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  c: number;
  rx?: number;
  noOutline?: boolean;
  glow?: boolean;
}

export interface RigDesign {
  boxes: BoxSpec[];
  scale: number;
  shoulderX: number;
  hipX: number;
}

export interface Rig {
  root: THREE.Group;
  joints: Record<JointName, THREE.Group>;
  material: THREE.MeshLambertMaterial;
  meshes: THREE.Mesh[];
  outlines: THREE.Mesh[];
  handR: THREE.Group;
  handL: THREE.Group;
  scale: number;
}

const OUTLINE = 0.045;
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x120a18, side: THREE.BackSide });
const geoCache = new Map<string, { geo: Map<JointName, THREE.BufferGeometry>; out: Map<JointName, THREE.BufferGeometry> }>();

function boxGeo(b: BoxSpec, grow: number, color: THREE.Color | null): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(b.w + grow * 2, b.h + grow * 2, b.d + grow * 2);
  if (b.rx) g.rotateX(b.rx);
  g.translate(b.x, b.y, b.z);
  const n = g.attributes.position.count;
  const cols = new Float32Array(n * 3);
  const c = color ?? new THREE.Color(0, 0, 0);
  // simple top-light baked into vertex colours for extra punch
  const ny = g.attributes.normal;
  for (let i = 0; i < n; i++) {
    const shade = ny.getY(i) > 0.5 ? 1.08 : ny.getY(i) < -0.5 ? 0.78 : 1;
    cols[i * 3] = Math.min(1, c.r * shade);
    cols[i * 3 + 1] = Math.min(1, c.g * shade);
    cols[i * 3 + 2] = Math.min(1, c.b * shade);
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.deleteAttribute('uv');
  return g;
}

function buildGeometries(key: string, design: RigDesign) {
  const cached = geoCache.get(key);
  if (cached) return cached;
  const geo = new Map<JointName, THREE.BufferGeometry>();
  const out = new Map<JointName, THREE.BufferGeometry>();
  for (const j of JOINTS) {
    const list = design.boxes.filter((b) => b.j === j);
    if (!list.length) continue;
    const col = new THREE.Color();
    geo.set(j, mergeGeometries(list.map((b) => boxGeo(b, 0, col.setHex(b.c).clone())))!);
    const ol = list.filter((b) => !b.noOutline);
    if (ol.length) out.set(j, mergeGeometries(ol.map((b) => boxGeo(b, OUTLINE, null)))!);
  }
  const r = { geo, out };
  geoCache.set(key, r);
  return r;
}

/** Joint pivot positions (unscaled). */
function pivots(d: RigDesign): Record<JointName, [JointName | null, number, number, number]> {
  return {
    pelvis: [null, 0, 0.95, 0],
    torso: ['pelvis', 0, 0.06, 0],
    head: ['torso', 0, 0.68, 0],
    shL: ['torso', d.shoulderX, 0.6, 0],
    elL: ['shL', 0, -0.33, 0],
    shR: ['torso', -d.shoulderX, 0.6, 0],
    elR: ['shR', 0, -0.33, 0],
    hipL: ['pelvis', d.hipX, -0.02, 0],
    knL: ['hipL', 0, -0.45, 0],
    hipR: ['pelvis', -d.hipX, -0.02, 0],
    knR: ['hipR', 0, -0.45, 0],
    cape: ['torso', 0, 0.62, -0.17],
  };
}

export function buildRig(key: string, design: RigDesign, emissive = 0x000000): Rig {
  const { geo, out } = buildGeometries(key, design);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, emissive });
  const root = new THREE.Group();
  const scaled = new THREE.Group();
  scaled.scale.setScalar(design.scale);
  root.add(scaled);
  const joints = {} as Record<JointName, THREE.Group>;
  const piv = pivots(design);
  const meshes: THREE.Mesh[] = [];
  const outlines: THREE.Mesh[] = [];
  for (const j of JOINTS) {
    const g = new THREE.Group();
    g.name = j;
    joints[j] = g;
  }
  for (const j of JOINTS) {
    const [parent, x, y, z] = piv[j];
    joints[j].position.set(x, y, z);
    (parent ? joints[parent] : scaled).add(joints[j]);
    const gg = geo.get(j);
    if (gg) {
      const m = new THREE.Mesh(gg, material);
      m.castShadow = true;
      joints[j].add(m);
      meshes.push(m);
    }
    const og = out.get(j);
    if (og) {
      const o = new THREE.Mesh(og, outlineMat);
      joints[j].add(o);
      outlines.push(o);
    }
  }
  const handR = new THREE.Group();
  handR.position.set(0, -0.4, 0.02);
  joints.elR.add(handR);
  const handL = new THREE.Group();
  handL.position.set(0, -0.4, 0.02);
  joints.elL.add(handL);
  return { root, joints, material, meshes, outlines, handR, handL, scale: design.scale };
}

// ------------------------------------------------------------------ design helpers
class D {
  boxes: BoxSpec[] = [];
  b(j: JointName, x: number, y: number, z: number, w: number, h: number, d: number, c: number, extra: Partial<BoxSpec> = {}) {
    this.boxes.push({ j, x, y, z, w, h, d, c, ...extra });
    return this;
  }
  /** symmetric pair on L/R joints (x given for the left side) */
  pair(jl: JointName, jr: JointName, x: number, y: number, z: number, w: number, h: number, d: number, c: number, extra: Partial<BoxSpec> = {}) {
    this.b(jl, x, y, z, w, h, d, c, extra);
    this.b(jr, -x, y, z, w, h, d, c, extra);
    return this;
  }
}

interface Palette {
  skin: number;
  shirt: number;
  torsoW?: number;
  sleeve: number;
  hand?: number;
  pants: number;
  shoe: number;
  belt?: number;
}

/** Standard humanoid body. Callers decorate with hair, coats etc. */
function humanoid(p: Palette, bulky = 1): D {
  const d = new D();
  const tw = (p.torsoW ?? 0.56) * bulky;
  d.b('pelvis', 0, 0, 0, tw - 0.04, 0.24, 0.28, p.pants);
  if (p.belt !== undefined) d.b('pelvis', 0, 0.1, 0, tw - 0.02, 0.07, 0.3, p.belt, { noOutline: true });
  d.b('torso', 0, 0.33, 0, tw, 0.62, 0.3 * bulky, p.shirt);
  d.b('head', 0, 0.04, 0, 0.18, 0.1, 0.18, p.skin, { noOutline: true });
  d.b('head', 0, 0.25, 0, 0.42, 0.42, 0.42, p.skin);
  // eyes
  d.b('head', 0.09, 0.27, 0.212, 0.08, 0.05, 0.01, 0x1a1a2a, { noOutline: true });
  d.b('head', -0.09, 0.27, 0.212, 0.08, 0.05, 0.01, 0x1a1a2a, { noOutline: true });
  d.pair('shL', 'shR', 0, -0.15, 0, 0.19 * bulky, 0.38, 0.2 * bulky, p.sleeve);
  d.pair('elL', 'elR', 0, -0.16, 0, 0.17 * bulky, 0.32, 0.18 * bulky, p.sleeve);
  d.pair('elL', 'elR', 0, -0.37, 0.01, 0.17 * bulky, 0.13, 0.18 * bulky, p.hand ?? p.skin);
  d.pair('hipL', 'hipR', 0, -0.22, 0, 0.23 * bulky, 0.46, 0.25 * bulky, p.pants);
  d.pair('knL', 'knR', 0, -0.21, 0, 0.21 * bulky, 0.42, 0.23 * bulky, p.pants);
  d.pair('knL', 'knR', 0, -0.46, 0.05, 0.23 * bulky, 0.1, 0.34 * bulky, p.shoe);
  return d;
}

const DESIGNS: Record<string, () => RigDesign> = {
  jotaro: () => {
    const coat = 0x1d1b33;
    const d = humanoid({ skin: 0xe9b48c, shirt: 0x1d1b33, sleeve: coat, pants: 0x23213d, shoe: 0x4a3426, belt: 0xc9a227, torsoW: 0.6 });
    // open coat front showing a dark shirt + gold zipper line
    d.b('torso', 0, 0.3, 0.155, 0.16, 0.5, 0.02, 0x2d2e3e, { noOutline: true });
    // high collar
    d.b('torso', 0, 0.66, -0.02, 0.5, 0.18, 0.34, coat);
    d.b('torso', 0.14, 0.62, 0.16, 0.12, 0.2, 0.04, coat, { noOutline: true });
    d.b('torso', -0.14, 0.62, 0.16, 0.12, 0.2, 0.04, coat, { noOutline: true });
    // gold chain from left collar across the chest
    for (let i = 0; i < 6; i++) d.b('torso', 0.2 - i * 0.03, 0.6 - i * 0.07, 0.165, 0.05, 0.05, 0.03, 0xf2c94c, { noOutline: true, glow: true });
    d.b('torso', 0.2, 0.62, 0.17, 0.09, 0.09, 0.03, 0xf2c94c, { noOutline: true });
    // second belt slanted
    d.b('pelvis', 0, 0.02, 0, 0.56, 0.06, 0.31, 0x8a6a2a, { noOutline: true });
    // long coat tails
    d.b('cape', 0, -0.62, 0, 0.6, 0.95, 0.06, coat);
    d.b('pelvis', 0.27, -0.25, 0.02, 0.06, 0.6, 0.3, coat);
    d.b('pelvis', -0.27, -0.25, 0.02, 0.06, 0.6, 0.3, coat);
    // cap fused with hair
    d.b('head', 0, 0.49, -0.02, 0.48, 0.14, 0.5, 0x15142a);
    d.b('head', 0, 0.44, 0.27, 0.46, 0.05, 0.14, 0x15142a);
    d.b('head', 0, 0.36, -0.26, 0.48, 0.3, 0.12, 0x101018); // hair at back blending into the cap
    d.b('head', 0, 0.495, 0.25, 0.1, 0.07, 0.02, 0xf2c94c, { noOutline: true });
    d.b('head', 0.22, 0.32, 0.05, 0.04, 0.2, 0.3, 0x101018, { noOutline: true });
    d.b('head', -0.22, 0.32, 0.05, 0.04, 0.2, 0.3, 0x101018, { noOutline: true });
    // stern brows
    d.b('head', 0.09, 0.32, 0.213, 0.11, 0.025, 0.01, 0x101018, { noOutline: true });
    d.b('head', -0.09, 0.32, 0.213, 0.11, 0.025, 0.01, 0x101018, { noOutline: true });
    return { boxes: d.boxes, scale: 1.02, shoulderX: 0.39, hipX: 0.14 };
  },
  starplatinum: () => {
    const skin = 0x7a63d6;
    const d = humanoid({ skin, shirt: skin, sleeve: skin, pants: skin, shoe: 0xd9a92c, torsoW: 0.66 }, 1.12);
    // muscle shading: pecs and abs
    d.b('torso', 0.13, 0.48, 0.17, 0.24, 0.16, 0.03, 0x8c76e8, { noOutline: true });
    d.b('torso', -0.13, 0.48, 0.17, 0.24, 0.16, 0.03, 0x8c76e8, { noOutline: true });
    for (let i = 0; i < 3; i++) {
      d.b('torso', 0.06, 0.28 - i * 0.09, 0.17, 0.1, 0.07, 0.02, 0x6a52c4, { noOutline: true });
      d.b('torso', -0.06, 0.28 - i * 0.09, 0.17, 0.1, 0.07, 0.02, 0x6a52c4, { noOutline: true });
    }
    // red scarf + flowing tail
    d.b('torso', 0, 0.66, 0, 0.5, 0.12, 0.36, 0xc0392b);
    d.b('cape', 0.12, -0.3, -0.04, 0.16, 0.6, 0.05, 0xc0392b);
    // gold shoulder pads, bracers, belt and loincloth
    d.pair('shL', 'shR', 0.03, 0.02, 0, 0.3, 0.14, 0.3, 0xe0b23a);
    d.pair('elL', 'elR', 0, -0.26, 0, 0.21, 0.12, 0.22, 0xe0b23a);
    d.b('pelvis', 0, 0.1, 0, 0.64, 0.08, 0.34, 0xe0b23a);
    d.b('pelvis', 0, -0.2, 0.16, 0.22, 0.36, 0.03, 0xf3f0e8);
    d.pair('knL', 'knR', 0, 0.0, 0.12, 0.18, 0.14, 0.04, 0xe0b23a, { noOutline: true });
    // long black hair + gold headband, glowing eyes
    d.b('head', 0, 0.48, -0.03, 0.46, 0.12, 0.48, 0x0d0b18);
    d.b('head', 0, 0.2, -0.27, 0.46, 0.6, 0.14, 0x0d0b18);
    d.b('head', 0, 0.37, 0.22, 0.44, 0.05, 0.02, 0xe0b23a, { noOutline: true });
    d.b('head', 0.09, 0.27, 0.215, 0.09, 0.05, 0.01, 0x9ff7ff, { noOutline: true, glow: true });
    d.b('head', -0.09, 0.27, 0.215, 0.09, 0.05, 0.01, 0x9ff7ff, { noOutline: true, glow: true });
    d.b('head', 0, 0.12, 0.213, 0.14, 0.03, 0.01, 0x3a2a7a, { noOutline: true });
    return { boxes: d.boxes, scale: 1.12, shoulderX: 0.45, hipX: 0.16 };
  },
  dio: () => {
    const yellow = 0xf4cf3a;
    const green = 0x2fbf71;
    const d = humanoid({ skin: 0xf3dcc8, shirt: 0x1f3d2b, sleeve: yellow, pants: yellow, shoe: 0xe0b42a, belt: green, torsoW: 0.56 });
    // short yellow jacket open over a dark green top
    d.b('torso', 0.2, 0.42, 0.02, 0.18, 0.5, 0.33, yellow);
    d.b('torso', -0.2, 0.42, 0.02, 0.18, 0.5, 0.33, yellow);
    d.b('torso', 0, 0.62, -0.06, 0.58, 0.14, 0.24, yellow);
    d.pair('shL', 'shR', 0.02, 0.02, 0, 0.26, 0.12, 0.26, yellow);
    // green wrist and ankle bands, heart knees
    d.pair('elL', 'elR', 0, -0.29, 0, 0.19, 0.06, 0.2, green, { noOutline: true });
    d.pair('knL', 'knR', 0, -0.4, 0, 0.23, 0.06, 0.25, green, { noOutline: true });
    d.pair('knL', 'knR', 0, 0.02, 0.13, 0.14, 0.12, 0.04, green, { noOutline: true });
    // blond hair, green heart headband
    d.b('head', 0, 0.48, -0.02, 0.48, 0.12, 0.48, 0xffe066);
    d.b('head', 0, 0.3, -0.24, 0.48, 0.42, 0.1, 0xffe066);
    d.b('head', 0.22, 0.28, 0.0, 0.08, 0.4, 0.4, 0xffe066);
    d.b('head', -0.22, 0.28, 0.0, 0.08, 0.4, 0.4, 0xffe066);
    d.b('head', 0.1, 0.42, 0.22, 0.18, 0.1, 0.04, 0xffe066, { noOutline: true });
    d.b('head', 0, 0.39, 0.225, 0.44, 0.045, 0.02, green, { noOutline: true });
    d.b('head', 0, 0.4, 0.235, 0.1, 0.09, 0.02, green, { noOutline: true });
    // green lips, sharp red eyes
    d.b('head', 0, 0.12, 0.213, 0.1, 0.03, 0.01, 0x1f9e58, { noOutline: true });
    d.b('head', 0.09, 0.27, 0.213, 0.08, 0.045, 0.01, 0xb3122e, { noOutline: true });
    d.b('head', -0.09, 0.27, 0.213, 0.08, 0.045, 0.01, 0xb3122e, { noOutline: true });
    return { boxes: d.boxes, scale: 1.02, shoulderX: 0.37, hipX: 0.14 };
  },
  theworld: () => {
    const gold = 0xe8b923;
    const dark = 0xb38712;
    const green = 0x1f7a55;
    const d = humanoid({ skin: gold, shirt: gold, sleeve: gold, pants: gold, shoe: dark, torsoW: 0.66 }, 1.12);
    // armour plates
    d.b('torso', 0, 0.42, 0.17, 0.5, 0.34, 0.04, dark);
    d.b('torso', 0, 0.42, 0.195, 0.14, 0.14, 0.02, green, { noOutline: true });
    d.pair('shL', 'shR', 0.04, 0.03, 0, 0.32, 0.16, 0.32, dark);
    d.pair('elL', 'elR', 0, -0.24, 0, 0.21, 0.14, 0.22, dark);
    d.pair('hipL', 'hipR', 0, -0.1, 0.13, 0.2, 0.16, 0.04, green, { noOutline: true });
    // heart-shaped knee guards
    d.pair('knL', 'knR', 0.04, 0.0, 0.13, 0.1, 0.16, 0.06, green, { noOutline: true });
    d.pair('knL', 'knR', -0.04, 0.0, 0.13, 0.1, 0.16, 0.06, green, { noOutline: true });
    d.b('pelvis', 0, 0.1, 0, 0.64, 0.08, 0.34, green);
    // masked head with tubes running back
    d.b('head', 0, 0.5, -0.04, 0.48, 0.12, 0.5, dark);
    d.b('head', 0, 0.36, -0.25, 0.48, 0.36, 0.1, dark);
    d.b('head', 0, 0.16, 0.215, 0.3, 0.14, 0.03, 0x2b2b2b, { noOutline: true });
    d.b('head', 0.15, 0.13, 0.0, 0.05, 0.05, 0.44, green, { noOutline: true });
    d.b('head', -0.15, 0.13, 0.0, 0.05, 0.05, 0.44, green, { noOutline: true });
    d.b('head', 0.09, 0.29, 0.215, 0.09, 0.05, 0.01, 0xd4fffa, { noOutline: true, glow: true });
    d.b('head', -0.09, 0.29, 0.215, 0.09, 0.05, 0.01, 0xd4fffa, { noOutline: true, glow: true });
    d.b('cape', 0, -0.2, 0.02, 0.08, 0.3, 0.05, green, { noOutline: true });
    return { boxes: d.boxes, scale: 1.12, shoulderX: 0.45, hipX: 0.16 };
  },
  zombie: () => {
    const d = humanoid({ skin: 0x9bb88a, shirt: 0x5a4a3a, sleeve: 0x5a4a3a, pants: 0x3e3a35, shoe: 0x2a2520, hand: 0x9bb88a });
    d.b('torso', 0.1, 0.2, 0.16, 0.16, 0.18, 0.02, 0x7a2a2a, { noOutline: true });
    d.b('head', 0, 0.48, 0, 0.44, 0.08, 0.44, 0x3a3a2a);
    d.b('head', 0.09, 0.27, 0.213, 0.08, 0.05, 0.01, 0xff2a2a, { noOutline: true, glow: true });
    d.b('head', -0.09, 0.27, 0.213, 0.08, 0.05, 0.01, 0xff2a2a, { noOutline: true, glow: true });
    d.b('head', 0, 0.12, 0.213, 0.16, 0.05, 0.01, 0x2a1a1a, { noOutline: true });
    // flesh bud
    d.b('head', 0.06, 0.44, 0.2, 0.08, 0.08, 0.06, 0xb04a6a, { noOutline: true });
    return { boxes: d.boxes, scale: 1.0, shoulderX: 0.37, hipX: 0.14 };
  },
  gunner: () => {
    const coat = 0xc8a878;
    const d = humanoid({ skin: 0xd8a27a, shirt: 0x6a3a2a, sleeve: coat, pants: 0x4a5a7a, shoe: 0x5a3a20, belt: 0x3a2a1a });
    d.b('cape', 0, -0.55, 0, 0.58, 0.85, 0.06, coat);
    d.b('torso', 0.2, 0.35, 0.03, 0.17, 0.62, 0.33, coat);
    d.b('torso', -0.2, 0.35, 0.03, 0.17, 0.62, 0.33, coat);
    // cowboy hat
    d.b('head', 0, 0.48, 0, 0.8, 0.05, 0.8, 0x6b4a2a);
    d.b('head', 0, 0.58, 0, 0.44, 0.2, 0.44, 0x6b4a2a);
    d.b('head', 0, 0.5, 0, 0.46, 0.05, 0.46, 0xc0392b, { noOutline: true });
    d.b('head', 0.15, 0.1, 0.22, 0.12, 0.025, 0.08, 0xffffff, { noOutline: true });
    return { boxes: d.boxes, scale: 1.0, shoulderX: 0.37, hipX: 0.14 };
  },
  rogue: () => {
    const d = humanoid({ skin: 0xe0b090, shirt: 0x2a2a2a, sleeve: 0x2a2a2a, pants: 0x3a3a5a, shoe: 0x111111, belt: 0xaaaaaa });
    d.b('torso', 0, 0.35, 0.16, 0.3, 0.3, 0.02, 0xff4d6d, { noOutline: true });
    // red mohawk
    d.b('head', 0, 0.55, 0, 0.12, 0.2, 0.46, 0xff2a4a);
    d.b('head', 0.09, 0.27, 0.213, 0.1, 0.03, 0.01, 0x111111, { noOutline: true });
    d.b('head', -0.09, 0.27, 0.213, 0.1, 0.03, 0.01, 0x111111, { noOutline: true });
    return { boxes: d.boxes, scale: 1.0, shoulderX: 0.37, hipX: 0.14 };
  },
  redriot: () => {
    const r = 0xd8344f;
    const d = humanoid({ skin: r, shirt: r, sleeve: r, pants: r, shoe: 0x222222, torsoW: 0.62 }, 1.08);
    for (let i = 0; i < 3; i++) d.b('torso', 0, 0.2 + i * 0.16, 0.165, 0.5, 0.04, 0.02, 0x1a1a1a, { noOutline: true });
    d.pair('shL', 'shR', 0, 0.02, 0, 0.26, 0.14, 0.26, 0x1a1a1a);
    d.b('head', 0, 0.5, 0, 0.12, 0.25, 0.46, 0x1a1a1a);
    d.b('head', 0.09, 0.27, 0.215, 0.1, 0.06, 0.01, 0xfff176, { noOutline: true });
    d.b('head', -0.09, 0.27, 0.215, 0.1, 0.06, 0.01, 0xfff176, { noOutline: true });
    return { boxes: d.boxes, scale: 1.08, shoulderX: 0.43, hipX: 0.15 };
  },
  dummy: () => {
    const wood = 0xc8a26b;
    const d = humanoid({ skin: wood, shirt: 0xd8b27b, sleeve: wood, pants: 0xb08a55, shoe: 0x8a6a40 });
    d.b('torso', 0, 0.38, 0.16, 0.3, 0.3, 0.02, 0xffffff, { noOutline: true });
    d.b('torso', 0, 0.38, 0.17, 0.2, 0.2, 0.02, 0xd63031, { noOutline: true });
    d.b('torso', 0, 0.38, 0.18, 0.08, 0.08, 0.02, 0xffffff, { noOutline: true });
    return { boxes: d.boxes, scale: 1.0, shoulderX: 0.37, hipX: 0.14 };
  },
};

export const STAND_OF: Partial<Record<CharId, string>> = {
  jotaro: 'starplatinum',
  dio: 'theworld',
  rogue: 'redriot',
};

export const STAND_COLOR: Record<string, number> = {
  starplatinum: 0x9b7bff,
  theworld: 0xffd23f,
  redriot: 0xff4d6d,
};

export const STAND_ARM_COLOR: Record<string, [number, number]> = {
  starplatinum: [0x7a63d6, 0xe0b23a],
  theworld: [0xe8b923, 0x1f7a55],
  redriot: [0xd8344f, 0x1a1a1a],
};

export function makeRig(name: string, emissive = 0x000000): Rig {
  const fn = DESIGNS[name] ?? DESIGNS.dummy;
  return buildRig(name, fn(), emissive);
}

/** One stand forearm+fist used for the barrage after-images (instanced). */
export function standFistGeometry(name: string): { geo: THREE.BufferGeometry; out: THREE.BufferGeometry } {
  const [arm, band] = STAND_ARM_COLOR[name] ?? [0xffffff, 0x888888];
  const specs: BoxSpec[] = [
    { j: 'elR', x: 0, y: 0, z: -0.2, w: 0.2, h: 0.2, d: 0.42, c: arm },
    { j: 'elR', x: 0, y: 0, z: -0.04, w: 0.23, h: 0.23, d: 0.12, c: band },
    { j: 'elR', x: 0, y: 0, z: 0.08, w: 0.24, h: 0.22, d: 0.2, c: arm },
  ];
  const col = new THREE.Color();
  const geo = mergeGeometries(specs.map((s) => boxGeo(s, 0, col.setHex(s.c).clone())))!;
  const out = mergeGeometries(specs.map((s) => boxGeo(s, OUTLINE, null)))!;
  return { geo, out };
}

/** Knife mesh geometry (blade + handle). */
export function knifeGeometry(): THREE.BufferGeometry {
  const col = new THREE.Color();
  const specs: BoxSpec[] = [
    { j: 'elR', x: 0, y: 0, z: 0.16, w: 0.05, h: 0.1, d: 0.36, c: 0xf4f8ff },
    { j: 'elR', x: 0, y: 0.055, z: 0.14, w: 0.055, h: 0.02, d: 0.3, c: 0x8a96a8 },
    { j: 'elR', x: 0, y: 0, z: -0.04, w: 0.1, h: 0.03, d: 0.04, c: 0x777777 },
    { j: 'elR', x: 0, y: 0, z: -0.12, w: 0.04, h: 0.05, d: 0.14, c: 0x3a2a1a },
  ];
  return mergeGeometries(specs.map((s) => boxGeo(s, 0, col.setHex(s.c).clone())))!;
}

export function gunGeometry(): THREE.BufferGeometry {
  const col = new THREE.Color();
  const specs: BoxSpec[] = [
    { j: 'elR', x: 0, y: 0, z: 0.12, w: 0.07, h: 0.08, d: 0.34, c: 0xf0c040 },
    { j: 'elR', x: 0, y: -0.07, z: -0.02, w: 0.06, h: 0.14, d: 0.07, c: 0x8a5a2a },
    { j: 'elR', x: 0, y: 0.02, z: 0.02, w: 0.1, h: 0.1, d: 0.1, c: 0xd09a20 },
  ];
  return mergeGeometries(specs.map((s) => boxGeo(s, 0, col.setHex(s.c).clone())))!;
}
