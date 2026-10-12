// Core client: owns the renderer, scene, local simulation, views, effects and HUD.
import * as THREE from 'three';
import { World } from '../../shared/world';
import { Sim, Fighter, SimEvent, EdgeKey, emptyInput } from '../../shared/sim';
import { BotBrain, BotOpts } from '../../shared/ai';
import { CharId, CHARACTERS } from '../../shared/characters';
import { V3, v3, vdist, yawTo, wrapAngle, clamp, fwdXZ } from '../../shared/math';
import { CameraRig } from '../engine/camera';
import { Input } from '../engine/input';
import { audio, Sfx } from '../engine/audio';
import { settings } from '../engine/settings';
import { WorldView, makeSky } from '../render/worldView';
import { FighterView } from '../render/fighterView';
import { Effects, ScreenFX, FloatText } from '../render/effects';
import { Hud } from '../ui/hud';

export const STEP = 1 / 60;

export interface ResultData {
  title: string;
  sub: string;
  win: boolean;
  rank?: string;
  rows: [string, string][];
  tableHtml?: string;
  canRetry: boolean;
  canNext: boolean;
}

export interface GameMode {
  kind: 'free' | 'training' | 'mission' | 'mp';
  start(): void;
  update(dt: number): void;
  onKO(a: Fighter | undefined, v: Fighter): void;
  onEvent?(e: SimEvent): void;
  boss(): Fighter | null;
  dispose(): void;
  objective(): [string, string];
  /** True when the mode drives the simulation itself (multiplayer). */
  drivesSim?: boolean;
  frame?(dt: number): void;
  noCooldown?: boolean;
}

const ATTACK_COLOR: Partial<Record<CharId, number>> = {
  jotaro: 0x9b7bff,
  dio: 0xffd23f,
  rogue: 0xff4d6d,
  gunner: 0xffa000,
  zombie: 0x9bff9b,
  dummy: 0xffffff,
};

export class Game {
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  rig: CameraRig;
  world: World;
  worldView: WorldView;
  sun: THREE.DirectionalLight;
  sim: Sim;
  views = new Map<number, FighterView>();
  fx: Effects;
  screenFx: ScreenFX;
  floats: FloatText;
  hud: Hud;
  input: Input;
  player: Fighter | null = null;
  mode: GameMode | null = null;
  state: 'menu' | 'play' | 'paused' | 'results' = 'menu';
  testMode = new URLSearchParams(location.search).has('test');
  hitPause = 0;
  private acc = 0;
  private last = performance.now();
  private pending = new Set<EdgeKey>();
  lockOn: Fighter | null = null;
  lastTarget: Fighter | null = null;
  private lastTargetT = 0;
  dmgTaken = 0;
  playTime = 0;
  private shoutAcc = new Map<number, number>();
  private tsTickAcc = 0;
  private showcase: Fighter | null = null;
  private showT = 0;
  private fpsAcc = 0;
  private fpsN = 0;
  private lastSmallPause = 0;
  onPause: (() => void) | null = null;
  onResults: ((r: ResultData) => void) | null = null;
  /** In multiplayer the local fighter id differs from the server's; events are already mapped. */
  isMP = false;
  aimPoint = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private tsClassTimer = 0;
  /** Automation-only log of key events (enabled with ?test). */
  eventLog: { k: string; phase?: string; time: number; a?: number; q?: boolean; ab?: string }[] = [];

