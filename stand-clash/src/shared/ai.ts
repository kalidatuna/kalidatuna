// Bot brains: produce FighterInput each tick from the simulation state.
import type { Sim, Fighter, FighterInput } from './sim';
import { vdist, vdistXZ, yawTo, v3, mulberry32 } from './math';

export type DummyMode = 'idle' | 'block' | 'jump' | 'fight' | 'perfect';

export interface BotOpts {
  level: number; // 0..1 difficulty
  boss?: boolean;
  dummy?: DummyMode;
  leash?: { x: number; z: number; r: number };
}

let seedCounter = 1;

export class BotBrain {
  private rnd: () => number;
  private targetId = 0;
  private retarget = 0;
  private attackT = 0;
  private strafeDir = 1;
  private strafeT = 0;
  private stuckT = 0;
  private blockUntil = 0;
  private seenAction = new Map<number, number>();
  private wanderT = 0;
  private wander = { x: 0, z: 0 };
  private jumpT = 0;
  private time = 0;

  constructor(public opts: BotOpts) {
    this.rnd = mulberry32(1234 + seedCounter++ * 97);
  }

  think(sim: Sim, f: Fighter, dt: number, inp: FighterInput) {
    this.time += dt;
    inp.mx = 0;
    inp.mz = 0;
    inp.block = false;
    const L = this.opts.level;
    const rnd = this.rnd;

    if (this.opts.dummy && this.opts.dummy !== 'fight') {
      const near = sim.nearestEnemy(f, 30);
      if (near) {
        inp.yaw = yawTo(f.pos, near.pos);
      }
      if (this.opts.dummy === 'block') inp.block = true;
      if (this.opts.dummy === 'perfect' && near) {
        // tap block right as an attack starts to demonstrate perfect blocks
        const a = near.action;
        if (a && a.t < 0.12 && vdist(f.pos, near.pos) < 5) this.blockUntil = this.time + 0.35;
        inp.block = this.time < this.blockUntil;
      }
      if (this.opts.dummy === 'jump') {
        this.jumpT -= dt;
        if (this.jumpT <= 0 && f.grounded) {
          inp.jump = true;
          this.jumpT = 1.3;
        }
      }
      return;
    }

    this.retarget -= dt;
    let target = sim.byId.get(this.targetId);
    if (!target || target.dead || this.retarget <= 0) {
      target = sim.nearestEnemy(f, this.opts.boss ? 200 : 70) ?? undefined;
      this.targetId = target?.id ?? 0;
      this.retarget = 0.6;
    }
    if (!target) {
      this.idleWander(f, dt, inp);
      return;
    }

    const d = vdist(f.pos, target.pos);
    const dxz = vdistXZ(f.pos, target.pos);
    const yaw = yawTo(f.pos, target.pos);
    inp.yaw = yaw;
    inp.pitch = Math.atan2(target.pos.y + 0.6 - (f.pos.y + 1.4), Math.max(dxz, 0.1));
    const dirX = Math.sin(yaw);
    const dirZ = Math.cos(yaw);

    // Leash: free-roam enemies give up when dragged too far from home
    if (this.opts.leash) {
      const h = this.opts.leash;
      if (Math.hypot(f.pos.x - h.x, f.pos.z - h.z) > h.r && d > 10) {
        const hy = Math.atan2(h.x - f.pos.x, h.z - f.pos.z);
        inp.mx = Math.sin(hy);
        inp.mz = Math.cos(hy);
        return;
      }
    }

    if (f.def.standName && !f.standOut && d < 22 && f.standCd <= 0 && !f.action) inp.summon = true;

    // Defensive reaction to the target's attacks
    const ta = target.action;
    if (ta && d < 5 && (ta.id === 'combo' || ta.id === 'barrage' || ta.id === 'uppercut')) {
      const key = target.id * 10 + ta.step;
      const seen = this.seenAction.get(target.id);
      if (seen !== key + ta.id.length * 1000) {
        this.seenAction.set(target.id, key + ta.id.length * 1000);
        const chance = (ta.id === 'barrage' ? 0.55 : 0.3) * L;
        if (rnd() < chance) this.blockUntil = this.time + (ta.id === 'barrage' ? 1.2 : 0.4) + rnd() * 0.2;
      }
    } else if (!ta) this.seenAction.delete(target.id);
    if (this.time < this.blockUntil && !f.action) {
      inp.block = true;
      return;
    }

    const myTS = sim.timeStop?.caster === f.id;
    const kit = f.def.abilities;
    const hpRatio = f.hp / f.maxHp;

    // Time stop: bosses and skilled bots use it when the target is close
    if (kit.timestop && !sim.timeStop && d < 14 && (this.opts.boss ? hpRatio < 0.92 : L > 0.6 && hpRatio < 0.7)) {
      if (rnd() < (this.opts.boss ? 0.02 : 0.006) && sim.canUse(f, 'timestop')) {
        inp.timestop = true;
        return;
      }
    }

    // Gunner keeps distance and shoots
    if (f.char === 'gunner') {
      let mv = 0;
      if (d < 8) mv = -1;
      else if (d > 17) mv = 1;
      this.strafe(dt);
      inp.mx = dirX * mv + Math.cos(yaw) * this.strafeDir * 0.6;
      inp.mz = dirZ * mv - Math.sin(yaw) * this.strafeDir * 0.6;
      const los = sim.world.raycast(v3(f.pos.x, f.pos.y + 1.5, f.pos.z), v3(dirX * Math.cos(inp.pitch), Math.sin(inp.pitch), dirZ * Math.cos(inp.pitch)), d) >= d - 0.6;
      if (los && d < 30 && rnd() < 0.05 + 0.05 * L) inp.heavy = true;
      if (d < 2.5 && rnd() < 0.08) inp.attack = true;
      this.unstick(f, dt, inp, mv !== 0);
      return;
    }

    // DIO-style ranged poke
    if (kit.knives && d > 5 && d < 24 && rnd() < 0.012 + 0.02 * L * (myTS ? 4 : 1)) inp.heavy = true;

    const range = 2.0;
    let wantMove = false;
    if (dxz > range + 0.5) {
      inp.mx = dirX;
      inp.mz = dirZ;
      wantMove = true;
      if (dxz > 10 && rnd() < 0.015 + 0.02 * L) {
        if (kit.leap && f.standOut && dxz < 16) inp.dash = true;
        else if (f.dashCd <= 0 && f.grounded) inp.dash = true;
      }
    } else {
      this.strafe(dt);
      inp.mx = Math.cos(yaw) * this.strafeDir * 0.35;
      inp.mz = -Math.sin(yaw) * this.strafeDir * 0.35;
      this.attackT -= dt;
      if (this.attackT <= 0) {
        inp.attack = true;
        this.attackT = 0.18 + (1 - L) * 0.55 + rnd() * 0.25;
      }
      if (kit.barrage && rnd() < 0.008 + 0.025 * L + (myTS ? 0.2 : 0)) inp.barrage = true;
      if (kit.uppercut && rnd() < 0.006 + 0.02 * L) inp.heavy = true;
      if (kit.evade && hpRatio < 0.4 && rnd() < 0.01 * L) inp.dash = true;
    }
    // vertical chase
    if (target.pos.y - f.pos.y > 1.4 && dxz < 9) {
      this.jumpT -= dt;
      if (f.grounded && this.jumpT <= 0) {
        inp.jump = true;
        this.jumpT = 0.4;
      } else if (!f.grounded && f.vel.y < 1.5 && f.airJumps > 0) inp.jump = true;
    }
    this.unstick(f, dt, inp, wantMove);
  }

