// Third-person over-the-shoulder camera with collision avoidance, lock-on and controlled shake.
import * as THREE from 'three';
import type { World } from '../../shared/world';
import { V3, aimDir, clamp, damp, dampAngle, yawTo } from '../../shared/math';
import { settings } from './settings';

export class CameraRig {
  camera: THREE.PerspectiveCamera;
  yaw = Math.PI;
  pitch = -0.12;
  private dist = 5.4;
  private curDist = 5.4;
  private pivot = new THREE.Vector3();
  private pivotInit = false;
  private trauma = 0;
  private fovKick = 0;
  private t = 0;
  private tmp = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private right = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(settings.fov, aspect, 0.1, 1200);
  }

  look(dx: number, dy: number) {
    const s = 0.0022 * settings.sens;
    this.yaw -= dx * s;
    this.pitch += (settings.invertY ? dy : -dy) * s;
    this.pitch = clamp(this.pitch, -1.15, 1.2);
  }

  addTrauma(x: number) {
    this.trauma = Math.min(0.8, this.trauma + x * settings.shake);
  }
  kickFov(x: number) {
    this.fovKick = Math.max(this.fovKick, x);
  }

  snapTo(target: V3, yaw: number) {
    this.yaw = yaw;
    this.pitch = -0.12;
    this.pivot.set(target.x, target.y + 1.6, target.z);
    this.pivotInit = true;
  }

  update(dt: number, target: V3, world: World, opts: { combat: boolean; lock: V3 | null; zoom?: number }) {
    this.t += dt;
    if (opts.lock) {
      const want = yawTo(target, opts.lock);
      this.yaw = dampAngle(this.yaw, want, 7, dt);
      const dxz = Math.hypot(opts.lock.x - target.x, opts.lock.z - target.z);
      const wantP = clamp(Math.atan2(opts.lock.y - target.y, dxz) - 0.15, -0.6, 0.6);
      this.pitch = damp(this.pitch, wantP, 4, dt);
    }
    const goal = this.tmp.set(target.x, target.y + 1.75, target.z);
    if (!this.pivotInit) {
      this.pivot.copy(goal);
      this.pivotInit = true;
    }
    this.pivot.x = damp(this.pivot.x, goal.x, 22, dt);
    this.pivot.z = damp(this.pivot.z, goal.z, 22, dt);
    this.pivot.y = damp(this.pivot.y, goal.y, 12, dt);
    if (this.pivot.distanceTo(goal) > 6) this.pivot.copy(goal);

    const wantDist = (opts.combat ? 6.6 : 5.9) * (opts.zoom ?? 1);
    this.dist = damp(this.dist, wantDist, 3, dt);
    const d = aimDir(this.yaw, this.pitch);
    this.fwd.set(d.x, d.y, d.z);
    this.right.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const shoulder = 0.85;
    // shoulder offset, checked against walls
    const sideDist = world.raycast(this.pivot, { x: this.right.x, y: 0, z: this.right.z }, shoulder + 0.3);
    const so = Math.max(0, Math.min(shoulder, sideDist - 0.3));
    const base = this.tmp.copy(this.pivot).addScaledVector(this.right, so);
    const back = { x: -this.fwd.x, y: -this.fwd.y, z: -this.fwd.z };
    const hit = world.raycast(base, back, this.dist + 0.3);
    const allowed = Math.max(0.6, hit - 0.3);
    this.curDist = allowed < this.curDist ? allowed : damp(this.curDist, Math.min(this.dist, allowed), 5, dt);
    const cam = this.camera;
    cam.position.copy(base).addScaledVector(this.fwd, -this.curDist);
    if (cam.position.y < 0.25) cam.position.y = 0.25;
    cam.lookAt(base.x + this.fwd.x * 10, base.y + this.fwd.y * 10, base.z + this.fwd.z * 10);

    // controlled shake (trauma²), never more than a few centimetres / a degree or two
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    const sh = this.trauma * this.trauma;
    if (sh > 0.0001) {
      const n = (k: number) => Math.sin(this.t * (37 + k * 11) + k * 3.1) * Math.sin(this.t * (23 + k * 7));
      cam.position.x += n(1) * 0.3 * sh;
      cam.position.y += n(2) * 0.3 * sh;
      cam.rotateZ(n(3) * 0.035 * sh);
    }
    this.fovKick = Math.max(0, this.fovKick - dt * 30);
    const fov = settings.fov + this.fovKick;
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  /** World point under the crosshair (for aiming knives / bullets). */
  aimPoint(world: World, out: THREE.Vector3): THREE.Vector3 {
    const cam = this.camera;
    const dir = this.fwd;
    const start = cam.position;
    // skip the segment between the camera and the player
    const skip = this.curDist + 0.5;
    const s = { x: start.x + dir.x * skip, y: start.y + dir.y * skip, z: start.z + dir.z * skip };
    const dist = world.raycast(s, { x: dir.x, y: dir.y, z: dir.z }, 90);
    return out.set(s.x + dir.x * dist, s.y + dir.y * dist, s.z + dir.z * dist);
  }
}
