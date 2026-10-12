// Deterministic Morioh-inspired town layout plus collision queries.
// The same code runs on every client (for rendering + physics) and on the server (for bots + validation).
import { V3, v3, mulberry32 } from './math';

export type MatKind =
  | 'wall'
  | 'roof'
  | 'stone'
  | 'wood'
  | 'leaf'
  | 'glass'
  | 'metal'
  | 'road'
  | 'lamp'
  | 'water'
  | 'grass'
  | 'trim'
  | 'cloth'
  | 'paint';

export interface WBox {
  min: V3;
  max: V3;
  color: number;
  mat: MatKind;
  solid: boolean;
  /** Draw a comic outline around this box (buildings, big props). */
  outline?: boolean;
}

export interface Sign {
  pos: V3;
  yaw: number;
  w: number;
  h: number;
  text: string;
  bg: string;
  fg: string;
}

export const WORLD_BOUND = 112;
export const STEP_HEIGHT = 0.6;
/** Airborne bodies automatically mantle ledges up to this height above their feet. */
export const MANTLE_HEIGHT = 1.2;

const WALL_COLORS = [0xf3e3c3, 0xcfe3f0, 0xf2c6c2, 0xc9ead1, 0xe8d9f2, 0xf6efd2, 0xd8d2c4, 0xf0d0a8];
const ROOF_COLORS = [0x9c2f3a, 0x3c5a8a, 0x2f7a5a, 0x6b4a3a, 0x7a3f8f, 0x355c6e];
const SHOPS = [
  { text: 'KAME YU', bg: '#2c3e8f', fg: '#ffe066' },
  { text: "TONIO'S", bg: '#a52a2a', fg: '#fff3d6' },
  { text: 'OWSON', bg: '#1f6fb2', fg: '#ffffff' },
  { text: 'CAFE DEUX', bg: '#3b2a1e', fg: '#f7c86b' },
  { text: 'BOOKS', bg: '#5d2e8c', fg: '#ffd84a' },
  { text: 'ARCADE', bg: '#d6246e', fg: '#fff04d' },
  { text: 'RAMEN', bg: '#c0392b', fg: '#ffffff' },
  { text: 'PHOTO', bg: '#16a085', fg: '#fff' },
  { text: 'BOUTIQUE', bg: '#8e44ad', fg: '#f5d76e' },
  { text: 'SHOES', bg: '#2d3436', fg: '#fdcb6e' },
];
const AWNING_COLORS = [0xe74c3c, 0x2e86de, 0x27ae60, 0xf39c12, 0x8e44ad, 0xd63384];

export class World {
  boxes: WBox[] = [];
  solids: WBox[] = [];
  signs: Sign[] = [];
  lamps: V3[] = [];
  spawns: V3[] = [];
  plazaSpawns: V3[] = [];
  private grid = new Map<number, number[]>();
  private readonly cell = 8;
  private stamp = 1;
  private marks: Uint32Array = new Uint32Array(0);
  private rnd: () => number;

  constructor(seed = 4242) {
    this.rnd = mulberry32(seed);
    this.generate();
    this.marks = new Uint32Array(this.solids.length);
    this.solids.forEach((b, i) => this.insert(b, i));
  }

  // ---------------------------------------------------------------- generation
  private add(
    minx: number,
    miny: number,
    minz: number,
    maxx: number,
    maxy: number,
    maxz: number,
    color: number,
    mat: MatKind,
    solid = true,
    outline = false,
  ): WBox {
    const b: WBox = {
      min: v3(Math.min(minx, maxx), Math.min(miny, maxy), Math.min(minz, maxz)),
      max: v3(Math.max(minx, maxx), Math.max(miny, maxy), Math.max(minz, maxz)),
      color,
      mat,
      solid,
      outline,
    };
    this.boxes.push(b);
    if (solid) this.solids.push(b);
    return b;
  }
  /** Box by centre (x,z), base y and size. */
  private addC(cx: number, y: number, cz: number, sx: number, sy: number, sz: number, color: number, mat: MatKind, solid = true, outline = false) {
    return this.add(cx - sx / 2, y, cz - sz / 2, cx + sx / 2, y + sy, cz + sz / 2, color, mat, solid, outline);
  }
  private pick<T>(arr: T[]): T {
    return arr[Math.floor(this.rnd() * arr.length)];
  }
  private range(a: number, b: number) {
    return a + (b - a) * this.rnd();
  }

