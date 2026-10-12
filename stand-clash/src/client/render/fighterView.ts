// Renders one fighter (user + Stand) and drives all procedural animation from the sim state.
import * as THREE from 'three';
import type { Fighter } from '../../shared/sim';
import { COMBO_STEP_TIME } from '../../shared/characters';
import { damp, dampAngle, lerp, clamp } from '../../shared/math';
import { makeRig, Rig, JointName, JOINTS, STAND_OF, STAND_COLOR, standFistGeometry, knifeGeometry, gunGeometry } from './models';
import type { Effects } from './effects';

type V = [number, number, number];
type Pose = Record<JointName, V> & { lift: number };

function newPose(): Pose {
  const p = { lift: 0 } as Pose;
  for (const j of JOINTS) p[j] = [0, 0, 0];
  return p;
}
function reset(p: Pose) {
  for (const j of JOINTS) {
    const a = p[j];
    a[0] = a[1] = a[2] = 0;
  }
  p.lift = 0;
}
const set = (p: Pose, j: JointName, x: number, y = 0, z = 0) => {
  const a = p[j];
  a[0] = x;
  a[1] = y;
  a[2] = z;
};

const GUARD: [number, number] = [-0.75, -1.75];
const WINDUP: [number, number] = [-0.25, -2.1];
const EXTEND: [number, number] = [-1.57, -0.05];

/** Arm pose along a punch: k<0 chambering, 0 guard, 1 fully extended. */
function punchArm(p: Pose, side: 'L' | 'R', k: number, spread = 0.12) {
  const sh = side === 'L' ? 'shL' : 'shR';
  const el = side === 'L' ? 'elL' : 'elR';
  const inward = side === 'L' ? -spread : spread;
  if (k < 0) {
    const w = Math.min(1, -k / 0.4);
    set(p, sh, lerp(GUARD[0], WINDUP[0], w), inward * 0.5, 0);
    set(p, el, lerp(GUARD[1], WINDUP[1], w));
  } else {
    set(p, sh, lerp(GUARD[0], EXTEND[0], k), lerp(inward * 2, inward, k), 0);
    set(p, el, lerp(GUARD[1], EXTEND[1], k));
  }
}

/** Punch extension curve for an attack with a hit moment at hitT and total length `end`. */
function punchK(t: number, hitT: number, end: number): number {
  const w = hitT * 0.65;
  if (t < w) return -0.4 * (t / w);
  if (t < hitT) return lerp(-0.4, 1, (t - w) / (hitT - w));
  if (t < hitT + 0.08) return 1;
  return Math.max(0, 1 - (t - hitT - 0.08) / Math.max(0.05, end - hitT - 0.08));
}

const COMBO_HIT_T = [0.09, 0.09, 0.16];

export interface ViewOpts {
  nameplate: boolean;
  isLocal: boolean;
}

export class FighterView {
  root = new THREE.Group();
  user: Rig;
  stand: Rig | null = null;
  standRoot = new THREE.Group();
  private fists: THREE.InstancedMesh | null = null;
  private fistsOut: THREE.InstancedMesh | null = null;
  private standK = 0;
  private standWorld = new THREE.Vector3();
  private standYaw = 0;
  private pose = newPose();
  private sPose = newPose();
  private animT = 0;
  private runPhase = 0;
  private nameplate: THREE.Sprite | null = null;
  private npCanvas: HTMLCanvasElement | null = null;
  private npKey = '';
  private heldKnives: THREE.Group | null = null;
  private gun: THREE.Mesh | null = null;
  private auraColor: number;
  private standColor = 0xffffff;
  private auraAcc = 0;
  private trailKey = '';
  private menaceAcc = 0;
  private m4 = new THREE.Matrix4();
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private sc = new THREE.Vector3();
  private baseEmissive = new THREE.Color(0, 0, 0);
  private standEmissive = new THREE.Color(0, 0, 0);
  private wasStandOut = false;
  deadHidden = false;
  private frameDt = 1 / 60;
  private static WHITE = new THREE.Color(1, 1, 1);

