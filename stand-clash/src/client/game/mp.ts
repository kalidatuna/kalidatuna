// Multiplayer client mode: predicts the local fighter, interpolates everyone else from server snapshots
// and lets the server resolve all combat (hits, damage, KOs, projectiles, time stop).
import type { Fighter, SimEvent } from '../../shared/sim';
import { EDGE_KEYS } from '../../shared/sim';
import type { CharId, AbilityId } from '../../shared/characters';
import type { NetFighter, ServerMsg, ResultRow } from '../../shared/protocol';
import { v3, lerp, wrapAngle, vdist } from '../../shared/math';
import type { Game, GameMode } from './game';
import { STEP } from './game';
import type { NetClient } from '../net/netClient';

interface Snap {
  t: number;
  f: NetFighter;
}

const INTERP_DELAY = 100; // ms

export class MPMode implements GameMode {
  kind = 'mp' as const;
  drivesSim = true;
  private off: (() => void) | null = null;
  private acc = 0;
  private sendAcc = 0;
  private buffers = new Map<number, Snap[]>();
  private chars = new Map<number, CharId>();
  private names = new Map<number, string>();
  private left = 0;
  private soMismatch = 0;
  private lastSnapAt = performance.now();
  private finished = false;
  private rows: ResultRow[] = [];

  constructor(
    private g: Game,
    private net: NetClient,
    private you: number,
    private char: CharId,
    private target: number,
    private code: string,
    players: { id: number; name: string; char: CharId }[],
    duration: number,
  ) {
    for (const p of players) {
      this.chars.set(p.id, p.char);
      this.names.set(p.id, p.name);
    }
    this.left = duration;
  }

  start() {
    const g = this.g;
    g.resetSim();
    g.isMP = true;
    const sim = g.sim;
    sim.authority = false;
    sim.ffa = true;
    sim.externalTimeStop = true;
    const p = sim.addFighter(this.char, { id: this.you, pos: g.randomPlazaSpawn(), name: this.names.get(this.you) ?? 'You' });
    p.respawnDelay = -1;
    p.yaw = p.aimYaw = Math.PI;
    g.player = p;
    this.off = this.net.on((m) => this.onMsg(m));
  }

  dispose() {
    this.off?.();
    this.off = null;
  }

  boss() {
    return null;
  }

  objective(): [string, string] {
    const mm = Math.floor(Math.max(0, this.left) / 60);
    const ss = String(Math.floor(Math.max(0, this.left) % 60)).padStart(2, '0');
    let lead = '';
    let best = -1;
    for (const f of this.g.sim.fighters) {
      if (f.stats.kos > best) {
        best = f.stats.kos;
        lead = f.name;
      }
    }
    const me = this.g.player;
    return [`ROOM ${this.code} — FIRST TO ${this.target} K.O.`, `${mm}:${ss}   ·   You ${me?.stats.kos ?? 0}   ·   Lead: ${lead} ${Math.max(0, best)}`];
  }

  update() {}
  onKO() {}

  frame(dt: number) {
    const g = this.g;
    const p = g.player!;
    this.left -= dt;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < 15) {
      g.buildPlayerInput();
      const inp = g.sim.input(p.id);
      for (const k of EDGE_KEYS) if (inp[k]) this.net.send({ t: 'act', k });
      g.sim.step(STEP);
      // local events only drive cosmetics for our own fighter (combat comes from the server)
      g.handleEvents(g.sim.drainEvents().filter((e) => e.k !== 'hit' && e.k !== 'ko'));
      this.acc -= STEP;
      steps++;
    }
    if (steps === 15) this.acc = 0;
    if (g.sim.timeStop) g.sim.timeStop.t -= dt;

