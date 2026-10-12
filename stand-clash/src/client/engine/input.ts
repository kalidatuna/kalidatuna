// Keyboard + mouse input with pointer lock and edge-triggered actions.
import type { EdgeKey } from '../../shared/sim';

const KEYMAP: Record<string, EdgeKey | 'lock' | null> = {
  Space: 'jump',
  ShiftLeft: 'dash',
  ShiftRight: 'dash',
  KeyE: 'summon',
  KeyQ: 'barrage',
  KeyR: 'heavy',
  KeyF: 'timestop',
  KeyV: 'pose',
  Tab: 'lock',
};

export class Input {
  held = new Set<string>();
  edges = new Set<EdgeKey>();
  mouseDX = 0;
  mouseDY = 0;
  blockHeld = false;
  lockToggle = false;
  locked = false;
  enabled = false;
  /** Automation/test mode: accept mouse buttons without pointer lock. */
  allowUnlocked = false;
  onLockChange: ((locked: boolean) => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const m = KEYMAP[e.code];
      if (m || e.code.startsWith('Key') || e.code === 'Space' || e.code === 'Tab') e.preventDefault();
      if (!e.repeat) {
        if (m === 'lock') this.lockToggle = true;
        else if (m) this.edges.add(m);
      }
      this.held.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => {
      this.held.clear();
      this.blockHeld = false;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.locked && !this.allowUnlocked) {
        this.requestLock();
        return;
      }
      if (e.button === 0) this.edges.add('attack');
      if (e.button === 2) this.blockHeld = true;
      if (e.button === 1) this.lockToggle = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.blockHeld = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      // clamp absurd spikes some browsers emit on lock
      this.mouseDX += Math.max(-300, Math.min(300, e.movementX));
      this.mouseDY += Math.max(-300, Math.min(300, e.movementY));
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.held.clear();
        this.blockHeld = false;
      }
      this.onLockChange?.(this.locked);
    });
  }

  requestLock() {
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* pointer lock unavailable (e.g. automation) */
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  axis(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.held.has('KeyW') || this.held.has('ArrowUp')) y += 1;
    if (this.held.has('KeyS') || this.held.has('ArrowDown')) y -= 1;
    if (this.held.has('KeyD') || this.held.has('ArrowRight')) x += 1;
    if (this.held.has('KeyA') || this.held.has('ArrowLeft')) x -= 1;
    return { x, y };
  }

  takeMouse() {
    const r = { x: this.mouseDX, y: this.mouseDY };
    this.mouseDX = this.mouseDY = 0;
    return r;
  }

  takeEdges(): Set<EdgeKey> {
    const e = this.edges;
    this.edges = new Set();
    return e;
  }

  takeLockToggle() {
    const v = this.lockToggle;
    this.lockToggle = false;
    return v;
  }

  clear() {
    this.edges.clear();
    this.held.clear();
    this.blockHeld = false;
    this.mouseDX = this.mouseDY = 0;
  }
}
