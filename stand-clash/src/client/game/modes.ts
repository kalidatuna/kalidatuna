// Single-player modes: Free Roam, Training and Missions.
import type { Fighter } from '../../shared/sim';
import type { CharId } from '../../shared/characters';
import type { DummyMode } from '../../shared/ai';
import { v3, vdist } from '../../shared/math';
import type { Game, GameMode, ResultData } from './game';
import { audio } from '../engine/audio';

const ENEMY_NAMES: Record<string, string[]> = {
  zombie: ['Vampire Zombie', 'Flesh-Bud Thrall', 'Night Ghoul'],
  rogue: ['Rogue Stand User', 'Back-Alley Brawler', 'Stand Thug'],
  gunner: ['Hol Horse', 'Hired Gunslinger'],
};
const pickName = (c: string) => {
  const l = ENEMY_NAMES[c] ?? [c];
  return l[Math.floor(Math.random() * l.length)];
};

function rankFor(score: number): string {
  return score >= 90 ? 'S' : score >= 75 ? 'A' : score >= 55 ? 'B' : score >= 35 ? 'C' : 'D';
}

// ------------------------------------------------------------------ Free Roam
export class FreeRoamMode implements GameMode {
  kind = 'free' as const;
  private spawnT = 1.5;
  private kos = 0;
  private maxActive = 6;
  constructor(private g: Game, private char: CharId) {}

  start() {
    const g = this.g;
    g.resetSim();
    const p = g.addPlayer(this.char, v3(-5, 0, 19));
    p.respawnDelay = 3;
    g.sim.spawnFn = () => g.randomPlazaSpawn();
  }

  private enemies(): Fighter[] {
    return this.g.sim.fighters.filter((f) => f.team === 1 && !f.dead);
  }

  update(dt: number) {
    const g = this.g;
    const p = g.player!;
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 3.5;
      if (this.enemies().length < this.maxActive) {
        // pick a street spawn 22-60m from the player
        const cands = g.world.spawns.filter((s) => {
          const d = vdist(s, p.pos);
          return d > 22 && d < 60;
        });
        const s = cands[Math.floor(Math.random() * cands.length)] ?? g.world.spawns[0];
        const r = Math.random();
        const char: CharId = r < 0.45 ? 'zombie' : r < 0.75 ? 'rogue' : 'gunner';
        g.spawnEnemy(char, v3(s.x, 0, s.z), { level: 0.35 + Math.min(0.4, this.kos * 0.02), name: pickName(char), leash: { x: s.x, z: s.z, r: 70 } });
      }
    }
    g.hud.respawn(p.dead ? `RETIRED… respawning in ${Math.max(0, p.respawnDelay - p.deadT).toFixed(1)}` : null);
  }

  onKO(a: Fighter | undefined, v: Fighter) {
    if (v.team === 1 && a === this.g.player) this.kos++;
  }

  boss() {
    return null;
  }
  dispose() {}
  objective(): [string, string] {
    return ['FREE ROAM — MORIOH', `Stand users defeated: ${this.kos}`];
  }
}

// ------------------------------------------------------------------ Training
export class TrainingMode implements GameMode {
  kind = 'training' as const;
  dummy: Fighter | null = null;
  behavior: DummyMode = 'idle';
  immortal = true;
  noCooldown = false;
  private dmgLog: { t: number; d: number }[] = [];
  private last = 0;
  private best = 0;
  private comboDmg = 0;
  private bestComboDmg = 0;
  private time = 0;

  constructor(private g: Game, private char: CharId) {}

  start() {
    const g = this.g;
    g.resetSim();
    const p = g.addPlayer(this.char, v3(-5, 0, 19));
    p.respawnDelay = 2;
    this.spawnDummy();
    this.buildPanel();
  }