    this.sendAcc += dt;
    if (this.sendAcc >= 1 / 30) {
      this.sendAcc = 0;
      const inp = g.sim.input(p.id);
      this.net.send({
        t: 'in',
        p: [r2(p.pos.x), r2(p.pos.y), r2(p.pos.z)],
        v: [r2(p.vel.x), r2(p.vel.y), r2(p.vel.z)],
        y: r3(p.yaw),
        ay: r3(p.aimYaw),
        ap: r3(p.aimPitch),
        g: p.grounded ? 1 : 0,
        bl: p.blocking ? 1 : 0,
        mx: r2(inp.mx),
        mz: r2(inp.mz),
      });
    }
    this.interpolate(dt);
    if (p.dead) p.deadT += dt;
    g.hud.respawn(p.dead ? 'K.O.! Respawning…' : null);
    const lag = performance.now() - this.lastSnapAt;
    const good = this.net.status === 'open' && lag < 1500;
    const humans = [...this.chars.keys()].length;
    g.hud.net(good ? `ROOM ${this.code} · ${Math.round(this.net.ping)} ms · ${humans} fighters` : this.net.status === 'open' ? 'CONNECTION UNSTABLE…' : 'DISCONNECTED', good);
    if (p.dead) g.hud.scoreboard(this.scoreHtml());
    else g.hud.scoreboard(null);
    if (this.net.status === 'closed' || this.net.status === 'error') {
      if (!this.finished) {
        this.finished = true;
        g.finish({ title: 'DISCONNECTED', sub: 'Lost connection to the server', win: false, rows: [], canRetry: false, canNext: false });
      }
    }
    g.afterSim(dt);
  }

  private scoreHtml(): string {
    const rows = [...this.g.sim.fighters].sort((a, b) => b.stats.kos - a.stats.kos);
    return `<table><tr><th>FIGHTER</th><th>K.O.</th><th>DOWN</th></tr>${rows
      .map((f) => `<tr><td>${esc(f.name)}${f.id === this.you ? ' (you)' : ''}</td><td>${f.stats.kos}</td><td>${f.stats.deaths}</td></tr>`)
      .join('')}</table>`;
  }

  // ---------------------------------------------------------------- network
  private onMsg(m: ServerMsg) {
    const g = this.g;
    const sim = g.sim;
    const p = g.player;
    if (!p) return;
    switch (m.t) {
      case 'snap': {
        this.lastSnapAt = performance.now();
        this.left = m.left;
        const now = performance.now();
        const seen = new Set<number>();
        for (const nf of m.f) {
          seen.add(nf.id);
          if (nf.id === this.you) {
            this.applyOwn(nf);
            continue;
          }
          let f = sim.byId.get(nf.id);
          if (!f) {
            const ch = this.chars.get(nf.id) ?? 'jotaro';
            f = sim.addFighter(ch, { id: nf.id, remote: true, name: this.names.get(nf.id) ?? 'Fighter', pos: v3(...nf.p) });
            f.puppet = true;
            f.respawnDelay = -1;
          }
          let buf = this.buffers.get(nf.id);
          if (!buf) this.buffers.set(nf.id, (buf = []));
          buf.push({ t: now, f: nf });
          while (buf.length > 12) buf.shift();
        }
        for (const f of [...sim.fighters]) {
          if (f.id !== this.you && !seen.has(f.id)) {
            g.removeFighter(f.id);
            this.buffers.delete(f.id);
          }
        }
        sim.projectiles = m.pr.map((q) => ({
          id: q.id,
          owner: q.o,
          kind: q.k ? 'bullet' : 'knife',
          pos: v3(...q.p),
          vel: v3(...q.v),
          age: 0,
          life: 5,
          frozen: !!q.f,
          stuck: !!q.s,
          dmg: 0,
          stun: 0,
          kbH: 0,
          kbV: 0,
        }));
        if (m.ts) {
          sim.timeStop = { caster: m.ts.c, t: m.ts.t, dur: m.ts.d, center: v3(...m.ts.p), radius: m.ts.r };
        } else if (sim.timeStop) {
          sim.timeStop = null;
        }
        break;
      }
      case 'ev':
        this.onEvents(m.e);
        break;
      case 'corr':
        p.pos = v3(...m.p);
        p.vel = v3();
        break;
      case 'results':
        this.rows = m.rows;
        this.finished = true;
        g.finish({
          title: m.winner === this.you ? 'YOU WIN!' : 'MATCH OVER',
          sub: `${m.reason === 'time' ? 'TIME UP! ' : `FIRST TO ${this.target} K.O. · `}Winner: ${esc(m.rows.find((r) => r.id === m.winner)?.name ?? '—')}`,
          win: m.winner === this.you,
          rank: m.winner === this.you ? 'S' : undefined,
          rows: [],
          tableHtml: `<table>${m.rows
            .map((r, i) => `<tr><td>${i + 1}. ${esc(r.name)}${r.bot ? ' 🤖' : ''}${r.id === this.you ? ' (you)' : ''}</td><td>${r.kos} K.O. · ${r.deaths} down · ${r.dmg} dmg · ${r.maxCombo} combo</td></tr>`)
            .join('')}</table>`,
          canRetry: false,
          canNext: false,
        });
        break;
      case 'room':
        for (const pl of m.players) {
          this.chars.set(pl.id, pl.char);
          this.names.set(pl.id, pl.name);
        }
        break;
      default:
        break;
    }
  }

  private applyOwn(nf: NetFighter) {
    const p = this.g.player!;
    p.hp = nf.hp;
    p.maxHp = nf.mhp;
    if (Math.abs(p.energy - nf.en) > 15) p.energy = nf.en;
    p.frozen = !!nf.fr;
    p.stats.kos = nf.k;
    p.stats.deaths = nf.de;
    p.stats.dmg = nf.dmg;
    p.stats.maxCombo = nf.mc;
    if (nf.d && !p.dead) this.markDead(p);
    if (!nf.d && p.dead && p.deadT > 0.5) this.revive(p, v3(...nf.p));
    if (!!nf.so !== p.standOut) {
      this.soMismatch += 0.05;
      if (this.soMismatch > 0.5) {
        p.standOut = !!nf.so;
        this.soMismatch = 0;
      }
    } else this.soMismatch = 0;
  }

  private markDead(f: Fighter) {
    f.dead = true;
    f.deadT = 0;
    f.hp = 0;
    f.action = null;
    f.standOut = false;
    f.blocking = false;
    f.stun = 0;
    f.vel.y = Math.max(f.vel.y, 6);
  }

  private revive(f: Fighter, pos: { x: number; y: number; z: number }) {
    f.dead = false;
    f.deadT = 0;
    f.pos = v3(pos.x, pos.y, pos.z);
    f.vel = v3();
    f.hp = f.maxHp;
    f.energy = f.maxEnergy;
    f.invuln = 1.5;
    f.stun = 0;
    f.launched = false;
    f.action = null;
  }

  private onEvents(list: SimEvent[]) {
    const g = this.g;
    const p = g.player!;
    const keep: SimEvent[] = [];
    for (const e of list) {
      switch (e.k) {
        case 'action':
        case 'summon':
        case 'dash':
        case 'jump':
        case 'land':
          if (e.id === this.you) continue;
          break;
        case 'proj':
          if (e.owner === this.you) continue;
          break;
        case 'announce':
          if (e.id === this.you && e.style !== 'ko' && e.style !== 'perfect' && e.style !== 'break') continue;
          break;
        case 'ts':
          if (e.phase === 'windup' && e.caster === this.you) continue;
          if (e.phase === 'start') g.sim.timeStop = { caster: e.caster, t: e.dur, dur: e.dur, center: e.pos, radius: 38 };
          if (e.phase === 'end') {
            g.sim.timeStop = null;
            p.frozen = false;
          }
          break;
        case 'hit': {
          const v = g.sim.byId.get(e.v);
          if (v && !e.queued && !e.perfect) v.hitFlash = 0.14;
          if (e.v === this.you && !e.queued && !e.perfect) {
            if (e.blocked) {
              p.vel.x = e.kb.x;
              p.vel.z = e.kb.z;
            } else {
              p.stun = Math.max(p.stun, e.stun);
              p.action = null;
              p.blocking = false;
              p.dashT = 0;
              p.vel.x = e.kb.x;
              p.vel.z = e.kb.z;
              p.vel.y = Math.max(p.vel.y * 0.3, e.kb.y);
              if (e.kb.y > 0.5) p.grounded = false;
              if (e.kb.y > 8) p.launched = true;
            }
          }
          break;
        }
        case 'stagger':
          if (e.id === this.you) {
            p.stun = Math.max(p.stun, e.t);
            p.action = null;
          }
          break;
        case 'ko': {
          const v = g.sim.byId.get(e.v);
          if (v && v.id === this.you && !v.dead) this.markDead(v);
          if (v && v.id !== this.you) {
            v.dead = true;
            v.deadT = 0;
          }
          break;
        }
        case 'respawn':
          if (e.id === this.you) this.revive(p, e.pos);
          break;
      }
      keep.push(e);
    }
    g.handleEvents(keep);
  }

  /** Write interpolated snapshot state into the puppet fighters. */
  private interpolate(dt: number) {
    const rt = performance.now() - INTERP_DELAY;
    for (const [id, buf] of this.buffers) {
      const f = this.g.sim.byId.get(id);
      if (!f || !buf.length) continue;
      let a = buf[0];
      let b = buf[buf.length - 1];
      for (let i = 0; i < buf.length - 1; i++) {
        if (buf[i].t <= rt && buf[i + 1].t >= rt) {
          a = buf[i];
          b = buf[i + 1];
          break;
        }
      }
      const span = b.t - a.t;
      let k = span > 0 ? (rt - a.t) / span : 1;
      const A = a.f;
      const B = b.f;
      if (k > 1) {
        // extrapolate briefly with velocity
        const ex = Math.min(0.15, (rt - b.t) / 1000);
        f.pos.x = B.p[0] + B.v[0] * ex;
        f.pos.y = Math.max(0, B.p[1] + B.v[1] * ex);
        f.pos.z = B.p[2] + B.v[2] * ex;
        k = 1;
      } else {
        k = Math.max(0, k);
        f.pos.x = lerp(A.p[0], B.p[0], k);
        f.pos.y = lerp(A.p[1], B.p[1], k);
        f.pos.z = lerp(A.p[2], B.p[2], k);
      }
      if (vdist(f.pos, v3(...B.p)) > 8) f.pos = v3(...B.p);
      f.yaw = A.y + wrapAngle(B.y - A.y) * k;
      f.vel = v3(...B.v);
      f.aimYaw = B.ay;
      f.aimPitch = B.ap;
      f.grounded = !!B.g;
      f.hp = B.hp;
      f.maxHp = B.mhp;
      f.energy = B.en;
      f.standOut = !!B.so;
      f.blocking = !!B.bl;
      f.stun = B.st;
      f.launched = !!B.la;
      f.frozen = !!B.fr;
      if (B.d && !f.dead) f.deadT = 0;
      f.dead = !!B.d;
      if (f.dead) f.deadT += dt;
      f.invuln = B.inv ? 1 : 0;
      f.boostT = B.bt ? 0.3 : 0;
      if (f.hitFlash > 0) f.hitFlash -= dt;
      f.stats.kos = B.k;
      f.stats.deaths = B.de;
      if (B.a) {
        const t = B.a[1] + Math.max(0, (rt - b.t) / 1000);
        if (!f.action || f.action.id !== B.a[0] || f.action.step !== B.a[2] || Math.abs(f.action.t - t) > 0.15) {
          f.action = { id: B.a[0] as AbilityId, t, step: B.a[2], nextHit: 0, yaw: f.yaw, pitch: f.aimPitch, landed: false };
        } else if (!f.frozen) f.action.t += dt;
      } else f.action = null;
      f.dashT = 0;
    }
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