  constructor() {
    this.canvas = document.getElementById('game') as HTMLCanvasElement;
    const lowGfx = new URLSearchParams(location.search).has('lowgfx');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !lowGfx, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(lowGfx ? 0.5 : Math.min(window.devicePixelRatio, 1.75));
    if (lowGfx) settings.shadows = false;
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.rig.camera.aspect = window.innerWidth / window.innerHeight;
      this.rig.camera.updateProjectionMatrix();
    });

    this.scene.fog = new THREE.Fog(0xe7a2c0, 70, 260);
    this.scene.add(makeSky());
    const hemi = new THREE.HemisphereLight(0xffe7f4, 0x5a4a7a, 1.15);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -45;
    sc.right = sc.top = 45;
    sc.near = 1;
    sc.far = 160;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    const rim = new THREE.DirectionalLight(0xb48cff, 0.6);
    rim.position.set(-40, 30, -60);
    this.scene.add(rim);

    this.world = new World();
    this.worldView = new WorldView(this.world);
    this.scene.add(this.worldView.group);
    this.sim = new Sim(this.world);
    this.fx = new Effects(this.rig.camera);
    this.scene.add(this.fx.group);
    this.screenFx = new ScreenFX(document.getElementById('fx2d') as HTMLCanvasElement);
    this.floats = new FloatText(document.getElementById('floats')!, this.rig.camera);
    this.hud = new Hud(document.getElementById('hud')!);
    this.input = new Input(this.canvas);
    this.input.allowUnlocked = this.testMode;
    this.input.onLockChange = (locked) => {
      document.getElementById('click-to-play')!.classList.toggle('hidden', locked || this.state !== 'play');
      if (!locked && this.state === 'play' && !this.testMode) this.pause();
    };
    // Esc pauses even when the pointer is not locked (e.g. a multiplayer match started by the server)
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.state === 'play' && !this.input.locked) {
        e.preventDefault();
        this.pause();
      }
    });
    requestAnimationFrame((t) => this.frame(t));
  }

  // ------------------------------------------------------------------ lifecycle
  resetSim() {
    for (const v of this.views.values()) v.dispose(this.scene);
    this.views.clear();
    this.sim = new Sim(this.world);
    this.sim.spawnFn = () => this.randomPlazaSpawn();
    this.sim.onKO = (a, v) => this.mode?.onKO(a, v);
    this.player = null;
    this.lockOn = null;
    this.lastTarget = null;
    this.showcase = null;
    this.hitPause = 0;
    this.acc = 0;
    this.dmgTaken = 0;
    this.playTime = 0;
    this.pending.clear();
    this.isMP = false;
    this.clearTimeStopVisual();
  }

  randomPlazaSpawn(): V3 {
    const s = this.world.plazaSpawns[Math.floor(Math.random() * this.world.plazaSpawns.length)];
    return v3(s.x, 0, s.z);
  }

  /** Begin a mode. `setup` should create the player via addPlayer and spawn enemies. */
  begin(mode: GameMode) {
    this.mode?.dispose();
    this.mode = mode;
    this.state = 'play';
    this.hud.show(true);
    this.hud.respawn(null);
    this.hud.scoreboard(null);
    this.hud.trainingPanel.classList.add('hidden');
    this.hud.boss(null);
    this.hud.net(null);
    this.input.enabled = true;
    this.input.clear();
    mode.start();
    if (this.player) {
      this.hud.setupPlayer(this.player);
      this.rig.snapTo(this.player.pos, this.player.yaw);
    }
    this.hud.hint('Left click to lock the mouse · TAB lock-on · V to pose');
    setTimeout(() => this.hud.hint(''), 6000);
    this.lockPointer();
  }

  lockPointer() {
    if (this.testMode) return;
    this.input.requestLock();
    setTimeout(() => {
      document.getElementById('click-to-play')!.classList.toggle('hidden', this.input.locked || this.state !== 'play');
    }, 300);
  }

  addPlayer(char: CharId, pos: V3, name?: string): Fighter {
    const p = this.sim.addFighter(char, { pos, team: 0, name: name ?? CHARACTERS[char].name });
    p.yaw = p.aimYaw = Math.PI;
    this.player = p;
    return p;
  }

  spawnEnemy(char: CharId, pos: V3, opts: Partial<BotOpts> & { hpMul?: number; dmgMul?: number; name?: string; team?: number } = {}): Fighter {
    const f = this.sim.addFighter(char, { pos, team: opts.team ?? 1, isBot: true, hpMul: opts.hpMul, dmgMul: opts.dmgMul, name: opts.name });
    f.brain = new BotBrain({ level: opts.level ?? 0.5, boss: opts.boss, dummy: opts.dummy, leash: opts.leash });
    f.respawnDelay = -1;
    if (this.player) f.yaw = yawTo(f.pos, this.player.pos);
    this.fx.ring(this.tmp.set(pos.x, pos.y + 0.1, pos.z), ATTACK_COLOR[char] ?? 0xffffff, 0.3, 2.5, 0.5, true);
    this.fx.dustPuff(this.tmp, 8, 3);
    return f;
  }

  removeFighter(id: number) {
    this.sim.removeFighter(id);
    const v = this.views.get(id);
    if (v) {
      v.dispose(this.scene);
      this.views.delete(id);
    }
    if (this.lockOn?.id === id) this.lockOn = null;
    if (this.lastTarget?.id === id) this.lastTarget = null;
  }

  pause() {
    if (this.state !== 'play') return;
    this.state = 'paused';
    this.input.enabled = false;
    this.input.clear();
    this.input.exitLock();
    document.getElementById('click-to-play')!.classList.add('hidden');
    this.onPause?.();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'play';
    this.input.enabled = true;
    this.last = performance.now();
    this.lockPointer();
  }

  finish(r: ResultData) {
    if (this.state === 'results') return;
    this.state = 'results';
    this.input.enabled = false;
    this.input.exitLock();
    document.getElementById('click-to-play')!.classList.add('hidden');
    this.hud.show(false);
    setTimeout(() => this.onResults?.(r), 50);
  }

  toMenu() {
    this.mode?.dispose();
    this.mode = null;
    this.state = 'menu';
    this.input.enabled = false;
    this.input.exitLock();
    this.hud.show(false);
    document.getElementById('click-to-play')!.classList.add('hidden');
    this.resetSim();
  }

  private warmed = false;
  /** Compile every shader the game can use (effects, Stands, instanced fists/knives) up front to avoid hitches on first hit. */
  warmup() {
    if (this.warmed) return;
    this.warmed = true;
    const temp: FighterView[] = [];
    for (const c of ['jotaro', 'dio', 'gunner'] as CharId[]) {
      const f = this.sim.addFighter(c, { pos: v3(0, -50, 0) });
      const v = new FighterView(f, this.scene, { nameplate: true, isLocal: false });
      v.setWarm(true);
      temp.push(v);
      this.sim.removeFighter(f.id);
    }
    this.fx.setWarm(true);
    const done = () => {
      this.fx.setWarm(false);
      for (const v of temp) v.dispose(this.scene);
    };
    const r = this.renderer as THREE.WebGLRenderer & { compileAsync?: (s: THREE.Object3D, c: THREE.Camera) => Promise<unknown> };
    try {
      if (r.compileAsync) r.compileAsync(this.scene, this.rig.camera).then(done, done);
      else {
        r.compile(this.scene, this.rig.camera);
        done();
      }
    } catch {
      done();
    }
  }

  showcaseChar(char: CharId) {
    if (this.state !== 'menu') return;
    if (this.showcase?.char === char) return;
    this.resetSim();
    const f = this.sim.addFighter(char, { pos: v3(0, 0, 9), team: 0 });
    f.yaw = 0;
    f.standOut = true;
    f.respawnDelay = -1;
    this.showcase = f;
    this.showT = 0;
  }

  // ------------------------------------------------------------------ frame loop
  private frame(now: number) {
    requestAnimationFrame((t) => this.frame(t));
    const realDt = (now - this.last) / 1000;
    const rawDt = Math.min(0.25, realDt);
    this.last = now;
    this.fpsAcc += realDt;
    this.fpsN++;
    if (this.fpsAcc > 0.5) {
      this.hud.fps(`${Math.round(this.fpsN / this.fpsAcc)} fps`);
      (window as unknown as { __fps: number }).__fps = Math.round(this.fpsN / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsN = 0;
    }
    if (this.state === 'menu') this.updateMenu(rawDt);
    else if (this.state === 'play' || this.state === 'paused') this.updatePlay(rawDt);
    else this.updateIdle(rawDt);
    this.screenFx.update(rawDt);
    this.floats.update(rawDt);
    this.renderer.render(this.scene, this.rig.camera);
  }

  private updateIdle(dt: number) {
    this.syncViews(dt);
    this.fx.update(dt, this.sim.projectiles);
  }

  private updateMenu(dt: number) {
    this.showT += dt;
    const f = this.showcase;
    if (f) {
      if (!f.action || f.action.t > 1.9) {
        f.action = { id: 'pose', t: 0, step: 0, nextHit: 0, yaw: 0, pitch: 0, landed: false };
      }
      f.action.t += dt;
      f.energy = f.maxEnergy;
      const cam = this.rig.camera;
      const a = Math.sin(this.showT * 0.25) * 0.6 + 0.35;
      cam.position.set(f.pos.x + Math.sin(a) * 5.2, 1.9, f.pos.z + Math.cos(a) * 5.2);
      cam.lookAt(f.pos.x - 0.6, 1.35, f.pos.z);
      if (Math.random() < dt * 2.5) this.fx.menacing(this.tmp.set(f.pos.x + (Math.random() - 0.5) * 3, 0.5, f.pos.z + (Math.random() - 0.5) * 2), 1, 1.2);
    } else {
      const cam = this.rig.camera;
      cam.position.set(Math.sin(this.showT * 0.05) * 40, 22, Math.cos(this.showT * 0.05) * 40);
      cam.lookAt(0, 4, 0);
    }
    this.syncViews(dt);
    this.fx.update(dt, this.sim.projectiles);
    this.worldView.update(dt);
    this.updateSun(f ? f.pos : v3());
  }

  private updatePlay(dt: number) {
    const playing = this.state === 'play';
    if (playing) this.playTime += dt;
    const m = this.input.takeMouse();
    if (playing) this.rig.look(m.x, m.y);
    if (playing) for (const e of this.input.takeEdges()) this.pending.add(e);
    if (playing && this.input.takeLockToggle()) this.toggleLock();

    if (this.mode?.drivesSim) {
      this.mode.frame?.(dt);
    } else if (playing || this.mode?.kind === 'mp') {
      if (this.hitPause > 0) this.hitPause -= dt;
      else {
        this.acc += dt;
        let steps = 0;
        while (this.acc >= STEP && steps < 15) {
          this.buildPlayerInput();
          this.sim.step(STEP);
          this.handleEvents(this.sim.drainEvents());
          this.mode?.update(STEP);
          this.acc -= STEP;
          steps++;
        }
        if (steps === 15) this.acc = 0;
      }
    }
    this.afterSim(dt);
  }

  /** Shared per-frame work after the simulation advanced. */
  afterSim(dt: number) {
    const p = this.player;
    // remove long-dead bots
    for (const f of [...this.sim.fighters]) {
      if (f.dead && f.respawnDelay < 0 && f.deadT > 5 && f !== p && !this.isMP) this.removeFighter(f.id);
    }
    if (this.lockOn && (this.lockOn.dead || !p || vdist(this.lockOn.pos, p.pos) > 40)) this.lockOn = null;
    this.syncViews(dt);
    this.updateShouts(dt);
    this.fx.update(dt, this.sim.projectiles);
    this.worldView.update(dt);
    if (p) {
      const enemyNear = this.sim.fighters.some((o) => o !== p && !o.dead && this.sim.isEnemy(p, o) && vdist(o.pos, p.pos) < 7);
      const ts = this.sim.timeStop;
      this.rig.update(dt, p.pos, this.world, { combat: enemyNear, lock: this.lockOn ? v3(this.lockOn.pos.x, this.lockOn.pos.y + 1, this.lockOn.pos.z) : null, zoom: ts?.caster === p.id ? 0.9 : 1 });
      this.updateSun(p.pos);
      this.hud.update(p, dt, { lock: !!this.lockOn, noCooldown: this.mode?.noCooldown });
      if (this.lastTarget && (this.lastTarget.dead || this.playTime - this.lastTargetT > 6)) {
        if (this.lastTarget.dead && this.playTime - this.lastTargetT < 1.2) this.hud.target(this.lastTarget);
        else this.lastTarget = null;
      }
      this.hud.target(this.lastTarget && this.lastTarget !== this.mode?.boss() ? this.lastTarget : null);
      this.hud.boss(this.mode?.boss() ?? null);
      const [t, x] = this.mode?.objective() ?? ['', ''];
      this.hud.objective(t, x);
      // time-stop HUD + ticking clock
      if (ts) {
        const caster = this.sim.byId.get(ts.caster);
        this.hud.timeStop(true, ts.t, caster?.char === 'dio' ? 'ザ・ワールド' : 'スタープラチナ・ザ・ワールド');
        this.tsTickAcc += dt;
        if (this.tsTickAcc > 0.5) {
          this.tsTickAcc = 0;
          audio.play('tick', 0.8);
        }
        if (caster && Math.random() < dt * 4) this.fx.menacing(this.tmp.set(caster.pos.x, caster.pos.y + 0.5, caster.pos.z), 1, 2);
      } else this.hud.timeStop(false, 0);
      if (this.tsClassTimer > 0) {
        this.tsClassTimer -= dt;
        if (this.tsClassTimer <= 0 && this.sim.timeStop) {
          this.canvas.classList.remove('ts-invert');
          this.canvas.classList.add('ts-active');
        }
      }
      audio.musicIntensity = clamp(enemyNear ? 0.8 : 0.2, 0, 1);
    }
  }

  private updateSun(focus: V3) {
    this.sun.position.set(focus.x + 40, 70, focus.z + 30);
    this.sun.target.position.set(focus.x, 0, focus.z);
    this.sun.castShadow = settings.shadows;
  }

  private toggleLock() {
    if (this.lockOn) {
      this.lockOn = null;
      return;
    }
    const p = this.player;
    if (!p) return;
    let best: Fighter | null = null;
    let bestScore = 1e9;
    for (const o of this.sim.fighters) {
      if (o === p || o.dead || !this.sim.isEnemy(p, o)) continue;
      const d = vdist(o.pos, p.pos);
      if (d > 30) continue;
      const ang = Math.abs(wrapAngle(yawTo(p.pos, o.pos) - this.rig.yaw));
      const score = d + ang * 12;
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    this.lockOn = best;
    if (best) audio.play('ui', 0.6);
  }

  /** Convert keyboard/mouse state into the player's FighterInput for the next sim step. */
  buildPlayerInput() {
    const p = this.player;
    if (!p) return;
    const inp = this.sim.input(p.id);
    if (this.state !== 'play') {
      Object.assign(inp, emptyInput(), { yaw: inp.yaw, pitch: inp.pitch });
      return;
    }
    const ax = this.input.axis();
    const yaw = this.rig.yaw;
    const f = fwdXZ(yaw);
    const rx = -Math.cos(yaw);
    const rz = Math.sin(yaw);
    inp.mx = f.x * ax.y + rx * ax.x;
    inp.mz = f.z * ax.y + rz * ax.x;
    // aim: from the hand toward whatever is under the crosshair
    this.rig.aimPoint(this.world, this.aimPoint);
    const hx = p.pos.x;
    const hy = p.pos.y + 1.5;
    const hz = p.pos.z;
    const dx = this.aimPoint.x - hx;
    const dy = this.aimPoint.y - hy;
    const dz = this.aimPoint.z - hz;
    const dxz = Math.hypot(dx, dz);
    if (this.lockOn) {
      inp.yaw = yawTo(p.pos, this.lockOn.pos);
      inp.pitch = Math.atan2(this.lockOn.pos.y + 1 - hy, Math.max(0.5, vdist(this.lockOn.pos, p.pos)));
    } else if (dxz > 4) {
      inp.yaw = Math.atan2(dx, dz);
      inp.pitch = Math.atan2(dy, dxz);
    } else {
      inp.yaw = yaw;
      inp.pitch = this.rig.pitch;
    }
    inp.block = this.input.blockHeld;
    for (const e of this.pending) inp[e] = true;
    this.pending.clear();
  }

  private syncViews(dt: number) {
    for (const f of this.sim.fighters) {
      if (!this.views.has(f.id)) {
        this.views.set(f.id, new FighterView(f, this.scene, { nameplate: f !== this.player && f !== this.showcase, isLocal: f === this.player }));
      }
    }
    for (const [id, v] of this.views) {
      if (!this.sim.byId.has(id)) {
        v.dispose(this.scene);
        this.views.delete(id);
        continue;
      }
      v.f = this.sim.byId.get(id)!;
      v.update(dt, this.fx, !!this.sim.timeStop);
    }
  }

  private updateShouts(dt: number) {
    const cam = this.rig.camera.position;
    for (const f of this.sim.fighters) {
      if (f.action?.id !== 'barrage' || f.frozen) continue;
      if (this.tmp.set(f.pos.x, f.pos.y, f.pos.z).distanceTo(cam) > 45) continue;
      const acc = (this.shoutAcc.get(f.id) ?? 0) + dt;
      if (acc > 0.13) {
        this.shoutAcc.set(f.id, 0);
        const side = Math.random() < 0.5 ? -1 : 1;
        const c = Math.cos(f.yaw);
        const s = Math.sin(f.yaw);
        const ox = side * (0.8 + Math.random() * 1.4);
        this.tmp.set(f.pos.x + ox * c + s * 1.4, f.pos.y + 1.2 + Math.random() * 1.6, f.pos.z - ox * s + c * 1.4);
        this.floats.spawn(this.tmp, f.def.shout + '!', 'shout ' + f.char, 0.55, 1.6);
      } else this.shoutAcc.set(f.id, acc);
    }
  }

  // ------------------------------------------------------------------ events → feedback
  private vol(pos: V3): number {
    const p = this.player?.pos ?? pos;
    return clamp(1 - vdist(pos, p) / 50, 0, 1);
  }
  private sfx(name: Sfx, pos: V3, mul = 1) {
    audio.play(name, this.vol(pos) * mul);
  }

  handleEvents(events: SimEvent[]) {
    const p = this.player;
    for (const e of events) {
      this.mode?.onEvent?.(e);
      if (this.testMode && (e.k === 'ts' || e.k === 'ko' || e.k === 'respawn' || e.k === 'hit' || e.k === 'action' || e.k === 'proj')) {
        this.eventLog.push({ k: e.k, phase: e.k === 'ts' ? e.phase : undefined, time: this.sim.time, a: e.k === 'hit' ? e.a : e.k === 'action' ? e.id : e.k === 'proj' ? e.owner : undefined, q: e.k === 'hit' ? e.queued : undefined, ab: e.k === 'action' ? e.ab : e.k === 'proj' ? e.kind : undefined });
        if (this.eventLog.length > 200) this.eventLog.shift();
      }
      switch (e.k) {
        case 'hit': {
          const a = this.sim.byId.get(e.a);
          const v = this.sim.byId.get(e.v);
          const pos = this.tmp.set(e.pos.x, e.pos.y, e.pos.z);
          const col = (a && ATTACK_COLOR[a.char]) ?? 0xffffff;
          const mine = !!p && (e.a === p.id || e.v === p.id);
          if (e.perfect) {
            this.fx.ring(pos, 0x9ad7ff, 0.3, 3.2, 0.35);
            this.fx.sparks(pos, 0x9ad7ff, 22, 10);
            this.sfx('perfect', e.pos);
            if (mine) this.hitPause = Math.max(this.hitPause, 0.12);
            break;
          }
          if (e.blocked) {
            this.fx.sparks(pos, 0x9ad7ff, 6, 5, 0.12);
            this.sfx('block', e.pos, 0.8);
            if (mine) this.floats.spawn(pos, e.dmg.toFixed(1), 'dmg blocked', 0.6);
            break;
          }
          const heavy = e.heavy || e.dmg >= 10 || e.ab === 'resume';
          const small = e.ab === 'barrage' && e.dmg < 3;
          if (!small || Math.random() < 0.35) this.fx.burst(pos, heavy ? 2.4 : small ? 0.9 : 1.4, heavy ? 0.22 : 0.15);
          this.fx.sparks(pos, col, heavy ? 28 : small ? 5 : 12, heavy ? 12 : 8);
          if (!small) this.fx.ring(pos, col, 0.2, heavy ? 3.2 : 1.8, heavy ? 0.35 : 0.22);
          if (e.ab === 'proj') this.sfx('knife_hit', e.pos);
          this.sfx(heavy ? 'heavy' : 'punch', e.pos, small ? 0.6 : 1);
          if (v && !e.queued) {
            const cls = 'dmg' + (heavy ? ' big' : '') + (v === p ? ' player' : '');
            if (!small || Math.random() < 0.5) this.floats.spawn(this.tmp2.set(v.pos.x, v.pos.y + 2.1, v.pos.z), String(Math.round(e.dmg)), cls, heavy ? 1.1 : 0.7);
          }
          if (e.queued) this.floats.spawn(this.tmp2.set(e.pos.x, e.pos.y + 0.6, e.pos.z), String(Math.round(e.dmg)), 'dmg queued', 0.9, 0.3);
          if (mine) {
            this.rig.addTrauma(heavy ? 0.5 : small ? 0.07 : 0.2);
            if (!this.isMP && !e.queued) {
              const now = this.playTime;
              if (heavy) this.hitPause = Math.max(this.hitPause, 0.085);
              else if (!small) this.hitPause = Math.max(this.hitPause, 0.045);
              else if (now - this.lastSmallPause > 0.25) {
                this.hitPause = Math.max(this.hitPause, 0.012);
                this.lastSmallPause = now;
              }
            }
            if (heavy) this.screenFx.focusLines(0.6);
          }
          if (p && e.v === p.id) {
            this.screenFx.doFlash(heavy ? 0.35 : 0.15, '255,40,70');
            this.dmgTaken += e.dmg;
            if (a) {
              this.lastTarget = a;
              this.lastTargetT = this.playTime;
            }
          }
          if (p && e.a === p.id) {
            this.hud.combo(e.combo, e.dmg);
            if (e.combo === 20 || e.combo === 35 || e.combo === 50) {
              this.hud.announce(`${e.combo} HIT COMBO!`, 'info');
              audio.play('announce', 0.7);
            }
            if (v) {
              this.lastTarget = v;
              this.lastTargetT = this.playTime;
            }
          }
          break;
        }
        case 'ko': {
          const a = this.sim.byId.get(e.a);
          const v = this.sim.byId.get(e.v);
          if (v) {
            const pos = this.tmp.set(v.pos.x, v.pos.y + 1.2, v.pos.z);
            this.fx.burst(pos, 3.2, 0.35);
            this.fx.ring(pos, 0xff4d6d, 0.3, 5, 0.5);
            this.fx.sparks(pos, 0xffd23f, 40, 14);
            this.sfx('ko', v.pos);
          }
          if (a && v && (a === p || v === p || this.isMP)) this.hud.killfeed(`${a.name}  ✦ K.O. ✦  ${v.name}`);
          if (v === p) {
            this.rig.addTrauma(0.6);
            this.screenFx.doFlash(0.5, '255,0,40');
          }
          break;
        }
        case 'announce': {
          const show = (p && e.id === p.id) || e.style === 'ts' || (this.isMP && e.style === 'ko') || (e.style === 'perfect' && this.lastTarget?.id === e.id);
          if (show) {
            this.hud.announce(e.text, e.style ?? (e.text === 'STAND RUSH' ? '' : 'info'));
            if (e.style !== 'ko') audio.play('announce', 0.8);
          }
          break;
        }
        case 'action': {
          const f = this.sim.byId.get(e.id);
          if (!f) break;
          if (e.ab === 'combo') this.sfx('whoosh', f.pos, 0.35);
          if (e.ab === 'uppercut') this.sfx('whoosh', f.pos, 0.8);
          if (e.ab === 'barrage' && f === p) this.screenFx.focusLines(0.5);
          if (e.ab === 'leap') {
            this.sfx('boost', f.pos);
            this.fx.dustPuff(this.tmp.set(f.pos.x, f.pos.y, f.pos.z), 14, 6);
            if (f === p) {
              this.screenFx.speedLines(0.8);
              this.rig.kickFov(8);
            }
          }
          if (e.ab === 'pose') this.sfx('menace', f.pos, 0.9);
          break;
        }
        case 'summon': {
          const f = this.sim.byId.get(e.id);
          if (f) this.sfx(e.out ? 'summon' : 'dismiss', f.pos);
          break;
        }
        case 'dash': {
          const f = this.sim.byId.get(e.id);
          if (!f) break;
          this.sfx('whoosh', f.pos, e.special ? 1 : 0.7);
          this.fx.dustPuff(this.tmp.set(f.pos.x, f.pos.y, f.pos.z), 6, 3);
          if (e.special) this.fx.sparks(this.tmp.set(f.pos.x, f.pos.y + 1, f.pos.z), 0xffd23f, 18, 6, 0.2);
          if (f === p) {
            this.screenFx.speedLines(e.special ? 1 : 0.55);
            this.rig.kickFov(e.special ? 10 : 6);
          }
          break;
        }
        case 'jump': {
          const f = this.sim.byId.get(e.id);
          if (!f) break;
          if (e.boost) {
            this.sfx('boost', f.pos);
            this.fx.ring(this.tmp.set(f.pos.x, f.pos.y + 0.1, f.pos.z), ATTACK_COLOR[f.char] ?? 0xffffff, 0.3, 2.2, 0.35, true);
            this.fx.sparks(this.tmp, ATTACK_COLOR[f.char] ?? 0xffffff, 12, 6);
            if (f === p) this.screenFx.speedLines(0.5);
          } else if (f === p) audio.play('jump', 0.6);
          break;
        }
        case 'land': {
          const f = this.sim.byId.get(e.id);
          if (!f || !e.hard) break;
          this.fx.dustPuff(this.tmp.set(f.pos.x, f.pos.y, f.pos.z), 14, 6);
          this.fx.ring(this.tmp.set(f.pos.x, f.pos.y + 0.1, f.pos.z), 0xffffff, 0.3, 3, 0.35, true);
          this.sfx('land', f.pos);
          if (f === p) this.rig.addTrauma(0.25);
          break;
        }
        case 'ts': {
          const caster = this.sim.byId.get(e.caster);
          const col = caster?.char === 'dio' ? 0xffd23f : 0x9b7bff;
          const pos = this.tmp.set(e.pos.x, e.pos.y + 1, e.pos.z);
          if (e.phase === 'windup') {
            audio.play('ts_start', Math.max(0.5, this.vol(e.pos)));
            this.fx.menacing(pos, 6, 2.5);
            this.screenFx.focusLines(1);
          } else if (e.phase === 'start') {
            this.fx.timeStopWave(pos, col, 38, 'in');
            this.canvas.classList.add('ts-invert');
            this.canvas.classList.remove('ts-active');
            this.tsClassTimer = 0.28;
            this.fx.frozenWorld = true;
            this.screenFx.doFlash(0.5);
            this.rig.addTrauma(0.4);
          } else {
            this.clearTimeStopVisual();
            this.fx.timeStopWave(pos, col, 38, 'out');
            audio.play('ts_end', 0.9);
            this.hud.announce('TIME RESUMES', 'info');
          }
          break;
        }
        case 'proj': {
          const f = this.sim.byId.get(e.owner);
          this.sfx(e.kind === 'knife' ? 'knife' : 'gun', e.pos);
          if (f && e.kind === 'bullet') this.fx.sparks(this.tmp.set(f.pos.x + Math.sin(f.yaw), f.pos.y + 1.45, f.pos.z + Math.cos(f.yaw)), 0xffd23f, 6, 4, 0.15);
          break;
        }
        case 'guardbreak': {
          const f = this.sim.byId.get(e.id);
          if (f) {
            this.sfx('break', f.pos);
            this.fx.sparks(this.tmp.set(f.pos.x, f.pos.y + 1.3, f.pos.z), 0xff9b3d, 20, 8);
          }
          break;
        }
        case 'respawn': {
          this.fx.ring(this.tmp.set(e.pos.x, e.pos.y + 0.1, e.pos.z), 0xffd23f, 0.3, 3, 0.5, true);
          if (p && e.id === p.id) this.rig.snapTo(e.pos, this.rig.yaw);
          break;
        }
        default:
          break;
      }
    }
  }

  tmpVec(x: number, y: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(x, y, z);
  }

  clearTimeStopVisual() {
    this.canvas.classList.remove('ts-invert', 'ts-active');
    this.fx.frozenWorld = false;
    this.tsClassTimer = 0;
  }
}