  private generate() {
    const roads = [-100, -60, -20, 20, 60, 100];
    // Ground (grass) and roads are visual only; the ground plane y=0 is implicit in physics.
    this.add(-160, -1, -160, 160, 0, 160, 0x6dbb5a, 'grass', false);
    for (const r of roads) {
      this.add(r - 5, 0, -105, r + 5, 0.02, 105, 0x4a4a55, 'road', false);
      this.add(-105, 0.001, r - 5, 105, 0.021, r + 5, 0x4a4a55, 'road', false);
      // centre dashes
      for (let t = -100; t < 100; t += 6) {
        this.add(r - 0.12, 0.025, t, r + 0.12, 0.03, t + 2.5, 0xf5f0d0, 'paint', false);
        this.add(t, 0.026, r - 0.12, t + 2.5, 0.031, r + 0.12, 0xf5f0d0, 'paint', false);
      }
    }
    // Blocks between roads
    const centres = [-80, -40, 0, 40, 80];
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        const cx = centres[i];
        const cz = centres[j];
        // sidewalk slab under every block
        this.add(cx - 15, 0, cz - 15, cx + 15, 0.08, cz + 15, 0xb9b4a8, 'stone', false);
        if (i === 2 && j === 2) continue; // plaza handled separately
        if (i === 2 && j === 1) {
          this.station(cx, cz);
          continue;
        }
        const r = this.rnd();
        if ((i === 1 && j === 3) || (i === 3 && j === 1)) this.park(cx, cz);
        else if (r < 0.32) this.houses(cx, cz);
        else if (r < 0.62) this.shops(cx, cz, i, j);
        else if (r < 0.9) this.apartments(cx, cz);
        else this.park(cx, cz);
      }
    }
    this.plaza();
    this.streetProps(roads);
    this.boundary();
    // Spawn points along roads (open space)
    for (const r of roads) {
      for (let t = -90; t <= 90; t += 15) {
        if (Math.abs(r) === 100) continue;
        this.spawns.push(v3(r + (this.rnd() - 0.5) * 3, 0, t));
        this.spawns.push(v3(t, 0, r + (this.rnd() - 0.5) * 3));
      }
    }
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      this.plazaSpawns.push(v3(Math.sin(ang) * 15, 0, Math.cos(ang) * 15));
    }
  }

  private windowsOn(minx: number, minz: number, maxx: number, maxz: number, y0: number, y1: number, floorH: number, lit: number) {
    const glass = (x0: number, y: number, z0: number, x1: number, z1: number) => {
      const c = this.rnd() < lit ? 0xffe9a8 : 0x6fa8d6;
      this.add(x0, y, z0, x1, y + 1.2, z1, c, 'glass', false);
    };
    for (let y = y0; y + 1.6 < y1; y += floorH) {
      for (let x = minx + 1.4; x < maxx - 1.4; x += 2.6) {
        glass(x, y, minz - 0.08, x + 1.2, minz + 0.02);
        glass(x, y, maxz - 0.02, x + 1.2, maxz + 0.08);
      }
      for (let z = minz + 1.4; z < maxz - 1.4; z += 2.6) {
        glass(minx - 0.08, y, z, minx + 0.02, z + 1.2);
        glass(maxx - 0.02, y, z, maxx + 0.08, z + 1.2);
      }
    }
  }

  private house(cx: number, cz: number, w: number, d: number, faceYaw: number) {
    const h = this.range(4.2, 6);
    const wall = this.pick(WALL_COLORS);
    const roof = this.pick(ROOF_COLORS);
    const minx = cx - w / 2,
      maxx = cx + w / 2,
      minz = cz - d / 2,
      maxz = cz + d / 2;
    this.add(minx, 0, minz, maxx, h, maxz, wall, 'wall', true, true);
    // base trim
    this.add(minx - 0.1, 0, minz - 0.1, maxx + 0.1, 0.5, maxz + 0.1, 0x8a7f72, 'trim', false);
    this.windowsOn(minx, minz, maxx, maxz, 1.5, h, 3, 0.25);
    // stepped gable roof along x
    const steps = Math.ceil(d / 2 / 0.9) + 1;
    for (let s = 0; s < steps; s++) {
      const inset = s * 0.9;
      const z0 = minz - 0.6 + inset;
      const z1 = maxz + 0.6 - inset;
      if (z1 - z0 < 0.6) break;
      this.add(minx - 0.6, h + s * 0.55, z0, maxx + 0.6, h + (s + 1) * 0.55, z1, roof, 'roof', true, s === 0);
    }
    // chimney
    this.addC(minx + 1.5, h, cz + d * 0.15, 0.9, 3.2, 0.9, 0x8d5a4a, 'stone', true, true);
    // door on facing side
    const fz = Math.cos(faceYaw) > 0 ? maxz : minz;
    const dz = Math.cos(faceYaw) > 0 ? 0.08 : -0.08;
    this.add(cx - 0.7, 0, fz, cx + 0.7, 2.3, fz + dz, 0x7b4a2a, 'wood', false);
    // little garden wall + hedge
    const gz = fz + dz * 30;
    this.add(cx - w / 2 - 1, 0, gz - 0.25, cx - 1.2, 0.9, gz + 0.25, 0xd9d0c0, 'stone', true);
    this.add(cx + 1.2, 0, gz - 0.25, cx + w / 2 + 1, 0.9, gz + 0.25, 0xd9d0c0, 'stone', true);
    this.add(cx - w / 2 - 1, 0.9, gz - 0.3, cx - 1.2, 1.3, gz + 0.3, 0x3f8f3a, 'leaf', false);
    this.add(cx + 1.2, 0.9, gz - 0.3, cx + w / 2 + 1, 1.3, gz + 0.3, 0x3f8f3a, 'leaf', false);
  }

  private houses(cx: number, cz: number) {
    for (const ox of [-7.5, 7.5]) {
      for (const oz of [-7.5, 7.5]) {
        if (this.rnd() < 0.12) {
          this.tree(cx + ox, cz + oz);
          continue;
        }
        const w = this.range(8, 10);
        const d = this.range(6.5, 8);
        this.house(cx + ox, cz + oz * 0.85, w, d, oz > 0 ? 0 : Math.PI);
      }
    }
  }

  private shopUnit(x0: number, x1: number, zFront: number, depth: number, dir: 1 | -1) {
    const h = this.range(5, 7);
    const wall = this.pick(WALL_COLORS);
    const zBack = zFront - dir * depth;
    const minz = Math.min(zFront, zBack);
    const maxz = Math.max(zFront, zBack);
    this.add(x0, 0, minz, x1, h, maxz, wall, 'wall', true, true);
    // parapet makes the roof feel like a rooftop arena
    const pc = 0x9a9488;
    this.add(x0, h, minz, x1, h + 0.6, minz + 0.3, pc, 'trim', true);
    this.add(x0, h, maxz - 0.3, x1, h + 0.6, maxz, pc, 'trim', true);
    this.add(x0, h, minz, x0 + 0.3, h + 0.6, maxz, pc, 'trim', true);
    this.add(x1 - 0.3, h, minz, x1, h + 0.6, maxz, pc, 'trim', true);
    // rooftop AC unit
    this.addC(x0 + 2, h, (minz + maxz) / 2, 1.4, 1.1, 1.4, 0xc8cdd0, 'metal', true, true);
    // storefront glass
    const fz = zFront + dir * 0.06;
    this.add(x0 + 0.6, 0.3, zFront, x1 - 0.6, 2.6, fz, 0x8fd3f0, 'glass', false);
    this.windowsOn(x0, minz, x1, maxz, 3.6, h, 3, 0.4);
    // striped awning — solid, so players can bounce up onto the roofs
    const ac = this.pick(AWNING_COLORS);
    const slats = Math.max(2, Math.round((x1 - x0) / 1.2));
    const sw = (x1 - x0) / slats;
    for (let s = 0; s < slats; s++) {
      this.add(x0 + s * sw, 2.9, zFront, x0 + (s + 1) * sw, 3.25, zFront + dir * 1.8, s % 2 ? 0xffffff : ac, 'cloth', true);
    }
    const shop = this.pick(SHOPS);
    this.signs.push({
      pos: v3((x0 + x1) / 2, 4.2, zFront + dir * 0.12),
      yaw: dir > 0 ? 0 : Math.PI,
      w: Math.min(x1 - x0 - 1, 6),
      h: 1.2,
      text: shop.text,
      bg: shop.bg,
      fg: shop.fg,
    });
  }

  private shops(cx: number, cz: number, i: number, j: number) {
    // Two rows of shops facing the streets on the north and south side of the block
    for (const dir of [1, -1] as const) {
      const zFront = cz + dir * 14;
      let x = cx - 14;
      while (x < cx + 13) {
        const w = Math.min(this.range(6.5, 9.5), cx + 14 - x);
        if (w < 4) break;
        this.shopUnit(x, x + w, zFront, 10, dir);
        x += w + 0.4;
      }
    }
    // back alley with crates and vending machine
    this.addC(cx - 6, 0, cz, 1.2, 1.2, 1.2, 0xa0784a, 'wood', true, true);
    this.addC(cx - 6, 1.2, cz + 0.3, 1, 1, 1, 0xb58a58, 'wood', true, true);
    this.addC(cx + 5, 0, cz + 1.4, 1, 2, 0.8, (i + j) % 2 ? 0xd63031 : 0x0984e3, 'metal', true, true);
    this.addC(cx + 9, 0, cz - 0.5, 1.4, 1.2, 1.0, 0x2d6a4f, 'metal', true, true);
  }

  private apartments(cx: number, cz: number) {
    const tall = this.rnd() < 0.5;
    const blocks: [number, number, number, number][] = tall
      ? [[cx - 11, cz - 11, cx + 11, cz + 5]]
      : [
          [cx - 13, cz - 11, cx - 1.5, cz + 6],
          [cx + 1.5, cz - 11, cx + 13, cz + 6],
        ];
    for (const [x0, z0, x1, z1] of blocks) {
      const floors = tall ? 5 : Math.floor(this.range(3, 5));
      const h = floors * 3 + 0.4;
      const wall = this.pick([0xe0d6c8, 0xc7d3dd, 0xe8cfc0, 0xd5e0cf, 0xb8b0c8]);
      this.add(x0, 0, z0, x1, h, z1, wall, 'wall', true, true);
      this.windowsOn(x0, z0, x1, z1, 1.2, h, 3, 0.35);
      // parapet
      const pc = 0x8c8478;
      this.add(x0, h, z0, x1, h + 0.7, z0 + 0.3, pc, 'trim', true);
      this.add(x0, h, z1 - 0.3, x1, h + 0.7, z1, pc, 'trim', true);
      this.add(x0, h, z0, x0 + 0.3, h + 0.7, z1, pc, 'trim', true);
      this.add(x1 - 0.3, h, z0, x1, h + 0.7, z1, pc, 'trim', true);
      // balconies on the street side: climbable ledges every floor
      for (let f = 1; f < floors; f++) {
        for (let x = x0 + 1; x + 3 < x1; x += 4.5) {
          const off = (f % 2) * 1.5;
          const bx = Math.min(x + off, x1 - 3.5);
          this.add(bx, f * 3 - 0.25, z1, bx + 3, f * 3, z1 + 1.4, 0xa9a39a, 'stone', true, true);
          this.add(bx, f * 3, z1 + 1.25, bx + 3, f * 3 + 0.9, z1 + 1.4, 0x6c6f75, 'metal', false);
        }
      }
      // water tank on the roof
      this.addC(x0 + 3, h, z0 + 3, 2.4, 2.2, 2.4, 0x5e7f99, 'metal', true, true);
      this.addC(x0 + 3, h + 2.2, z0 + 3, 2.8, 0.4, 2.8, 0x4b6377, 'metal', true, false);
      // entrance canopy
      this.add((x0 + x1) / 2 - 1.5, 2.6, z1, (x0 + x1) / 2 + 1.5, 2.9, z1 + 1.6, 0x6d6875, 'stone', true, true);
      this.add((x0 + x1) / 2 - 0.9, 0, z1, (x0 + x1) / 2 + 0.9, 2.4, z1 + 0.07, 0x3d3d55, 'glass', false);
    }
    // courtyard
    this.tree(cx - 8, cz + 11);
    this.tree(cx + 8, cz + 11);
    this.bench(cx, cz + 11, 0);
  }

  private park(cx: number, cz: number) {
    this.add(cx - 14, 0.08, cz - 14, cx + 14, 0.1, cz + 14, 0x79c46a, 'grass', false);
    // pond
    this.add(cx - 5, 0.1, cz - 4, cx + 6, 0.13, cz + 5, 0x3fa7d6, 'water', false);
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      this.tree(cx + Math.cos(a) * 11, cz + Math.sin(a) * 11);
    }
    // little hill of blocks for movement
    this.addC(cx + 9, 0, cz - 8, 5, 1, 4, 0x5e9e4e, 'grass', true, true);
    this.addC(cx + 9.5, 1, cz - 8.5, 3, 1, 2.5, 0x5e9e4e, 'grass', true, true);
    this.bench(cx - 7, cz + 7, 0);
    this.bench(cx + 2, cz + 8, 0);
    // pagoda-like gazebo
    this.addC(cx - 9, 0, cz - 9, 0.4, 3, 0.4, 0x8b5a2b, 'wood', true);
    this.addC(cx - 5, 0, cz - 9, 0.4, 3, 0.4, 0x8b5a2b, 'wood', true);
    this.addC(cx - 9, 0, cz - 5, 0.4, 3, 0.4, 0x8b5a2b, 'wood', true);
    this.addC(cx - 5, 0, cz - 5, 0.4, 3, 0.4, 0x8b5a2b, 'wood', true);
    this.addC(cx - 7, 3, cz - 7, 6, 0.5, 6, 0x9c2f3a, 'roof', true, true);
    this.addC(cx - 7, 3.5, cz - 7, 3.6, 0.5, 3.6, 0x9c2f3a, 'roof', true, true);
  }

  private station(cx: number, cz: number) {
    // Morioh station: long hall with a climbable clock tower
    const x0 = cx - 14,
      x1 = cx + 14,
      z0 = cz - 10,
      z1 = cz + 4;
    this.add(x0, 0, z0, x1, 8, z1, 0xe8dcc8, 'wall', true, true);
    this.add(x0 - 0.5, 8, z0 - 0.5, x1 + 0.5, 8.6, z1 + 0.5, 0x3c5a8a, 'roof', true, true);
    this.windowsOn(x0, z0, x1, z1, 2.5, 8, 3, 0.5);
    this.add(cx - 4, 0, z1, cx + 4, 3.2, z1 + 0.1, 0x2f3542, 'glass', false);
    this.add(cx - 6, 3.6, z1, cx + 6, 4.0, z1 + 2.5, 0x3c5a8a, 'roof', true, true);
    // clock tower
    this.add(cx - 2.5, 8.6, cz - 6, cx + 2.5, 20, cz - 1, 0xd8c8a8, 'wall', true, true);
    this.add(cx - 3, 20, cz - 6.5, cx + 3, 20.6, cz - 0.5, 0x3c5a8a, 'roof', true, true);
    this.add(cx - 1.5, 20.6, cz - 5, cx + 1.5, 22.6, cz - 2, 0x3c5a8a, 'roof', true, true);
    // ledges up the tower
    for (let k = 0; k < 4; k++) {
      const y = 10.5 + k * 2.6;
      const side = k % 2 ? 1 : -1;
      this.add(cx + side * 2.5, y - 0.3, cz - 5, cx + side * 3.8, y, cz - 2, 0xa9a39a, 'stone', true, true);
    }
    this.signs.push({ pos: v3(cx, 16.5, cz - 0.9), yaw: 0, w: 3.6, h: 3.6, text: '@clock', bg: '#f8f1e0', fg: '#222' });
    this.signs.push({ pos: v3(cx, 5.5, z1 + 0.12), yaw: 0, w: 10, h: 1.6, text: 'MORIOH STATION', bg: '#2c3e8f', fg: '#ffe066' });
  }

  private plaza() {
    this.add(-25, 0, -25, 25, 0.1, 25, 0xd9cbb0, 'stone', false);
    // checker tiles ring
    for (let a = -24; a < 24; a += 4) {
      for (let b = -24; b < 24; b += 4) {
        if (((a + b) / 4) % 2 === 0) this.add(a, 0.1, b, a + 4, 0.11, b + 4, 0xc8b898, 'stone', false);
      }
    }
    // fountain
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const x = Math.cos(a) * 5;
      const z = Math.sin(a) * 5;
      this.addC(x, 0, z, 2.8, 0.9, 2.8, 0xb8ad9a, 'stone', true, true);
    }
    this.add(-4.4, 0.1, -4.4, 4.4, 0.7, 4.4, 0x5ec4ef, 'water', false);
    this.addC(0, 0, 0, 1.6, 3, 1.6, 0xcfc4b0, 'stone', true, true);
    this.addC(0, 3, 0, 3, 0.5, 3, 0xcfc4b0, 'stone', true, true);
    this.addC(0, 3.5, 0, 2.4, 0.3, 2.4, 0x5ec4ef, 'water', false);
    this.addC(0, 3.5, 0, 0.6, 1.6, 0.6, 0xcfc4b0, 'stone', true, true);
    // raised corner stages for verticality
    for (const [x, z] of [
      [-18, -18],
      [18, -18],
      [-18, 18],
      [18, 18],
    ]) {
      this.addC(x, 0, z, 6, 1.2, 6, 0xa79b86, 'stone', true, true);
      this.addC(x, 1.2, z, 3.4, 1.2, 3.4, 0xb6aa94, 'stone', true, true);
      this.tree(x, z, 2.4);
    }
    // flower beds
    for (const [x, z] of [
      [-11, 0],
      [11, 0],
      [0, 11],
      [0, -11],
    ]) {
      this.addC(x, 0, z, 3, 0.6, 3, 0x8a6a4a, 'wood', true, true);
      for (let k = 0; k < 5; k++) {
        this.addC(x + (this.rnd() - 0.5) * 2.2, 0.6, z + (this.rnd() - 0.5) * 2.2, 0.4, 0.4, 0.4, this.pick([0xff6b9d, 0xffd93d, 0xc77dff, 0xff4d4d]), 'leaf', false);
      }
    }
    for (const [x, z, yaw] of [
      [-8, 8, 0],
      [8, -8, 0],
      [-8, -8, Math.PI / 2],
      [8, 8, Math.PI / 2],
    ]) {
      this.bench(x, z, yaw);
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      this.lamp(Math.cos(a) * 22, Math.sin(a) * 22);
    }
  }

  private tree(x: number, z: number, y = 0) {
    const h = this.range(2.2, 3.2);
    this.addC(x, y, z, 0.6, h, 0.6, 0x7a5230, 'wood', true, true);
    const leaf = this.pick([0x3e9b48, 0x4caf50, 0x2f8a3e, 0x5fbf5a, 0xe58fb3]);
    this.addC(x, y + h, z, 3.2, 2, 3.2, leaf, 'leaf', false, true);
    this.addC(x, y + h + 2, z, 2, 1.2, 2, leaf, 'leaf', false, true);
  }

  private bench(x: number, z: number, yaw: number) {
    const along = Math.abs(Math.sin(yaw)) > 0.5;
    const sx = along ? 0.7 : 2.4;
    const sz = along ? 2.4 : 0.7;
    this.addC(x, 0, z, sx, 0.5, sz, 0x8b5a2b, 'wood', true, true);
  }

  private lamp(x: number, z: number) {
    this.addC(x, 0, z, 0.25, 4.2, 0.25, 0x2d3436, 'metal', true);
    this.addC(x, 4.2, z, 0.6, 0.5, 0.6, 0xfff2b0, 'lamp', false);
    this.addC(x, 4.7, z, 0.8, 0.15, 0.8, 0x2d3436, 'metal', false);
    this.lamps.push(v3(x, 4.4, z));
  }

  private car(x: number, z: number, alongX: boolean) {
    const c = this.pick([0xd63031, 0x0984e3, 0xfdcb6e, 0xf5f6fa, 0x2d3436, 0x00b894]);
    const L = 4.2,
      W = 1.9;
    const sx = alongX ? L : W;
    const sz = alongX ? W : L;
    this.addC(x, 0.3, z, sx, 0.9, sz, c, 'metal', true, true);
    this.addC(x, 1.2, z, alongX ? 2.4 : 1.7, 0.7, alongX ? 1.7 : 2.4, 0x9fd4f2, 'glass', true, true);
    this.addC(x, 0, z, sx - 0.4, 0.35, sz - 0.4, 0x222222, 'metal', false);
  }

  private streetProps(roads: number[]) {
    for (const r of roads) {
      if (Math.abs(r) === 100) continue;
      for (let t = -95; t <= 95; t += 19) {
        if (Math.abs(t) < 26 && Math.abs(r) < 26) continue;
        this.lamp(r + 5.6, t + 3);
        this.lamp(t + 3, r - 5.6);
        if (this.rnd() < 0.35) this.car(r - 3, t + 9, false);
        if (this.rnd() < 0.35) this.car(t + 9, r + 3, true);
      }
    }
    // a few utility poles with sagging wires feel very Morioh
    for (let t = -90; t <= 90; t += 30) {
      this.addC(-54.4, 0, t, 0.35, 8, 0.35, 0x6b5a4a, 'wood', true);
      this.addC(-54.4, 7, t, 2.2, 0.2, 0.2, 0x6b5a4a, 'wood', false);
    }
  }

  private boundary() {
    const B = WORLD_BOUND + 4;
    // tall hedge wall around the playable town
    for (let t = -B; t < B; t += 4) {
      for (const [x, z] of [
        [t, -B],
        [t, B],
        [-B, t],
        [B, t],
      ]) {
        this.addC(x + 2 * (z === -B || z === B ? 1 : 0), 0, z + 2 * (x === -B || x === B ? 1 : 0), 4.2, 4 + ((t * 7) % 3), 4.2, 0x2f7a3a, 'leaf', true, true);
      }
    }
    // distant blocky mountains (visual only)
    const mr = mulberry32(99);
    for (let k = 0; k < 26; k++) {
      const a = (k / 26) * Math.PI * 2;
      if (Math.sin(a) > 0.55) continue; // leave the sea view open to the south
      const d = 190 + mr() * 40;
      const h = 25 + mr() * 45;
      const s = 40 + mr() * 30;
      const x = Math.cos(a) * d;
      const z = -Math.sin(a) * d * -1;
      this.addC(x, 0, z, s, h, s, 0x5d8a6a, 'grass', false);
      this.addC(x, h, z, s * 0.6, h * 0.35, s * 0.6, 0x6f9c78, 'grass', false);
    }
    this.add(-400, -0.6, 150, 400, -0.05, 400, 0x2f86c9, 'water', false);
  }

  // ---------------------------------------------------------------- spatial grid
  private key(ix: number, iz: number) {
    return (ix + 1000) * 4096 + (iz + 1000);
  }
  private insert(b: WBox, idx: number) {
    const c = this.cell;
    for (let ix = Math.floor(b.min.x / c); ix <= Math.floor(b.max.x / c); ix++) {
      for (let iz = Math.floor(b.min.z / c); iz <= Math.floor(b.max.z / c); iz++) {
        const k = this.key(ix, iz);
        let arr = this.grid.get(k);
        if (!arr) this.grid.set(k, (arr = []));
        arr.push(idx);
      }
    }
  }

  /** Collect solid boxes overlapping an AABB. */
  query(minx: number, miny: number, minz: number, maxx: number, maxy: number, maxz: number, out: WBox[]): WBox[] {
    out.length = 0;
    this.stamp++;
    const c = this.cell;
    for (let ix = Math.floor(minx / c); ix <= Math.floor(maxx / c); ix++) {
      for (let iz = Math.floor(minz / c); iz <= Math.floor(maxz / c); iz++) {
        const arr = this.grid.get(this.key(ix, iz));
        if (!arr) continue;
        for (const i of arr) {
          if (this.marks[i] === this.stamp) continue;
          this.marks[i] = this.stamp;
          const b = this.solids[i];
          if (b.max.x > minx && b.min.x < maxx && b.max.y > miny && b.min.y < maxy && b.max.z > minz && b.min.z < maxz) out.push(b);
        }
      }
    }
    return out;
  }

  private tmp: WBox[] = [];
  /** Distance along the ray to the first solid box (or ground), capped at maxDist. */
  raycast(o: V3, d: V3, maxDist: number): number {
    const ex = o.x + d.x * maxDist,
      ey = o.y + d.y * maxDist,
      ez = o.z + d.z * maxDist;
    const list = this.query(Math.min(o.x, ex) - 0.1, Math.min(o.y, ey) - 0.1, Math.min(o.z, ez) - 0.1, Math.max(o.x, ex) + 0.1, Math.max(o.y, ey) + 0.1, Math.max(o.z, ez) + 0.1, this.tmp);
    let best = maxDist;
    if (d.y < -1e-6) best = Math.min(best, (o.y - 0) / -d.y);
    for (const b of list) {
      let tmin = 0,
        tmax = best;
      let ok = true;
      for (const ax of ['x', 'y', 'z'] as const) {
        const inv = 1 / (d[ax] || 1e-9);
        let t0 = (b.min[ax] - o[ax]) * inv;
        let t1 = (b.max[ax] - o[ax]) * inv;
        if (t0 > t1) [t0, t1] = [t1, t0];
        tmin = Math.max(tmin, t0);
        tmax = Math.min(tmax, t1);
        if (tmax < tmin) {
          ok = false;
          break;
        }
      }
      if (ok && tmin < best) best = tmin;
    }
    return Math.max(0, best);
  }

  /** Highest solid surface below a point (used for spawning and AI). */
  groundHeight(x: number, z: number, fromY = 60): number {
    const list = this.query(x - 0.3, -1, z - 0.3, x + 0.3, fromY, z + 0.3, this.tmp);
    let h = 0;
    for (const b of list) if (b.max.y <= fromY && b.max.y > h) h = b.max.y;
    return h;
  }
}

