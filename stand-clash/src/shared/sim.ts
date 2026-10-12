// Authoritative-capable fighting simulation shared by the browser (single player / prediction)
// and the multiplayer server. No rendering code lives here.
import {
  V3,
  v3,
  vcopy,
  vdist,
  fwdXZ,
  aimDir,
  clamp,
  dampAngle,
  wrapAngle,
  yawTo,
  vlenXZ,
} from './math';
import { World, moveBody, BODY_H, BODY_R } from './world';
import {
  AbilityDef,
  AbilityId,
  CharDef,
  CharId,
  CHARACTERS,
  COMBO_HITS_BARE,
  COMBO_HITS_STAND,
  COMBO_STEP_TIME,
  HitDef,
  MOVE,
  BLOCK,
  TIMESTOP_RADIUS,
  KNIFE,
  BULLET,
} from './characters';
import { BotBrain } from './ai';

export interface FighterInput {
  mx: number;
  mz: number;
  yaw: number;
  pitch: number;
  block: boolean;
  jump: boolean;
  dash: boolean;
  attack: boolean;
  barrage: boolean;
  heavy: boolean;
  timestop: boolean;
  summon: boolean;
  pose: boolean;
}

export const emptyInput = (): FighterInput => ({
  mx: 0,
  mz: 0,
  yaw: 0,
  pitch: 0,
  block: false,
  jump: false,
  dash: false,
  attack: false,
  barrage: false,
  heavy: false,
  timestop: false,
  summon: false,
  pose: false,
});

export const EDGE_KEYS = ['jump', 'dash', 'attack', 'barrage', 'heavy', 'timestop', 'summon', 'pose'] as const;
export type EdgeKey = (typeof EDGE_KEYS)[number];

export interface ActionState {
  id: AbilityId;
  t: number;
  step: number;
  nextHit: number;
  yaw: number;
  pitch: number;
  landed: boolean;
}

export interface FighterStats {
  kos: number;
  deaths: number;
  dmg: number;
  maxCombo: number;
  hits: number;
}

export interface Fighter {
  id: number;
  name: string;
  char: CharId;
  def: CharDef;
  team: number;
  isBot: boolean;
  remote: boolean;
  /** Network puppet: state is written from snapshots, the local sim never steps it. */
  puppet: boolean;
  pos: V3;
  vel: V3;
  yaw: number;
  aimYaw: number;
  aimPitch: number;
  grounded: boolean;
  airJumps: number;
  airDash: number;
  coyote: number;
  dashT: number;
  dashCd: number;
  dashDir: V3;
  dashSpeed: number;
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  dmgMul: number;
  standOut: boolean;
  standCd: number;
  action: ActionState | null;
  cds: Partial<Record<AbilityId, number>>;
  blocking: boolean;
  blockT: number;
  stun: number;
  launched: boolean;
  frozen: boolean;
  dead: boolean;
  deadT: number;
  respawnDelay: number; // <0 disables automatic respawn
  invuln: number;
  immortal: boolean;
  combo: number;
  comboT: number;
  comboDmg: number;
  bufAttack: number;
  lastHitT: number;
  lastKoT: number;
  hitFlash: number;
  stats: FighterStats;
  brain: BotBrain | null;
  /** Visual-only boost flag: last air jump used the Stand. */
  boostT: number;
}

export interface Projectile {
  id: number;
  owner: number;
  kind: 'knife' | 'bullet';
  pos: V3;
  vel: V3;
  age: number;
  life: number;
  frozen: boolean;
  stuck: boolean;
  dmg: number;
  stun: number;
  kbH: number;
  kbV: number;
}

export interface TimeStopState {
  caster: number;
  t: number;
  dur: number;
  center: V3;
  radius: number;
}

export type SimEvent =
  | {
      k: 'hit';
      a: number;
      v: number;
      dmg: number;
      pos: V3;
      kb: V3;
      stun: number;
      blocked: boolean;
      perfect: boolean;
      heavy: boolean;
      queued: boolean;
      combo: number;
      ab: AbilityId | 'proj' | 'resume';
    }
  | { k: 'ko'; a: number; v: number }
  | { k: 'announce'; text: string; id: number; style?: string }
  | { k: 'action'; id: number; ab: AbilityId; step: number }
  | { k: 'summon'; id: number; out: boolean }
  | { k: 'dash'; id: number; special: boolean }
  | { k: 'jump'; id: number; air: boolean; boost: boolean }
  | { k: 'land'; id: number; hard: boolean }
  | { k: 'ts'; phase: 'windup' | 'start' | 'end'; caster: number; pos: V3; dur: number }
  | { k: 'proj'; kind: 'knife' | 'bullet'; pos: V3; owner: number }
  | { k: 'stagger'; id: number; t: number }
  | { k: 'respawn'; id: number; pos: V3 }
  | { k: 'guardbreak'; id: number };

interface QueuedHit {
  a: number;
  v: number;
  dmg: number;
  kb: V3;
  stun: number;
}

