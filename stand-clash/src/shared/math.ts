// Small dependency-free vector math shared by the client simulation and the Node server.

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const vcopy = (a: V3): V3 => ({ x: a.x, y: a.y, z: a.z });
export const vset = (o: V3, a: V3): V3 => {
  o.x = a.x;
  o.y = a.y;
  o.z = a.z;
  return o;
};
export const vadd = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const vsub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const vscale = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const vlen = (a: V3): number => Math.hypot(a.x, a.y, a.z);
export const vlenXZ = (a: V3): number => Math.hypot(a.x, a.z);
export const vdist = (a: V3, b: V3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const vdistXZ = (a: V3, b: V3): number => Math.hypot(a.x - b.x, a.z - b.z);
export const vdot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const vnorm = (a: V3): V3 => {
  const l = vlen(a);
  return l > 1e-6 ? vscale(a, 1 / l) : v3();
};

/** Horizontal forward vector for a yaw angle. Yaw 0 faces +Z. */
export const fwdXZ = (yaw: number): V3 => ({ x: Math.sin(yaw), y: 0, z: Math.cos(yaw) });
/** Aim vector including pitch (positive pitch looks up). */
export const aimDir = (yaw: number, pitch: number): V3 => {
  const c = Math.cos(pitch);
  return { x: Math.sin(yaw) * c, y: Math.sin(pitch), z: Math.cos(yaw) * c };
};
export const yawTo = (from: V3, to: V3): number => Math.atan2(to.x - from.x, to.z - from.z);

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Frame-rate independent exponential smoothing. */
export const damp = (a: number, b: number, lambda: number, dt: number): number =>
  lerp(a, b, 1 - Math.exp(-lambda * dt));
export const wrapAngle = (a: number): number => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
export const dampAngle = (a: number, b: number, lambda: number, dt: number): number =>
  a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));

/** Deterministic PRNG so the server and every client generate the same town. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;