  private strafe(dt: number) {
    this.strafeT -= dt;
    if (this.strafeT <= 0) {
      this.strafeDir = this.rnd() < 0.5 ? -1 : 1;
      this.strafeT = 0.8 + this.rnd() * 1.6;
    }
  }

  private unstick(f: Fighter, dt: number, inp: FighterInput, wantMove: boolean) {
    const hv = Math.hypot(f.vel.x, f.vel.z);
    if (wantMove && hv < 1.5 && f.grounded && !f.action) this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt);
    if (this.stuckT > 0.35) {
      inp.jump = true;
      this.stuckT = 0;
      // sidestep around obstacles
      this.strafeDir *= -1;
    }
    if (!f.grounded && f.vel.y < 0 && this.stuckT > 0.1 && f.airJumps > 0) inp.jump = true;
    if (this.stuckT > 0.15) {
      const sx = Math.cos(f.yaw) * this.strafeDir;
      const sz = -Math.sin(f.yaw) * this.strafeDir;
      inp.mx += sx;
      inp.mz += sz;
    }
  }

  private idleWander(f: Fighter, dt: number, inp: FighterInput) {
    this.wanderT -= dt;
    if (this.wanderT <= 0) {
      this.wanderT = 2 + this.rnd() * 3;
      const h = this.opts.leash ?? { x: f.pos.x, z: f.pos.z, r: 10 };
      this.wander = { x: h.x + (this.rnd() - 0.5) * 16, z: h.z + (this.rnd() - 0.5) * 16 };
    }
    const dx = this.wander.x - f.pos.x;
    const dz = this.wander.z - f.pos.z;
    const l = Math.hypot(dx, dz);
    if (l > 1.5) {
      inp.mx = (dx / l) * 0.45;
      inp.mz = (dz / l) * 0.45;
      inp.yaw = Math.atan2(dx, dz);
    }
    this.unstick(f, dt, inp, l > 1.5);
  }
}