  constructor(public f: Fighter, scene: THREE.Object3D, public opts: ViewOpts) {
    this.user = makeRig(f.char);
    this.root.add(this.user.root);
    scene.add(this.root);
    this.auraColor = new THREE.Color(f.def.color).getHex();
    const standName = STAND_OF[f.char];
    if (standName) {
      this.standColor = STAND_COLOR[standName] ?? 0xffffff;
      this.stand = makeRig(standName, 0x000000);
      this.standEmissive.setHex(this.standColor).multiplyScalar(0.18);
      this.stand.material.emissive.copy(this.standEmissive);
      this.standRoot.add(this.stand.root);
      this.standRoot.visible = false;
      scene.add(this.standRoot);
      const fg = standFistGeometry(standName);
      this.fists = new THREE.InstancedMesh(fg.geo, this.stand.material, 18);
      this.fistsOut = new THREE.InstancedMesh(fg.out, new THREE.MeshBasicMaterial({ color: 0x120a18, side: THREE.BackSide }), 18);
      this.fists.count = this.fistsOut.count = 0;
      this.fists.frustumCulled = this.fistsOut.frustumCulled = false;
      this.standRoot.add(this.fists, this.fistsOut);
    }
    if (f.char === 'dio') {
      this.heldKnives = new THREE.Group();
      const kg = knifeGeometry();
      const km = new THREE.MeshLambertMaterial({ vertexColors: true });
      for (let i = 0; i < 4; i++) {
        const k = new THREE.Mesh(kg, km);
        k.rotation.set(Math.PI / 2, (i - 1.5) * 0.35, 0);
        k.position.set((i - 1.5) * 0.03, -0.05, 0);
        this.heldKnives.add(k);
      }
      this.heldKnives.visible = false;
      this.user.handR.add(this.heldKnives);
    }
    if (f.char === 'gunner') {
      this.gun = new THREE.Mesh(gunGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x332200 }));
      this.gun.rotation.set(Math.PI / 2, 0, 0);
      this.gun.position.set(0, -0.06, 0.04);
      this.gun.visible = false;
      this.user.handR.add(this.gun);
    }
    if (opts.nameplate) {
      this.npCanvas = document.createElement('canvas');
      this.npCanvas.width = 256;
      this.npCanvas.height = 64;
      const tex = new THREE.CanvasTexture(this.npCanvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.nameplate = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      this.nameplate.scale.set(2.0, 0.5, 1);
      this.nameplate.position.y = 2.65;
      this.nameplate.renderOrder = 10;
      this.root.add(this.nameplate);
    }
    this.root.position.set(f.pos.x, f.pos.y, f.pos.z);
    this.standWorld.copy(this.root.position);
  }

  dispose(scene: THREE.Object3D) {
    scene.remove(this.root);
    scene.remove(this.standRoot);
    this.user.material.dispose();
    this.stand?.material.dispose();
    this.nameplate?.material.map?.dispose();
    this.nameplate?.material.dispose();
  }

  /** Force Stand + barrage fists visible for shader pre-compilation. */
  setWarm(on: boolean) {
    this.standRoot.visible = on || this.standK > 0.01;
    if (this.fists && this.fistsOut) this.fists.count = this.fistsOut.count = on ? 1 : 0;
    if (this.heldKnives) this.heldKnives.visible = on;
    if (this.gun) this.gun.visible = on;
  }

  /** World-space point roughly at the Stand's fists (used for effects). */
  standFront(out: THREE.Vector3, reach = 1.8): THREE.Vector3 {
    const f = this.f;
    return out.set(f.pos.x + Math.sin(f.yaw) * reach, f.pos.y + 1.35, f.pos.z + Math.cos(f.yaw) * reach);
  }

  private drawNameplate() {
    const f = this.f;
    const ratio = clamp(f.hp / f.maxHp, 0, 1);
    const key = `${f.name}|${Math.round(ratio * 60)}|${f.dead}`;
    if (key === this.npKey || !this.npCanvas || !this.nameplate) return;
    this.npKey = key;
    const g = this.npCanvas.getContext('2d')!;
    g.clearRect(0, 0, 256, 64);
    g.font = '900 24px "Arial Black", Impact, sans-serif';
    g.textAlign = 'center';
    g.lineWidth = 5;
    g.strokeStyle = '#140a1e';
    g.strokeText(f.name, 128, 24);
    g.fillStyle = f.isBot && f.team !== 0 ? '#ffd2e4' : '#fff6c8';
    g.fillText(f.name, 128, 24);
    g.fillStyle = '#140a1e';
    g.fillRect(28, 34, 200, 18);
    g.fillStyle = ratio > 0.5 ? '#5cff8a' : ratio > 0.25 ? '#ffd23f' : '#ff4d6d';
    g.fillRect(31, 37, 194 * ratio, 12);
    (this.nameplate.material.map as THREE.Texture).needsUpdate = true;
  }

  update(dt: number, fx: Effects, worldFrozen: boolean) {
    const f = this.f;
    const adt = f.frozen ? 0 : dt;
    this.frameDt = adt;
    this.animT += adt;
    this.root.position.set(f.pos.x, f.pos.y, f.pos.z);
    this.root.rotation.y = f.yaw;
    // blink while invulnerable after respawn
    this.root.visible = !(f.invuln > 0.35 && !f.dead && Math.floor(this.animT * 14) % 2 === 0 && f.invuln < 1.6);
    if (f.dead && f.deadT > 3 && f.respawnDelay < 0) {
      this.root.position.y -= Math.min(1.5, (f.deadT - 3) * 0.8);
    }

    // hit flash / frozen tint
    const flash = f.hitFlash > 0 ? Math.min(1, f.hitFlash / 0.14) : 0;
    this.user.material.emissive.copy(this.baseEmissive).lerp(FighterView.WHITE, flash * 0.85);

    this.computeUserPose(f);
    this.applyPose(this.user, this.pose, adt, this.poseRate(f));

    // held props
    if (this.heldKnives) this.heldKnives.visible = f.action?.id === 'knives' && f.action.t < 0.17;
    if (this.gun) this.gun.visible = f.standOut || f.action?.id === 'shoot';

    this.updateStand(f, dt, adt, fx);
    if (this.nameplate) {
      this.nameplate.visible = !f.dead;
      this.drawNameplate();
    }

    // aura + menacing
    if (!worldFrozen || !f.frozen) {
      const posing = f.action?.id === 'pose';
      const strong = posing || f.action?.id === 'barrage' || f.action?.id === 'timestop';
      if ((f.standOut || strong) && !f.dead) {
        this.auraAcc += dt * (strong ? 40 : 10);
        while (this.auraAcc > 1) {
          this.auraAcc--;
          fx.aura(this.root.position, this.auraColor, 0.55, 2.0);
          if (this.stand && this.standK > 0.5) fx.aura(this.standWorld, this.standColor, 0.6, 2.1);
        }
      }
      if (posing && !f.dead) {
        this.menaceAcc += dt;
        if (this.menaceAcc > 0.35) {
          this.menaceAcc = 0;
          fx.menacing(this.tmpV.copy(this.root.position).add(this.tmpV2.set(0, 0.8, 0)), 1, 1.4);
        }
      }
    }
  }

  private poseRate(f: Fighter): number {
    if (f.dead) return 8;
    if (f.action && f.action.id !== 'pose') return 32;
    if (f.stun > 0 || f.blocking || f.dashT > 0) return 24;
    return 14;
  }

  private applyPose(rig: Rig, p: Pose, dt: number, rate: number) {
    for (const j of JOINTS) {
      const r = rig.joints[j].rotation;
      const t = p[j];
      r.x = damp(r.x, t[0], rate, dt);
      r.y = damp(r.y, t[1], rate, dt);
      r.z = damp(r.z, t[2], rate, dt);
    }
    const pel = rig.joints.pelvis.position;
    pel.y = damp(pel.y, 0.95 + p.lift, rate, dt);
  }

  // ---------------------------------------------------------------- user pose
  private computeUserPose(f: Fighter) {
    const P = this.pose;
    reset(P);
    const t = this.animT;
    const hv = Math.hypot(f.vel.x, f.vel.z);
    const a = f.action;
    const standDoesIt = f.standOut && !!this.stand;

    if (f.dead) {
      set(P, 'pelvis', -1.5, 0, 0.1);
      P.lift = -0.72;
      set(P, 'shL', -0.3, 0, 1.4);
      set(P, 'shR', -0.3, 0, -1.4);
      set(P, 'hipL', -0.2, 0, 0.25);
      set(P, 'hipR', 0.1, 0, -0.2);
      set(P, 'head', -0.3, 0.4, 0);
      return;
    }
    if (f.launched && !f.grounded) {
      set(P, 'pelvis', -t * 9, 0, 0);
      set(P, 'shL', -2.5, 0, 0.6);
      set(P, 'shR', -2.5, 0, -0.6);
      set(P, 'hipL', -0.8, 0, 0.2);
      set(P, 'knL', 1.2);
      set(P, 'hipR', -0.6, 0, -0.2);
      set(P, 'knR', 1.0);
      return;
    }
    if (f.stun > 0) {
      const w = Math.sin(t * 30) * 0.05;
      set(P, 'torso', -0.38 + w, 0.15, 0);
      set(P, 'head', -0.35, -0.2, 0.1);
      set(P, 'shL', -0.5, 0, 0.5);
      set(P, 'shR', -0.4, 0, -0.6);
      set(P, 'elL', -0.4);
      set(P, 'elR', -0.3);
      set(P, 'hipL', -0.3);
      set(P, 'knL', 0.4);
      set(P, 'hipR', 0.25);
      set(P, 'knR', 0.3);
      P.lift = -0.06;
      return;
    }
    // locomotion base
    this.locomotion(P, f, hv);

    if (f.blocking && !standDoesIt) {
      set(P, 'torso', 0.15, 0, 0);
      set(P, 'shL', -1.35, -0.55, 0);
      set(P, 'elL', -1.65);
      set(P, 'shR', -1.25, 0.55, 0);
      set(P, 'elR', -1.75);
      set(P, 'head', 0.15);
    } else if (f.blocking) {
      set(P, 'shR', -1.3, 0.3, 0);
      set(P, 'elR', -0.2);
      set(P, 'torso', 0.1, 0, 0);
    }

    if (!a) {
      if (f.dashT > 0) {
        set(P, 'torso', 0.6, 0, 0);
        set(P, 'shL', 1.1, 0, 0.3);
        set(P, 'shR', 1.1, 0, -0.3);
        set(P, 'elL', -0.2);
        set(P, 'elR', -0.2);
        set(P, 'hipL', -0.7);
        set(P, 'knL', 1.1);
        set(P, 'hipR', 0.6);
        set(P, 'knR', 0.4);
        set(P, 'head', -0.4);
      }
      return;
    }
    const at = a.t;
    switch (a.id) {
      case 'combo': {
        const end = COMBO_STEP_TIME[a.step];
        const k = punchK(at, COMBO_HIT_T[a.step], end);
        if (standDoesIt) {
          // commanding gesture while the Stand punches
          set(P, 'shR', -1.35 - k * 0.15, 0.25, 0);
          set(P, 'elR', -0.15);
          set(P, 'torso', 0.08, -0.2, 0);
        } else {
          const side = a.step === 1 ? 'L' : 'R';
          punchArm(P, side, k);
          punchArm(P, side === 'L' ? 'R' : 'L', 0);
          const tw = (side === 'R' ? 0.4 : -0.4) * Math.max(0, k) * (a.step === 2 ? 1.4 : 1);
          set(P, 'torso', 0.12 + (a.step === 2 ? 0.15 * Math.max(0, k) : 0), tw, 0);
          set(P, 'hipL', -0.45);
          set(P, 'knL', 0.35);
          set(P, 'hipR', 0.35);
          set(P, 'knR', 0.2);
        }
        break;
      }
      case 'barrage':
        if (f.char === 'dio') {
          set(P, 'torso', -0.2, 0.35, 0);
          set(P, 'shL', -0.2, 0, 1.2);
          set(P, 'shR', -1.5, 0.3, 0);
          set(P, 'elL', -0.3);
          set(P, 'head', -0.15, -0.2, 0);
        } else if (standDoesIt) {
          set(P, 'shR', -1.55, 0.2, 0);
          set(P, 'shL', 0.1, 0, 0.2);
          set(P, 'torso', 0.1, -0.25, 0);
        } else {
          punchArm(P, 'R', 0.5 + 0.5 * Math.sin(t * 40));
          punchArm(P, 'L', 0.5 + 0.5 * Math.sin(t * 40 + Math.PI));
        }
        set(P, 'hipL', -0.4);
        set(P, 'knL', 0.4);
        set(P, 'hipR', 0.35);
        set(P, 'knR', 0.25);
        break;
      case 'uppercut':
        set(P, 'shR', -1.4, 0.2, 0);
        set(P, 'torso', 0.2, -0.3, 0);
        P.lift = at < 0.3 ? -0.12 : 0;
        set(P, 'knL', 0.5);
        set(P, 'knR', 0.5);
        set(P, 'hipL', -0.4);
        break;
      case 'leap':
        set(P, 'torso', 0.4, 0, 0);
        set(P, 'hipL', -1.2);
        set(P, 'knL', 1.8);
        set(P, 'hipR', -0.9);
        set(P, 'knR', 1.6);
        set(P, 'shL', 0.6, 0, 0.5);
        set(P, 'shR', 0.6, 0, -0.5);
        break;
      case 'evade':
        set(P, 'torso', 0.55, 0, 0);
        set(P, 'shL', 1.2, 0, 0.3);
        set(P, 'shR', 1.2, 0, -0.3);
        set(P, 'hipL', -0.8);
        set(P, 'knL', 1.2);
        set(P, 'hipR', 0.5);
        break;
      case 'knives': {
        const thrown = at >= 0.16;
        if (!thrown) {
          set(P, 'shR', -0.6, 0, 1.1);
          set(P, 'elR', -1.5);
          set(P, 'torso', 0.05, 0.45, 0);
        } else {
          set(P, 'shR', -1.45, 0, -0.75);
          set(P, 'elR', -0.1);
          set(P, 'torso', 0.12, -0.45, 0);
        }
        set(P, 'shL', -0.4, 0, 0.6);
        set(P, 'hipL', -0.35);
        set(P, 'hipR', 0.3);
        break;
      }
      case 'shoot': {
        const recoil = at > 0.15 && at < 0.25 ? 0.35 : 0;
        set(P, 'shR', -1.57 - f.aimPitch - recoil, 0.15, 0);
        set(P, 'elR', 0);
        set(P, 'torso', 0.05, -0.3, 0);
        break;
      }
      case 'timestop':
        if (f.char === 'dio') {
          set(P, 'torso', -0.3, 0, 0);
          set(P, 'head', -0.3);
          set(P, 'shL', -0.5, 0, 1.45);
          set(P, 'shR', -0.5, 0, -1.45);
          set(P, 'elL', -0.3);
          set(P, 'elR', -0.3);
        } else {
          set(P, 'shR', -1.6, 0.1, 0);
          set(P, 'elR', -0.1);
          set(P, 'shL', -2.3, 0, 0.3);
          set(P, 'elL', -1.6);
          set(P, 'head', 0.15);
        }
        set(P, 'hipL', -0.25, 0, 0.15);
        set(P, 'hipR', 0.2, 0, -0.15);
        break;
      case 'pose':
        this.jojoPose(P, f);
        break;
    }
  }

  private locomotion(P: Pose, f: Fighter, hv: number) {
    const t = this.animT;
    if (!f.grounded) {
      if (f.boostT > 0) {
        set(P, 'hipL', -1.3);
        set(P, 'knL', 2.0);
        set(P, 'hipR', -1.1);
        set(P, 'knR', 1.9);
        set(P, 'torso', 0.35);
        set(P, 'shL', -0.6, 0, 0.9);
        set(P, 'shR', -0.6, 0, -0.9);
        return;
      }
      const up = f.vel.y > 0;
      set(P, 'hipL', up ? -0.8 : -0.35);
      set(P, 'knL', up ? 1.3 : 0.5);
      set(P, 'hipR', up ? 0.25 : 0.1);
      set(P, 'knR', up ? 0.5 : 0.25);
      set(P, 'shL', up ? -0.4 : -0.9, 0, 0.6);
      set(P, 'shR', up ? 0.4 : -0.9, 0, -0.6);
      set(P, 'elL', -0.5);
      set(P, 'elR', -0.5);
      set(P, 'torso', up ? 0.15 : -0.05);
      return;
    }
    if (hv > 0.6) {
      const s = Math.min(1, hv / 9);
      this.runPhase += hv * 1.3 * this.frameDt;
      const ph = this.runPhase;
      set(P, 'hipL', Math.sin(ph) * 1.0 * s);
      set(P, 'hipR', -Math.sin(ph) * 1.0 * s);
      set(P, 'knL', Math.max(0, -Math.cos(ph)) * 1.5 * s + 0.1);
      set(P, 'knR', Math.max(0, Math.cos(ph)) * 1.5 * s + 0.1);
      set(P, 'shL', -Math.sin(ph) * 0.9 * s, 0, 0.1);
      set(P, 'shR', Math.sin(ph) * 0.9 * s, 0, -0.1);
      set(P, 'elL', -0.9 * s);
      set(P, 'elR', -0.9 * s);
      set(P, 'torso', 0.22 * s, Math.sin(ph) * 0.12 * s, 0);
      set(P, 'head', -0.15 * s);
      P.lift = Math.abs(Math.sin(ph)) * 0.07 * s - 0.03 * s;
      return;
    }
    // idle
    const br = Math.sin(t * 2.2) * 0.025;
    set(P, 'torso', 0.03 + br);
    set(P, 'head', -br);
    if (f.char === 'jotaro') {
      // hands in coat pockets
      set(P, 'shL', 0.25, 0, 0.12);
      set(P, 'shR', 0.25, 0, -0.12);
      set(P, 'elL', -0.55);
      set(P, 'elR', -0.55);
    } else if (f.char === 'dio') {
      set(P, 'torso', -0.08 + br, 0.12, 0);
      set(P, 'head', -0.12, 0.1, 0);
      set(P, 'shL', 0.05, 0, 0.25);
      set(P, 'shR', -0.2, 0, -0.35);
      set(P, 'elR', -0.6);
    } else if (f.char === 'zombie') {
      set(P, 'shL', -1.2 + br * 4, 0, 0.1);
      set(P, 'shR', -1.25 - br * 4, 0, -0.1);
      set(P, 'torso', 0.25);
      set(P, 'head', 0.2, 0, 0.2);
    } else {
      set(P, 'shL', 0.05, 0, 0.12);
      set(P, 'shR', 0.05, 0, -0.12);
      set(P, 'elL', -0.2);
      set(P, 'elR', -0.2);
    }
    set(P, 'hipL', 0, 0, 0.06);
    set(P, 'hipR', 0, 0, -0.06);
  }

  private jojoPose(P: Pose, f: Fighter) {
    if (f.char === 'jotaro') {
      set(P, 'torso', 0.05, -0.4, 0);
      set(P, 'head', 0.12, 0.35, 0.08);
      set(P, 'shR', -1.8, 0.45, 0);
      set(P, 'elR', -0.05);
      set(P, 'shL', -2.5, -0.3, 0.3);
      set(P, 'elL', -1.7);
      set(P, 'hipL', -0.35, 0, 0.3);
      set(P, 'knL', 0.25);
      set(P, 'hipR', 0.15, 0, -0.12);
    } else if (f.char === 'dio') {
      set(P, 'pelvis', 0, 0, 0.15);
      set(P, 'torso', -0.38, 0.45, 0.1);
      set(P, 'head', -0.3, -0.35, 0.2);
      set(P, 'shL', -2.6, 0, 0.35);
      set(P, 'elL', -1.7);
      set(P, 'shR', 0.4, 0, -1.3);
      set(P, 'elR', -0.35);
      set(P, 'hipL', -0.45, 0, 0.12);
      set(P, 'knL', 0.55);
      set(P, 'hipR', 0.2, 0, -0.28);
    } else {
      set(P, 'shL', -0.3, -0.9, 0);
      set(P, 'shR', -0.3, 0.9, 0);
      set(P, 'elL', -1.5);
      set(P, 'elR', -1.5);
      set(P, 'head', 0.2, 0.3, 0.15);
      set(P, 'hipL', -0.2, 0, 0.2);
    }
  }

  // ---------------------------------------------------------------- stand
  private updateStand(f: Fighter, dt: number, adt: number, fx: Effects) {
    if (!this.stand) return;
    const want = f.standOut && !f.dead;
    if (want && !this.wasStandOut) {
      // summon flash
      fx.ring(this.tmpV.set(this.standWorld.x, this.standWorld.y + 1.2, this.standWorld.z), this.standColor, 0.2, 2.2, 0.35);
    }
    this.wasStandOut = want;
    this.standK = clamp(this.standK + (want ? dt * 4.5 : -dt * 5), 0, 1);
    this.standRoot.visible = this.standK > 0.01;
    if (!this.standRoot.visible) {
      this.standWorld.set(f.pos.x, f.pos.y, f.pos.z);
      if (this.fists) this.fists.count = this.fistsOut!.count = 0;
      return;
    }
    const a = f.action;
    // idle Stand floats behind the user's LEFT shoulder, opposite the over-the-right-shoulder camera,
    // so it never hides the user or the crosshair
    let ox = 0.85,
      oy = 0.45,
      oz = -0.6,
      rate = 10;
    const t = this.animT;
    if (a && (a.id === 'combo' || a.id === 'uppercut')) {
      ox = 0;
      oy = 0;
      oz = 1.15;
      rate = 30;
    } else if (a?.id === 'barrage') {
      ox = 0;
      oy = 0.05;
      oz = 1.25;
      rate = 30;
    } else if (a?.id === 'leap') {
      ox = 0;
      oy = -0.4;
      oz = -1.0;
      rate = 25;
    } else if (a?.id === 'timestop') {
      ox = 0;
      oy = 0.9;
      oz = -1.0;
      rate = 12;
    } else if (a?.id === 'evade') {
      ox = 0;
      oy = 0.3;
      oz = -1.8;
      rate = 6;
    } else if (f.blocking) {
      ox = 0;
      oy = 0.1;
      oz = 0.8;
      rate = 30;
    } else if (a?.id === 'pose') {
      ox = 1.0;
      oy = 0.6;
      oz = -0.6;
    } else if (f.boostT > 0) {
      ox = 0;
      oy = -1.4;
      oz = -0.3;
      rate = 30;
    }
    const bob = Math.sin(t * 2.4) * 0.08;
    const cy = Math.cos(f.yaw);
    const sy = Math.sin(f.yaw);
    const tx = f.pos.x + ox * cy + oz * sy;
    const tz = f.pos.z - ox * sy + oz * cy;
    const ty = f.pos.y + oy + bob;
    this.standWorld.x = damp(this.standWorld.x, tx, rate, adt || (f.frozen ? 0 : dt));
    this.standWorld.y = damp(this.standWorld.y, ty, rate, adt);
    this.standWorld.z = damp(this.standWorld.z, tz, rate, adt);
    if (this.standK < 1 && want) this.standWorld.set(lerp(tx, this.standWorld.x, this.standK), ty, lerp(tz, this.standWorld.z, this.standK));
    this.standYaw = dampAngle(this.standYaw, f.yaw, 16, adt);
    this.standRoot.position.copy(this.standWorld);
    this.standRoot.rotation.y = this.standYaw;
    // easeOutBack scale-in
    const k = this.standK;
    const s = want ? 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2) : k;
    this.standRoot.scale.setScalar(Math.max(0.01, s));
    const glow = (1 - k) * 0.8 + (a?.id === 'barrage' ? 0.15 + Math.sin(t * 30) * 0.08 : 0) + (f.hitFlash > 0 ? 0.4 : 0);
    this.stand.material.emissive.copy(this.standEmissive).lerp(new THREE.Color(this.standColor), glow);

    this.computeStandPose(f);
    this.applyPose(this.stand, this.sPose, adt, a ? 34 : 10);

    // barrage after-image fists
    const fists = this.fists!;
    const outs = this.fistsOut!;
    if (a?.id === 'barrage' && !f.frozen) {
      let n = 0;
      for (let i = 0; i < 18; i++) {
        if (Math.random() < 0.25) continue;
        const side = i % 2 ? 1 : -1;
        const ext = Math.random();
        this.tmpV.set(side * (0.15 + Math.random() * 0.55) + (Math.random() - 0.5) * 0.3, 1.0 + Math.random() * 0.8, 0.5 + ext * 1.2);
        this.e.set((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.5 - side * 0.15, 0);
        this.q.setFromEuler(this.e);
        const sc = 0.85 + Math.random() * 0.35;
        this.m4.compose(this.tmpV, this.q, this.sc.set(sc, sc, sc * (1 + ext * 0.6)));
        fists.setMatrixAt(n, this.m4);
        outs.setMatrixAt(n, this.m4);
        n++;
      }
      fists.count = outs.count = n;
      fists.instanceMatrix.needsUpdate = true;
      outs.instanceMatrix.needsUpdate = true;
      if (Math.random() < 0.6) {
        const from = this.tmpV.set(this.standWorld.x + (Math.random() - 0.5) * 0.8, this.standWorld.y + 1.2 + Math.random() * 0.6, this.standWorld.z);
        const to = this.tmpV2.set(from.x + Math.sin(f.yaw) * 1.6, from.y + (Math.random() - 0.5) * 0.3, from.z + Math.cos(f.yaw) * 1.6);
        fx.trail(from, to, this.standColor, 0.35, 0.1);
      }
    } else if (!f.frozen) {
      fists.count = outs.count = 0;
    }
    // punch trails at the hit moment of combo / uppercut
    if (a && (a.id === 'combo' || a.id === 'uppercut')) {
      const hitT = a.id === 'combo' ? COMBO_HIT_T[a.step] : 0.32;
      const key = `${a.id}${a.step}${f.id}`;
      if (a.t >= hitT - 0.03 && this.trailKey !== key) {
        this.trailKey = key;
        const from = this.tmpV.set(this.standWorld.x, this.standWorld.y + (a.id === 'uppercut' ? 0.6 : 1.4), this.standWorld.z);
        const to = this.standFront(this.tmpV2, 2.6);
        if (a.id === 'uppercut') to.y += 1.4;
        fx.trail(from, to, this.standColor, a.id === 'uppercut' || a.step === 2 ? 0.9 : 0.55, 0.16);
      }
    } else this.trailKey = '';
  }

  private computeStandPose(f: Fighter) {
    const P = this.sPose;
    reset(P);
    const a = f.action;
    const t = this.animT;
    // floating legs
    set(P, 'hipL', -0.25, 0, 0.05);
    set(P, 'knL', 0.55);
    set(P, 'hipR', 0.1, 0, -0.05);
    set(P, 'knR', 0.35);
    set(P, 'cape', 0.25 + Math.sin(t * 3) * 0.12);
    if (!a && !f.blocking) {
      if (f.char === 'jotaro') {
        set(P, 'shL', -0.3, -0.95, 0);
        set(P, 'shR', -0.3, 0.95, 0);
        set(P, 'elL', -1.5);
        set(P, 'elR', -1.5);
      } else {
        set(P, 'shL', -0.2, 0, 0.35);
        set(P, 'shR', -0.2, 0, -0.35);
        set(P, 'elL', -0.9);
        set(P, 'elR', -0.9);
        set(P, 'torso', -0.05);
      }
      set(P, 'head', 0.05);
      if (f.boostT > 0) {
        set(P, 'shL', -3.0, 0, 0.2);
        set(P, 'shR', -3.0, 0, -0.2);
        set(P, 'elL', 0);
        set(P, 'elR', 0);
      }
      return;
    }
    if (f.blocking && !a) {
      set(P, 'torso', 0.2);
      set(P, 'shL', -1.35, -0.55, 0);
      set(P, 'elL', -1.65);
      set(P, 'shR', -1.25, 0.55, 0);
      set(P, 'elR', -1.75);
      return;
    }
    if (!a) return;
    const at = a.t;
    switch (a.id) {
      case 'combo': {
        const end = COMBO_STEP_TIME[a.step];
        const k = punchK(at, COMBO_HIT_T[a.step], end);
        const side = a.step === 1 ? 'L' : 'R';
        punchArm(P, side, k);
        punchArm(P, side === 'L' ? 'R' : 'L', 0);
        const tw = (side === 'R' ? 0.5 : -0.5) * Math.max(0, k) * (a.step === 2 ? 1.4 : 1);
        set(P, 'torso', 0.2 + (a.step === 2 ? 0.2 : 0) * Math.max(0, k), tw, 0);
        set(P, 'head', 0.1, -tw * 0.5, 0);
        set(P, 'hipL', -0.6);
        set(P, 'knL', 0.5);
        set(P, 'hipR', 0.5);
        set(P, 'knR', 0.3);
        break;
      }
      case 'barrage': {
        const ph = t * 46;
        punchArm(P, 'R', 0.5 + 0.5 * Math.sin(ph), 0.2);
        punchArm(P, 'L', 0.5 + 0.5 * Math.sin(ph + Math.PI), 0.2);
        P.shR[1] += Math.sin(t * 27) * 0.3;
        P.shL[1] += Math.cos(t * 31) * 0.3;
        set(P, 'torso', 0.25, Math.sin(ph) * 0.15, 0);
        set(P, 'head', 0.15 + Math.sin(t * 50) * 0.05);
        set(P, 'hipL', -0.6);
        set(P, 'knL', 0.7);
        set(P, 'hipR', 0.4);
        set(P, 'knR', 0.4);
        break;
      }
      case 'uppercut':
        if (at < 0.26) {
          set(P, 'torso', 0.45, 0.4, 0);
          set(P, 'shR', 0.7, 0, -0.2);
          set(P, 'elR', -1.5);
          punchArm(P, 'L', 0);
          P.lift = -0.25;
        } else {
          set(P, 'torso', -0.25, -0.3, 0);
          set(P, 'shR', -2.95, 0, -0.1);
          set(P, 'elR', -0.15);
          set(P, 'shL', 0.4, 0, 0.4);
          P.lift = 0.25;
          set(P, 'head', -0.3);
        }
        break;
      case 'leap':
        set(P, 'torso', 0.5);
        set(P, 'shL', -1.3, -0.2, 0);
        set(P, 'shR', -1.3, 0.2, 0);
        set(P, 'elL', -0.3);
        set(P, 'elR', -0.3);
        break;
      case 'timestop':
        set(P, 'torso', -0.2);
        set(P, 'shL', -0.3, 0, 1.6 * Math.min(1, at * 3));
        set(P, 'shR', -0.3, 0, -1.6 * Math.min(1, at * 3));
        set(P, 'head', -0.25);
        break;
      case 'pose':
        set(P, 'shL', -0.3, -0.95, 0);
        set(P, 'shR', -0.3, 0.95, 0);
        set(P, 'elL', -1.5);
        set(P, 'elR', -1.5);
        set(P, 'head', 0.25, 0.2, 0);
        break;
      default:
        set(P, 'shL', -0.2, 0, 0.35);
        set(P, 'shR', -0.2, 0, -0.35);
    }
  }
}