export class Sim {
  fighters: Fighter[] = [];
  byId = new Map<number, Fighter>();
  projectiles: Projectile[] = [];
  inputs = new Map<number, FighterInput>();
  events: SimEvent[] = [];
  timeStop: TimeStopState | null = null;
  tsQueue: QueuedHit[] = [];
  time = 0;
  nextId = 1;
  nextProj = 1;
  /** When false (multiplayer client prediction) no hits, KOs or projectiles are resolved. */
  authority = true;
  /** When true the time stop timer is driven externally (multiplayer client). */
  externalTimeStop = false;
  /** Free-for-all: every fighter is an enemy of every other fighter. */
  ffa = false;
  onKO: ((a: Fighter | undefined, v: Fighter) => void) | null = null;
  spawnFn: ((f: Fighter) => V3) | null = null;

  constructor(public world: World) {}

  addFighter(char: CharId, opts: Partial<Pick<Fighter, 'name' | 'team' | 'isBot' | 'remote' | 'id'>> & { pos?: V3; hpMul?: number; dmgMul?: number } = {}): Fighter {
    const def = CHARACTERS[char];
    const id = opts.id ?? this.nextId++;
    if (id >= this.nextId) this.nextId = id + 1;
    const hp = Math.round(def.maxHp * (opts.hpMul ?? 1));
    const f: Fighter = {
      id,
      name: opts.name ?? def.name,
      char,
      def,
      team: opts.team ?? 0,
      isBot: opts.isBot ?? false,
      remote: opts.remote ?? false,
      puppet: false,
      pos: opts.pos ? vcopy(opts.pos) : v3(),
      vel: v3(),
      yaw: 0,
      aimYaw: 0,
      aimPitch: 0,
      grounded: true,
      airJumps: 1,
      airDash: 1,
      coyote: 0,
      dashT: 0,
      dashCd: 0,
      dashDir: v3(),
      dashSpeed: MOVE.dashSpeed,
      hp,
      maxHp: hp,
      energy: def.maxEnergy,
      maxEnergy: def.maxEnergy,
      dmgMul: opts.dmgMul ?? 1,
      standOut: false,
      standCd: 0,
      action: null,
      cds: {},
      blocking: false,
      blockT: 0,
      stun: 0,
      launched: false,
      frozen: false,
      dead: false,
      deadT: 0,
      respawnDelay: 3,
      invuln: 0,
      immortal: false,
      combo: 0,
      comboT: 0,
      comboDmg: 0,
      bufAttack: 0,
      lastHitT: -99,
      lastKoT: -99,
      hitFlash: 0,
      stats: { kos: 0, deaths: 0, dmg: 0, maxCombo: 0, hits: 0 },
      brain: null,
      boostT: 0,
    };
    this.fighters.push(f);
    this.byId.set(id, f);
    return f;
  }

  removeFighter(id: number) {
    const f = this.byId.get(id);
    if (!f) return;
    this.fighters.splice(this.fighters.indexOf(f), 1);
    this.byId.delete(id);
    this.inputs.delete(id);
    if (this.timeStop?.caster === id) this.endTimeStop();
  }

  isEnemy(a: Fighter, b: Fighter) {
    return a !== b && (this.ffa || a.team !== b.team);
  }

  input(id: number): FighterInput {
    let i = this.inputs.get(id);
    if (!i) this.inputs.set(id, (i = emptyInput()));
    return i;
  }

  emit(e: SimEvent) {
    this.events.push(e);
  }

  // ------------------------------------------------------------------ main step
  step(dt: number) {
    this.time += dt;
    this.updateTimeStop(dt);
    for (const f of this.fighters) {
      if (f.brain && !f.dead && !f.frozen && !f.puppet) f.brain.think(this, f, dt, this.input(f.id));
    }
    for (const f of this.fighters) this.updateFighter(f, dt);
    this.separate();
    this.updateProjectiles(dt);
    for (const id of this.inputs.keys()) {
      const i = this.inputs.get(id)!;
      for (const k of EDGE_KEYS) i[k] = false;
    }
  }