  spawnDummy() {
    const g = this.g;
    if (this.dummy) g.removeFighter(this.dummy.id);
    const d = g.spawnEnemy(this.behavior === 'fight' ? 'rogue' : 'dummy', v3(-5, 0, 13), { level: 0.45, dummy: this.behavior, name: this.behavior === 'fight' ? 'Sparring Partner' : 'Training Dummy' });
    d.immortal = this.immortal;
    d.respawnDelay = 2;
    d.yaw = 0;
    this.dummy = d;
  }

  private buildPanel() {
    const el = this.g.hud.trainingPanel;
    el.classList.remove('hidden');
    el.innerHTML = `
      <h4>TRAINING DUMMY</h4>
      <div class="row"><span>Behaviour</span><select id="tr-beh">
        <option value="idle">Stand still</option><option value="block">Always block</option>
        <option value="perfect">Perfect blocker</option><option value="jump">Jump</option><option value="fight">Fight back</option></select></div>
      <div class="row"><span>Immortal</span><input type="checkbox" id="tr-imm" checked></div>
      <div class="row"><span>No cooldowns / ∞ energy</span><input type="checkbox" id="tr-cd"></div>
      <div class="row"><button id="tr-reset">Reset dummy</button><button id="tr-clear">Clear stats</button></div>
      <div class="stat">Last hit <b id="tr-last">0</b></div>
      <div class="stat">Combo dmg <b id="tr-combo">0</b> · best <b id="tr-bestc">0</b></div>
      <div class="stat">Max combo <b id="tr-best">0</b> hits</div>
      <div class="stat">DPS (5s) <b id="tr-dps">0</b></div>
      <div class="tip">Press ESC to free the mouse and change options.</div>`;
    const q = <T extends HTMLElement>(s: string) => el.querySelector(s) as T;
    q<HTMLSelectElement>('#tr-beh').onchange = (e) => {
      this.behavior = (e.target as HTMLSelectElement).value as DummyMode;
      this.spawnDummy();
    };
    q<HTMLInputElement>('#tr-imm').onchange = (e) => {
      this.immortal = (e.target as HTMLInputElement).checked;
      if (this.dummy) this.dummy.immortal = this.immortal;
    };
    q<HTMLInputElement>('#tr-cd').onchange = (e) => {
      this.noCooldown = (e.target as HTMLInputElement).checked;
    };
    q<HTMLButtonElement>('#tr-reset').onclick = () => this.spawnDummy();
    q<HTMLButtonElement>('#tr-clear').onclick = () => {
      this.best = this.bestComboDmg = this.last = this.comboDmg = 0;
      this.dmgLog = [];
    };
  }

  onEvent(e: import('../../shared/sim').SimEvent) {
    const p = this.g.player;
    if (e.k === 'hit' && p && e.a === p.id && !e.perfect) {
      this.last = e.dmg;
      this.dmgLog.push({ t: this.time, d: e.dmg });
      this.comboDmg = e.combo <= 1 ? e.dmg : this.comboDmg + e.dmg;
      this.bestComboDmg = Math.max(this.bestComboDmg, this.comboDmg);
      this.best = Math.max(this.best, e.combo);
    }
  }

  update(dt: number) {
    this.time += dt;
    const p = this.g.player!;
    if (this.noCooldown) {
      p.energy = p.maxEnergy;
      for (const k in p.cds) p.cds[k as keyof typeof p.cds] = 0;
    }
    // re-create the dummy if it was defeated with immortality off
    if (this.dummy && this.dummy.dead && this.dummy.deadT > 2) this.spawnDummy();
    this.dmgLog = this.dmgLog.filter((x) => this.time - x.t < 5);
    const dps = this.dmgLog.reduce((s, x) => s + x.d, 0) / 5;
    const set = (id: string, v: string) => {
      const el = document.getElementById(id);
      if (el && el.textContent !== v) el.textContent = v;
    };
    set('tr-last', this.last.toFixed(1));
    set('tr-combo', this.comboDmg.toFixed(0));
    set('tr-bestc', this.bestComboDmg.toFixed(0));
    set('tr-best', String(this.best));
    set('tr-dps', dps.toFixed(1));
    this.g.hud.respawn(p.dead ? 'DOWN! Respawning…' : null);
  }