export interface Body {
  pos: V3;
  vel: V3;
  grounded: boolean;
}

export const BODY_R = 0.35;
export const BODY_H = 1.85;
const scratch: WBox[] = [];

/**
 * Axis-separated swept movement of a fighter-sized box through the world with step-up.
 * Returns true when the body bumped into a wall horizontally.
 */
export function moveBody(world: World, body: Body, dt: number): boolean {
  const p = body.pos;
  const v = body.vel;
  const maxDisp = Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)) * dt;
  const steps = Math.min(8, Math.max(1, Math.ceil(maxDisp / 0.3)));
  const sdt = dt / steps;
  const r = BODY_R;
  const h = BODY_H;
  let bumped = false;
  const wasGrounded = body.grounded;
  body.grounded = false;
  for (let s = 0; s < steps; s++) {
    for (const ax of ['x', 'z'] as const) {
      const dv = v[ax] * sdt;
      if (dv === 0) continue;
      p[ax] += dv;
      const list = world.query(p.x - r, p.y + 0.01, p.z - r, p.x + r, p.y + h, p.z + r, scratch);
      for (const b of list) {
        const rise = b.max.y - p.y;
        const canStep = rise <= STEP_HEIGHT && (wasGrounded || v.y <= 0);
        const canMantle = !wasGrounded && rise > 0 && rise <= MANTLE_HEIGHT;
        if (canStep || canMantle) {
          // step up if there is head room
          const above = world.query(p.x - r, b.max.y + 0.01, p.z - r, p.x + r, b.max.y + h, p.z + r, []);
          if (above.length === 0) {
            p.y = b.max.y;
            if (canMantle && v.y < 0) v.y = 0;
            continue;
          }
        }
        if (dv > 0) p[ax] = Math.min(p[ax], b.min[ax] - r - 1e-4);
        else p[ax] = Math.max(p[ax], b.max[ax] + r + 1e-4);
        v[ax] = 0;
        bumped = true;
      }
    }
    p.y += v.y * sdt;
    if (p.y <= 0) {
      p.y = 0;
      if (v.y < 0) v.y = 0;
      body.grounded = true;
    }
    const list = world.query(p.x - r + 0.02, p.y, p.z - r + 0.02, p.x + r - 0.02, p.y + h, p.z + r - 0.02, scratch);
    for (const b of list) {
      if (v.y <= 0 && b.max.y - p.y < 0.9) {
        p.y = b.max.y;
        v.y = 0;
        body.grounded = true;
      } else if (v.y > 0 && b.min.y > p.y) {
        p.y = b.min.y - h - 1e-4;
        v.y = 0;
      }
    }
  }
  // ground probe so we stay grounded while standing still on a roof
  if (!body.grounded && v.y <= 0) {
    const under = world.query(p.x - r + 0.02, p.y - 0.06, p.z - r + 0.02, p.x + r - 0.02, p.y, p.z + r - 0.02, scratch);
    if (under.length || p.y <= 0.001) body.grounded = true;
  }
  const B = WORLD_BOUND;
  if (p.x > B) p.x = B;
  if (p.x < -B) p.x = -B;
  if (p.z > B) p.z = B;
  if (p.z < -B) p.z = -B;
  return bumped;
}