  private updateFighter(f: Fighter, dt: number) {
    if (f.frozen || f.puppet) return;
    const inp = this.input(f.id);
    if (f.hitFlash > 0) f.hitFlash -= dt;
    if (f.boostT > 0) f.boostT -= dt;
    if (f.comboT > 0) {
      f.comboT -= dt;
      if (f.comboT <= 0) {
        f.combo = 0;
        f.comboDmg = 0;
      }
    }
    if (f.dead) {
      f.deadT += dt;
      if (!f.remote) this.integrate(f, dt, 0, 0, 0.5);
      if (this.authority && f.respawnDelay >= 0 && f.deadT >= f.respawnDelay) this.respawn(f);
      return;
    }
    for (const k in f.cds) {
      const key = k as AbilityId;
      const c = f.cds[key]!;
      if (c > 0) f.cds[key] = c - dt;
    }
    if (f.dashCd > 0) f.dashCd -= dt;
    if (f.standCd > 0) f.standCd -= dt;
    if (f.invuln > 0) f.invuln -= dt;
    if (f.bufAttack > 0) f.bufAttack -= dt;
    if (f.immortal && this.time - f.lastHitT > 2.5 && f.hp < f.maxHp) f.hp = f.maxHp;

    const casterInStop = this.timeStop?.caster === f.id;
    if (!casterInStop) {
      const posing = f.action?.id === 'pose';
      const regen = (f.standOut ? 7 : 13) * (posing ? 3 : 1);
      f.energy = Math.min(f.maxEnergy, f.energy + regen * dt);
    }

    f.aimPitch = clamp(inp.pitch, -1.2, 1.2);
    let moveMul = 1;
    if (f.stun > 0) {
      f.stun -= dt;
      f.blocking = false;
      if (f.stun <= 0 && f.launched && !f.grounded) f.stun = 0.05; // stay stunned while tumbling
      moveMul = 0;
    } else {
      f.aimYaw = inp.yaw;
      this.handleInput(f, inp);
      if (f.action) {
        const def = f.def.abilities[f.action.id];
        moveMul = def ? def.moveMul : 1;
        if (f.action.id === 'combo') moveMul = 0.35;
      }
      if (f.blocking) moveMul = Math.min(moveMul, 0.4);
    }
    if (f.blocking) f.blockT += dt;

    // facing
    if (f.action || f.blocking) {
      const target = f.action ? f.action.yaw : f.aimYaw;
      f.yaw = dampAngle(f.yaw, target, f.action?.id === 'barrage' ? 8 : 30, dt);
    } else if (f.stun <= 0 && (inp.mx || inp.mz)) {
      f.yaw = dampAngle(f.yaw, Math.atan2(inp.mx, inp.mz), 14, dt);
    }

    if (f.action) this.updateAction(f, dt);
    if (!f.remote) {
      const ml = Math.hypot(inp.mx, inp.mz);
      const nx = ml > 1 ? inp.mx / ml : inp.mx;
      const nz = ml > 1 ? inp.mz / ml : inp.mz;
      this.integrate(f, dt, nx * moveMul, nz * moveMul, f.stun > 0 ? 0.25 : 1);
    }
  }