  onKO() {}
  boss() {
    return null;
  }
  dispose() {
    this.g.hud.trainingPanel.classList.add('hidden');
  }
  objective(): [string, string] {
    return ['TRAINING', 'Practice combos, blocks and time stop'];
  }
}

// ------------------------------------------------------------------ Missions
export interface MissionInfo {
  id: number;
  name: string;
  jp: string;
  desc: string;
}

export const MISSIONS: MissionInfo[] = [
  { id: 1, name: 'Morioh Menace', jp: '杜王町の脅威', desc: 'Six hostile Stand users have taken over the plaza. Defeat them all.' },
  { id: 2, name: 'Night of the Vampires', jp: '吸血鬼の夜', desc: "DIO's flesh-bud army floods the streets. Survive three waves." },
  { id: 3, name: "DIO's World", jp: 'DIOの世界', desc: 'Face DIO himself. Watch for stopped time and counter with your own.' },
];

type Wave = [CharId, number][];

export class MissionMode implements GameMode {
  kind = 'mission' as const;
  private time = 0;
  private kills = 0;
  private total = 0;
  private wave = 0;
  private waves: Wave[] = [];
  private breakT = 0;
  private bossF: Fighter | null = null;
  private phase2 = false;
  private ended = false;
  private failT = -1;
  private intro = 2.2;

  constructor(private g: Game, private char: CharId, public stage: number) {}

  start() {
    const g = this.g;
    g.resetSim();
    const p = g.addPlayer(this.char, v3(-5, 0, 19));
    p.respawnDelay = -1;
    const info = MISSIONS[this.stage - 1];
    setTimeout(() => g.hud.announce(info.name.toUpperCase(), 'info'), 300);
    if (this.stage === 1) {
      const ring: [CharId, number, number][] = [
        ['rogue', -12, -6],
        ['rogue', 12, -6],
        ['zombie', -16, 4],
        ['zombie', 16, 4],
        ['gunner', -8, -16],
        ['gunner', 8, -16],
      ];
      for (const [c, x, z] of ring) g.spawnEnemy(c, v3(x, 0, z), { level: 0.45, name: pickName(c) });
      this.total = ring.length;
    } else if (this.stage === 2) {
      this.waves = [
        [['zombie', 5]],
        [
          ['zombie', 4],
          ['rogue', 2],
        ],
        [
          ['rogue', 3],
          ['gunner', 2],
          ['zombie', 3],
        ],
      ];
      this.total = this.waves.reduce((s, w) => s + w.reduce((a, [, n]) => a + n, 0), 0);
      this.spawnWave();
    } else {
      const shadow = this.char === 'dio';
      const boss = g.spawnEnemy('dio', v3(0, 0, -6), { level: 0.85, boss: true, hpMul: 3.6, dmgMul: 1.05, name: shadow ? 'SHADOW DIO' : 'DIO' });
      boss.respawnDelay = -1;
      if (shadow) boss.dmgMul = 1.1;
      this.bossF = boss;
      g.spawnEnemy('zombie', v3(-10, 0, -10), { level: 0.4, name: pickName('zombie') });
      g.spawnEnemy('zombie', v3(10, 0, -10), { level: 0.4, name: pickName('zombie') });
      this.total = 1;
      g.fx.menacing(g.tmpVec(0, 1, -6), 8, 3);
      audio.play('menace', 1);
    }
  }

  private spawnWave() {
    const g = this.g;
    const w = this.waves[this.wave];
    const spots = [v3(-20, 0, -20), v3(20, 0, -20), v3(-22, 0, 10), v3(22, 0, 10), v3(0, 0, -24), v3(-10, 0, 24), v3(10, 0, 24), v3(0, 0, -14)];
    let k = 0;
    for (const [c, n] of w) {
      for (let i = 0; i < n; i++) {
        const s = spots[k++ % spots.length];
        g.spawnEnemy(c, v3(s.x + Math.random() * 3, 0, s.z + Math.random() * 3), { level: 0.4 + this.wave * 0.12, name: pickName(c) });
      }
    }
    g.hud.announce(`WAVE ${this.wave + 1}`, 'info');
  }