  /** Soft push-apart so fighters never stand inside each other. */
  private separate() {
    const list = this.fighters;
    const minD = BODY_R * 2 + 0.1;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.dead) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.dead || Math.abs(a.pos.y - b.pos.y) > BODY_H * 0.8) continue;
        let dx = b.pos.x - a.pos.x;
        let dz = b.pos.z - a.pos.z;
        let d = Math.hypot(dx, dz);
        if (d >= minD) continue;
        if (d < 1e-4) {
          dx = 1;
          dz = 0;
          d = 1;
        }
        const push = (minD - d) * 0.5;
        const am = !a.remote && !a.puppet && !a.frozen;
        const bm = !b.remote && !b.puppet && !b.frozen;
        const share = am && bm ? 0.5 : 1;
        if (am) {
          a.pos.x -= (dx / d) * push * 2 * share;
          a.pos.z -= (dz / d) * push * 2 * share;
        }
        if (bm) {
          b.pos.x += (dx / d) * push * 2 * share;
          b.pos.z += (dz / d) * push * 2 * share;
        }
      }
    }
  }

  private integrate(f: Fighter, dt: number, mx: number, mz: number, control: number) {
    const wasGrounded = f.grounded;
    const prevVy = f.vel.y;
    if (f.dashT > 0) {
      f.dashT -= dt;
      f.vel.x = f.dashDir.x * f.dashSpeed;
      f.vel.z = f.dashDir.z * f.dashSpeed;
      f.vel.y = Math.max(f.vel.y, 0);
      if (f.dashT <= 0) {
        f.vel.x *= 0.55;
        f.vel.z *= 0.55;
      }
    } else {
      const speed = f.def.speed;
      const tx = mx * speed;
      const tz = mz * speed;
      const accel = (f.grounded ? MOVE.accelGround : MOVE.accelAir) * control;
      const hv = vlenXZ(f.vel);
      // Preserve excess momentum in the air (dashes, leaps) while still allowing steering
      if (!f.grounded && hv > speed && (mx || mz)) {
        f.vel.x += mx * accel * 0.5 * dt;
        f.vel.z += mz * accel * 0.5 * dt;
        const s = vlenXZ(f.vel);
        if (s > hv) {
          f.vel.x *= hv / s;
          f.vel.z *= hv / s;
        }
      } else {
        const dx = tx - f.vel.x;
        const dz = tz - f.vel.z;
        const dl = Math.hypot(dx, dz);
        const maxStep = (f.grounded || mx || mz ? accel : accel * 0.15) * dt;
        if (dl <= maxStep) {
          f.vel.x = tx;
          f.vel.z = tz;
        } else {
          f.vel.x += (dx / dl) * maxStep;
          f.vel.z += (dz / dl) * maxStep;
        }
      }
      f.vel.y = Math.max(MOVE.maxFall, f.vel.y - MOVE.gravity * dt);
    }
    moveBody(this.world, f, dt);
    if (f.grounded) {
      if (!wasGrounded) {
        this.emit({ k: 'land', id: f.id, hard: prevVy < -18 });
        if (f.launched) {
          f.launched = false;
          f.stun = Math.max(f.stun, 0.3);
        }
      }
      f.airJumps = 1;
      f.airDash = 1;
      f.coyote = MOVE.coyote;
    } else if (f.coyote > 0) f.coyote -= dt;
  }

  // ------------------------------------------------------------------ input → actions
  private handleInput(f: Fighter, inp: FighterInput) {
    const free = !f.action || f.action.id === 'pose';
    if (inp.block && (free || f.action?.id === 'combo') && f.dashT <= 0) {
      if (f.action) f.action = null;
      if (!f.blocking) {
        f.blocking = true;
        f.blockT = 0;
      }
    } else if (!inp.block) f.blocking = false;

    if (f.action?.id === 'pose' && (inp.mx || inp.mz || inp.jump || inp.attack || inp.dash)) f.action = null;

    if (inp.summon && f.def.standName && f.standCd <= 0 && (!f.action || f.action.id === 'pose')) {
      f.standOut = !f.standOut;
      f.standCd = 0.3;
      this.emit({ k: 'summon', id: f.id, out: f.standOut });
    }
    if (inp.attack) f.bufAttack = 0.3;
    if (f.blocking) return;

    if (inp.pose && !f.action && f.grounded) this.tryAbility(f, 'pose');
    if (inp.timestop) this.tryAbility(f, 'timestop');
    if (inp.barrage) this.tryAbility(f, 'barrage');
    if (inp.heavy && f.def.heavyKey) this.tryAbility(f, f.def.heavyKey);
    if (f.bufAttack > 0 && !f.action) {
      this.startAction(f, 'combo');
      f.bufAttack = 0;
    }
    if (inp.dash) {
      if (f.standOut && f.def.specialMove && (f.cds[f.def.specialMove] ?? 0) <= 0) this.tryAbility(f, f.def.specialMove);
      else this.dash(f, inp);
    }
    if (inp.jump) this.jump(f);
  }

  private dash(f: Fighter, inp: FighterInput) {
    if (f.dashCd > 0) return;
    if (f.action && f.action.id !== 'combo' && f.action.id !== 'pose') return;
    if (!f.grounded && f.airDash <= 0) return;
    if (!f.grounded) f.airDash--;
    f.action = null;
    const ml = Math.hypot(inp.mx, inp.mz);
    f.dashDir = ml > 0.1 ? v3(inp.mx / ml, 0, inp.mz / ml) : fwdXZ(f.aimYaw);
    f.dashT = MOVE.dashTime;
    f.dashSpeed = MOVE.dashSpeed;
    f.dashCd = MOVE.dashCooldown;
    if (!f.remote) f.vel.y = Math.max(f.vel.y, f.grounded ? 0 : 2);
    this.emit({ k: 'dash', id: f.id, special: false });
  }

  private jump(f: Fighter) {
    if (f.action && f.action.id !== 'pose' && f.action.id !== 'combo') return;
    if (f.action?.id === 'combo') f.action = null;
    if (f.grounded || f.coyote > 0) {
      f.vel.y = MOVE.jumpVel;
      f.grounded = false;
      f.coyote = 0;
      this.emit({ k: 'jump', id: f.id, air: false, boost: false });
    } else if (f.airJumps > 0) {
      f.airJumps--;
      const boost = f.standOut && f.energy >= 6;
      if (boost) f.energy -= 6;
      f.vel.y = boost ? MOVE.standBoostVel : MOVE.airJumpVel;
      if (boost) f.boostT = 0.5;
      this.emit({ k: 'jump', id: f.id, air: true, boost });
    }
  }

  canUse(f: Fighter, id: AbilityId): AbilityDef | null {
    const def = f.def.abilities[id];
    if (!def || f.dead || f.frozen || f.stun > 0) return null;
    if ((f.cds[id] ?? 0) > 0.05) return null;
    if (f.energy < def.energy) return null;
    if (def.needsStand && !f.def.standName) return null;
    if (f.action && f.action.id !== 'pose' && !(f.action.id === 'combo' && id !== 'combo')) return null;
    if (this.timeStop && id === 'timestop') return null;
    return def;
  }

  tryAbility(f: Fighter, id: AbilityId): boolean {
    const def = this.canUse(f, id);
    if (!def) return false;
    if (def.needsStand && !f.standOut) {
      f.standOut = true;
      this.emit({ k: 'summon', id: f.id, out: true });
    }
    f.energy -= def.energy;
    f.cds[id] = def.cooldown;
    this.startAction(f, id);
    if (def.announce && id !== 'timestop') this.emit({ k: 'announce', text: def.announce, id: f.id });
    return true;
  }

  private startAction(f: Fighter, id: AbilityId, step = 0) {
    let yaw = f.aimYaw;
    // Melee aim assist: snap toward the nearest enemy in a generous cone
    if (id === 'combo' || id === 'barrage' || id === 'uppercut') {
      let best: Fighter | null = null;
      let bestD = 5.5;
      for (const o of this.fighters) {
        if (!this.isEnemy(f, o) || o.dead) continue;
        const d = vdist(f.pos, o.pos);
        if (d > bestD) continue;
        const dy = Math.abs(wrapAngle(yawTo(f.pos, o.pos) - f.aimYaw));
        if (dy < 0.9 && Math.abs(o.pos.y - f.pos.y) < 2.5) {
          best = o;
          bestD = d;
        }
      }
      if (best) yaw = yawTo(f.pos, best.pos);
    }
    f.action = { id, t: 0, step, nextHit: 0, yaw, pitch: f.aimPitch, landed: false };
    f.blocking = false;
    this.emit({ k: 'action', id: f.id, ab: id, step });
    if (id === 'leap' && !f.remote) {
      const d = fwdXZ(yaw);
      f.vel.x = d.x * 17;
      f.vel.z = d.z * 17;
      f.vel.y = 14;
      f.grounded = false;
    }
    if (id === 'evade') {
      f.invuln = 0.32;
      const inp = this.input(f.id);
      const ml = Math.hypot(inp.mx, inp.mz);
      f.dashDir = ml > 0.1 ? v3(inp.mx / ml, 0, inp.mz / ml) : fwdXZ(f.aimYaw);
      f.dashT = 0.22;
      f.dashSpeed = 36;
      this.emit({ k: 'dash', id: f.id, special: true });
    }
    if (id === 'timestop') {
      this.emit({ k: 'ts', phase: 'windup', caster: f.id, pos: vcopy(f.pos), dur: f.def.timeStop ?? 2 });
      const def = f.def.abilities.timestop;
      if (def?.announce) this.emit({ k: 'announce', text: def.announce, id: f.id, style: 'ts' });
    }
  }

  private updateAction(f: Fighter, dt: number) {
    const a = f.action!;
    a.t += dt;
    const def = f.def.abilities[a.id];
    switch (a.id) {
      case 'combo': {
        const hits = (f.standOut ? COMBO_HITS_STAND : COMBO_HITS_BARE)[a.step];
        this.processHits(f, a, hits);
        if (a.t < 0.08 && f.grounded && !f.remote) {
          const d = fwdXZ(a.yaw);
          f.vel.x += d.x * 30 * dt;
          f.vel.z += d.z * 30 * dt;
        }
        if (a.t >= COMBO_STEP_TIME[a.step]) {
          if (f.bufAttack > 0 && a.step < 2) {
            f.bufAttack = 0;
            this.startAction(f, 'combo', a.step + 1);
          } else f.action = null;
        }
        return;
      }
      case 'barrage':
        a.yaw = dampAngle(a.yaw, f.aimYaw, 5, dt);
        if (def?.hits) this.processHits(f, a, def.hits);
        break;
      case 'uppercut':
        if (def?.hits) this.processHits(f, a, def.hits);
        break;
      case 'leap':
        if (a.t > 0.15 && f.grounded && !a.landed) {
          a.landed = true;
          if (def?.hits) this.doHit(f, def.hits[0], a);
          this.emit({ k: 'land', id: f.id, hard: true });
          f.action = null;
          return;
        }
        if (a.t > 1.8) f.action = null;
        return;
      case 'knives':
        if (a.step === 0 && a.t >= 0.16) {
          a.step = 1;
          if (this.authority) {
            const origin = v3(f.pos.x, f.pos.y + 1.5, f.pos.z);
            for (let k = 0; k < KNIFE.count; k++) {
              const off = (k - (KNIFE.count - 1) / 2) * KNIFE.spread;
              const d = aimDir(f.aimYaw + off, f.aimPitch + 0.02);
              this.spawnProjectile(f, 'knife', origin, d, KNIFE.speed);
            }
          }
          this.emit({ k: 'proj', kind: 'knife', pos: vcopy(f.pos), owner: f.id });
        }
        break;
      case 'shoot':
        if (a.step === 0 && a.t >= 0.15) {
          a.step = 1;
          if (this.authority) {
            const origin = v3(f.pos.x, f.pos.y + 1.45, f.pos.z);
            this.spawnProjectile(f, 'bullet', origin, aimDir(f.aimYaw, f.aimPitch), BULLET.speed);
          }
          this.emit({ k: 'proj', kind: 'bullet', pos: vcopy(f.pos), owner: f.id });
        }
        break;
      case 'timestop':
        if (a.t >= (def?.duration ?? 0.7)) {
          f.action = null;
          if (this.authority) this.startTimeStop(f);
          return;
        }
        break;
      default:
        break;
    }
    if (def && a.t >= def.duration && f.action === a) f.action = null;
  }

  private processHits(f: Fighter, a: ActionState, hits: HitDef[]) {
    while (a.nextHit < hits.length && hits[a.nextHit].t <= a.t) {
      this.doHit(f, hits[a.nextHit], a);
      a.nextHit++;
    }
  }

  private doHit(f: Fighter, h: HitDef, a: ActionState) {
    if (!this.authority) return;
    const d = fwdXZ(a.yaw);
    const c = v3(f.pos.x + d.x * h.reach, f.pos.y + 1.1, f.pos.z + d.z * h.reach);
    for (const t of this.fighters) {
      if (!this.isEnemy(f, t) || t.dead) continue;
      // hit volume is a capsule from the attacker's chest to the reach point, tested against the target's body
      const tx = t.pos.x - f.pos.x;
      const tz = t.pos.z - f.pos.z;
      const along = clamp(tx * d.x + tz * d.z, 0.3, h.reach);
      const px = f.pos.x + d.x * along;
      const pz = f.pos.z + d.z * along;
      const cy = clamp(c.y, t.pos.y + 0.2, t.pos.y + BODY_H - 0.2);
      const dist = Math.hypot(px - t.pos.x, c.y - cy, pz - t.pos.z);
      if (dist > h.radius + BODY_R) continue;
      let kdx = t.pos.x - f.pos.x;
      let kdz = t.pos.z - f.pos.z;
      const kl = Math.hypot(kdx, kdz);
      if (kl < 0.01) {
        kdx = d.x;
        kdz = d.z;
      } else {
        kdx /= kl;
        kdz /= kl;
      }
      const kb = v3(kdx * h.kbH, h.kbV, kdz * h.kbH);
      if (h.pull) {
        // barrage pull: keep target at ~1.8m in front of the stand
        const want = 1.9;
        kb.x = kdx * (want - kl) * h.pull + f.vel.x * 0.6;
        kb.z = kdz * (want - kl) * h.pull + f.vel.z * 0.6;
      }
      const pos = v3((c.x + t.pos.x) / 2, t.pos.y + 1.2, (c.z + t.pos.z) / 2);
      this.applyHit(f, t, h.dmg, kb, h.stun, !!h.heavy, a.id, pos);
    }
  }

  applyHit(a: Fighter, v: Fighter, baseDmg: number, kb: V3, stun: number, heavy: boolean, ab: AbilityId | 'proj', pos: V3) {
    if (v.dead || v.invuln > 0) return;
    const scale = a.combo > 12 ? Math.max(0.5, 1 - (a.combo - 12) * 0.03) : 1;
    let dmg = baseDmg * a.dmgMul * scale;
    if (this.timeStop && v.frozen) {
      this.tsQueue.push({ a: a.id, v: v.id, dmg, kb: vcopy(kb), stun });
      this.countCombo(a, dmg);
      this.emit({ k: 'hit', a: a.id, v: v.id, dmg: Math.round(dmg), pos, kb, stun, blocked: false, perfect: false, heavy, queued: true, combo: a.combo, ab });
      return;
    }
    let blocked = false;
    // Blocking: must face the attacker
    const fw = fwdXZ(v.yaw);
    const toA = v3(a.pos.x - v.pos.x, 0, a.pos.z - v.pos.z);
    const tl = Math.hypot(toA.x, toA.z) || 1;
    const facing = (fw.x * toA.x + fw.z * toA.z) / tl >= BLOCK.arcCos;
    if (v.blocking && facing) {
      if (v.blockT <= BLOCK.perfectWindow) {
        v.energy = Math.min(v.maxEnergy, v.energy + 12);
        if (ab !== 'proj') {
          a.stun = Math.max(a.stun, BLOCK.staggerOnPerfect);
          a.action = null;
          this.emit({ k: 'stagger', id: a.id, t: BLOCK.staggerOnPerfect });
        }
        this.emit({ k: 'hit', a: a.id, v: v.id, dmg: 0, pos, kb: v3(), stun: 0, blocked: true, perfect: true, heavy, queued: false, combo: a.combo, ab });
        this.emit({ k: 'announce', text: 'PERFECT BLOCK', id: v.id, style: 'perfect' });
        return;
      }
      if (heavy) {
        v.blocking = false;
        dmg *= 0.6;
        stun = Math.max(stun, 0.9);
        this.emit({ k: 'guardbreak', id: v.id });
        this.emit({ k: 'announce', text: 'GUARD BREAK', id: v.id, style: 'break' });
      } else {
        blocked = true;
        if (v.maxEnergy > 0) v.energy -= dmg * 1.1;
        dmg *= 1 - BLOCK.reduction;
        kb = v3(kb.x * 0.3, 0, kb.z * 0.3);
        stun = 0.12;
        if (v.maxEnergy > 0 && v.energy <= 0) {
          v.energy = 0;
          v.blocking = false;
          blocked = false;
          stun = 1.0;
          this.emit({ k: 'guardbreak', id: v.id });
          this.emit({ k: 'announce', text: 'GUARD BREAK', id: v.id, style: 'break' });
        }
      }
    }
    this.damage(a, v, dmg, kb, stun, blocked, heavy, ab, pos, false);
  }

  private countCombo(a: Fighter, dmg: number) {
    a.combo++;
    a.comboT = 1.25;
    a.comboDmg += dmg;
    a.stats.hits++;
    a.stats.dmg += dmg;
    if (a.combo > a.stats.maxCombo) a.stats.maxCombo = a.combo;
  }

  private damage(a: Fighter | undefined, v: Fighter, dmg: number, kb: V3, stun: number, blocked: boolean, heavy: boolean, ab: AbilityId | 'proj' | 'resume', pos: V3, fromResume: boolean) {
    v.hp -= dmg;
    v.lastHitT = this.time;
    v.hitFlash = 0.14;
    if (!blocked) {
      v.stun = Math.max(v.stun, stun);
      if (v.action) v.action = null;
      v.blocking = false;
      v.combo = 0;
      v.dashT = 0;
    }
    if (!v.remote) {
      v.vel.x = kb.x;
      v.vel.z = kb.z;
      if (kb.y !== 0 || !blocked) v.vel.y = Math.max(v.vel.y * 0.3, kb.y);
      if (kb.y > 0.5) v.grounded = false;
    }
    if (kb.y > 8) v.launched = true;
    if (a && !fromResume) this.countCombo(a, dmg);
    if (a && fromResume) {
      a.stats.dmg += 0; // already counted when queued
    }
    this.emit({ k: 'hit', a: a?.id ?? 0, v: v.id, dmg: Math.round(dmg * 10) / 10, pos, kb, stun, blocked, perfect: false, heavy, queued: false, combo: a?.combo ?? 0, ab });
    if (v.immortal && v.hp < 1) v.hp = 1;
    if (v.hp <= 0) this.ko(a, v);
  }

  ko(a: Fighter | undefined, v: Fighter) {
    if (v.dead) return;
    v.dead = true;
    v.deadT = 0;
    v.hp = 0;
    v.action = null;
    v.stun = 0;
    v.blocking = false;
    v.standOut = false;
    v.stats.deaths++;
    if (!v.remote) v.vel.y = Math.max(v.vel.y, 6);
    this.emit({ k: 'ko', a: a?.id ?? 0, v: v.id });
    if (a && a !== v) {
      a.stats.kos++;
      const double = this.time - a.lastKoT < 3 || (a.dead && a.deadT < 0.6);
      a.lastKoT = this.time;
      this.emit({ k: 'announce', text: double ? 'DOUBLE K.O.' : 'K.O.!', id: a.id, style: 'ko' });
    }
    if (this.timeStop?.caster === v.id) this.endTimeStop();
    this.onKO?.(a, v);
  }

  respawn(f: Fighter, pos?: V3) {
    const p = pos ?? (this.spawnFn ? this.spawnFn(f) : v3(0, 0, 0));
    f.pos = vcopy(p);
    f.vel = v3();
    f.dead = false;
    f.deadT = 0;
    f.hp = f.maxHp;
    f.energy = f.maxEnergy;
    f.stun = 0;
    f.launched = false;
    f.invuln = 1.5;
    f.action = null;
    f.frozen = false;
    f.combo = 0;
    this.emit({ k: 'respawn', id: f.id, pos: vcopy(p) });
  }

  // ------------------------------------------------------------------ time stop
  startTimeStop(caster: Fighter) {
    if (this.timeStop) return;
    const dur = caster.def.timeStop ?? 2;
    this.timeStop = { caster: caster.id, t: dur, dur, center: vcopy(caster.pos), radius: TIMESTOP_RADIUS };
    for (const f of this.fighters) {
      if (f === caster) continue;
      if (vdist(f.pos, caster.pos) <= TIMESTOP_RADIUS) {
        f.frozen = true;
        if (f.action?.id === 'timestop') f.action = null; // counter-stop interrupted
      }
    }
    for (const p of this.projectiles) {
      if (vdist(p.pos, caster.pos) <= TIMESTOP_RADIUS && p.owner !== caster.id) p.frozen = true;
    }
    this.emit({ k: 'ts', phase: 'start', caster: caster.id, pos: vcopy(caster.pos), dur });
  }

  endTimeStop() {
    const ts = this.timeStop;
    if (!ts) return;
    this.timeStop = null;
    for (const f of this.fighters) f.frozen = false;
    for (const p of this.projectiles) p.frozen = false;
    // Apply every queued hit as one big release per victim
    const byVictim = new Map<number, QueuedHit[]>();
    for (const q of this.tsQueue) {
      let arr = byVictim.get(q.v);
      if (!arr) byVictim.set(q.v, (arr = []));
      arr.push(q);
    }
    this.tsQueue = [];
    this.emit({ k: 'ts', phase: 'end', caster: ts.caster, pos: vcopy(ts.center), dur: ts.dur });
    for (const [vid, list] of byVictim) {
      const v = this.byId.get(vid);
      if (!v || v.dead) continue;
      let dmg = 0;
      let stun = 0;
      const kb = v3();
      for (const q of list) {
        dmg += q.dmg;
        stun = Math.max(stun, q.stun);
        kb.x += q.kb.x * 0.5;
        kb.y += q.kb.y * 0.4;
        kb.z += q.kb.z * 0.5;
      }
      const hl = Math.hypot(kb.x, kb.z);
      if (hl > 22) {
        kb.x *= 22 / hl;
        kb.z *= 22 / hl;
      }
      kb.y = clamp(kb.y + 4, 4, 16);
      const a = this.byId.get(list[0].a);
      this.damage(a, v, dmg, kb, Math.max(stun, 0.6), false, true, 'resume', v3(v.pos.x, v.pos.y + 1.2, v.pos.z), true);
    }
  }

  private updateTimeStop(dt: number) {
    const ts = this.timeStop;
    if (!ts || this.externalTimeStop) return;
    ts.t -= dt;
    // projectiles fired by the caster during stopped time travel briefly, then hang in the air
    for (const p of this.projectiles) {
      if (!p.frozen && p.owner === ts.caster && p.age > 0.08 && vdist(p.pos, ts.center) <= ts.radius) p.frozen = true;
    }
    if (ts.t <= 0) this.endTimeStop();
  }

  // ------------------------------------------------------------------ projectiles
  spawnProjectile(f: Fighter, kind: 'knife' | 'bullet', origin: V3, dir: V3, speed: number) {
    const spec = kind === 'knife' ? KNIFE : BULLET;
    this.projectiles.push({
      id: this.nextProj++,
      owner: f.id,
      kind,
      pos: vcopy(origin),
      vel: v3(dir.x * speed, dir.y * speed, dir.z * speed),
      age: 0,
      life: kind === 'knife' ? 2.5 : 1.6,
      frozen: false,
      stuck: false,
      dmg: spec.dmg,
      stun: spec.stun,
      kbH: spec.kbH,
      kbV: spec.kbV,
    });
  }

  private updateProjectiles(dt: number) {
    const keep: Projectile[] = [];
    for (const p of this.projectiles) {
      if (p.frozen) {
        keep.push(p);
        continue;
      }
      p.age += dt;
      if (p.age > p.life) continue;
      if (p.stuck) {
        keep.push(p);
        continue;
      }
      if (p.kind === 'knife') p.vel.y -= 4 * dt;
      const sp = Math.hypot(p.vel.x, p.vel.y, p.vel.z);
      const dir = v3(p.vel.x / sp, p.vel.y / sp, p.vel.z / sp);
      const travel = sp * dt;
      const wallDist = this.world.raycast(p.pos, dir, travel);
      let hit = false;
      const owner = this.byId.get(p.owner);
      if (this.authority) {
        for (let s = 1; s <= 3 && !hit; s++) {
          const t = (travel * s) / 3;
          if (t > wallDist + 0.05) break;
          const q = v3(p.pos.x + dir.x * t, p.pos.y + dir.y * t, p.pos.z + dir.z * t);
          for (const f of this.fighters) {
            if (f.dead || f.id === p.owner) continue;
            if (owner && !this.isEnemy(owner, f)) continue;
            const cy = clamp(q.y, f.pos.y + 0.25, f.pos.y + BODY_H - 0.2);
            if (Math.hypot(q.x - f.pos.x, q.y - cy, q.z - f.pos.z) < BODY_R + 0.3) {
              const kl = Math.hypot(dir.x, dir.z) || 1;
              const kb = v3((dir.x / kl) * p.kbH, p.kbV, (dir.z / kl) * p.kbH);
              if (owner) this.applyHit(owner, f, p.dmg, kb, p.stun, false, 'proj', q);
              hit = true;
              break;
            }
          }
        }
      }
      if (hit) continue;
      if (wallDist < travel) {
        p.pos.x += dir.x * wallDist;
        p.pos.y += dir.y * wallDist;
        p.pos.z += dir.z * wallDist;
        p.stuck = true;
        p.life = p.age + (p.kind === 'knife' ? 1.5 : 0.05);
      } else {
        p.pos.x += p.vel.x * dt;
        p.pos.y += p.vel.y * dt;
        p.pos.z += p.vel.z * dt;
      }
      keep.push(p);
    }
    this.projectiles = keep;
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ------------------------------------------------------------------ helpers for modes / AI
  nearestEnemy(f: Fighter, maxDist = 999): Fighter | null {
    let best: Fighter | null = null;
    let bd = maxDist;
    for (const o of this.fighters) {
      if (o.dead || !this.isEnemy(f, o)) continue;
      const d = vdist(f.pos, o.pos);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }
}