  private alive() {
    return this.g.sim.fighters.filter((f) => f.team === 1 && !f.dead).length;
  }

  update(dt: number) {
    if (this.ended) return;
    this.time += dt;
    const g = this.g;
    const p = g.player!;
    if (this.intro > 0) this.intro -= dt;
    if (p.dead) {
      if (this.failT < 0) this.failT = 2.2;
      this.failT -= dt;
      g.hud.respawn('RETIRED…');
      if (this.failT <= 0) this.end(false);
      return;
    }
    if (this.stage === 2 && this.alive() === 0) {
      if (this.wave >= this.waves.length - 1) return this.end(true);
      this.breakT += dt;
      if (this.breakT > 3) {
        this.breakT = 0;
        this.wave++;
        this.spawnWave();
      }
    }
    if (this.stage === 3 && this.bossF) {
      if (!this.phase2 && this.bossF.hp < this.bossF.maxHp * 0.5) {
        this.phase2 = true;
        g.hud.announce('DIO GROWS SERIOUS', 'break');
        g.fx.menacing(g.tmpVec(this.bossF.pos.x, this.bossF.pos.y + 1, this.bossF.pos.z), 8, 2.5);
        audio.play('menace', 1);
        for (const x of [-14, 0, 14]) g.spawnEnemy('zombie', v3(x, 0, -22), { level: 0.55, name: pickName('zombie') });
        this.bossF.brain!.opts.level = 1;
        this.bossF.cds.timestop = 0;
      }
    }
  }

  onKO(a: Fighter | undefined, v: Fighter) {
    if (this.ended) return;
    if (v.team === 1) this.kills++;
    if (this.stage === 1 && this.kills >= this.total) setTimeout(() => this.end(true), 1500);
    if (this.stage === 3 && v === this.bossF) {
      this.g.hud.announce('VICTORY!', 'win');
      setTimeout(() => this.end(true), 2200);
    }
  }

  private end(win: boolean) {
    if (this.ended) return;
    this.ended = true;
    const g = this.g;
    const p = g.player!;
    const hpR = p.hp / p.maxHp;
    const score = win ? Math.round(30 + hpR * 35 + Math.min(20, p.stats.maxCombo) + Math.max(0, 15 - this.time / 12)) : 0;
    const r: ResultData = {
      title: win ? 'MISSION COMPLETE' : 'RETIRED',
      sub: `Mission ${this.stage}: ${MISSIONS[this.stage - 1].name}`,
      win,
      rank: win ? rankFor(score) : '—',
      rows: [
        ['Time', `${Math.floor(this.time / 60)}:${String(Math.floor(this.time % 60)).padStart(2, '0')}`],
        ['Enemies defeated', String(this.kills)],
        ['Damage dealt', String(Math.round(p.stats.dmg))],
        ['Damage taken', String(Math.round(g.dmgTaken))],
        ['Max combo', `${p.stats.maxCombo} hits`],
      ],
      canRetry: true,
      canNext: win && this.stage < MISSIONS.length,
    };
    g.finish(r);
  }

  boss() {
    return this.bossF && !this.bossF.dead ? this.bossF : this.bossF && this.bossF.dead ? this.bossF : null;
  }
  dispose() {}
  objective(): [string, string] {
    const info = MISSIONS[this.stage - 1];
    const title = `MISSION ${this.stage} — ${info.name.toUpperCase()}`;
    if (this.stage === 1) return [title, `Defeat the Stand users  ${this.kills} / ${this.total}`];
    if (this.stage === 2) {
      const left = this.alive();
      return [title, left === 0 && this.wave < this.waves.length - 1 ? `Wave ${this.wave + 2} incoming…` : `Wave ${this.wave + 1} / ${this.waves.length} — enemies left ${left}`];
    }
    return [title, this.phase2 ? 'DIO is serious. Survive and defeat him!' : 'Defeat DIO'];
  }
}
