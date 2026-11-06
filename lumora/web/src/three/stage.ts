// One WebGL renderer, many 3D "views". Each element with [data-model] gets its own
// scene and camera, drawn into the element's rectangle with a scissor test, so the
// whole site uses a single GPU context no matter how many models are on screen.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildModel, type Updater } from './models';

interface View {
  el: HTMLElement;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  model: THREE.Group;
  hover: number;
  hoverTarget: number;
  offset: number;
  onEnter: () => void;
  onLeave: () => void;
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export class Stage {
  private renderer: THREE.WebGLRenderer;
  private views: View[] = [];
  private env: THREE.Texture;
  private clock = new THREE.Clock();
  private pointer = new THREE.Vector2();
  private running = false;
  private header: HTMLElement | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    window.addEventListener('pointermove', (e) => {
      this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
    }, { passive: true });
    document.addEventListener('visibilitychange', () => (document.hidden ? this.stop() : this.start()));
  }

  /** Registers every [data-model] element under root that isn't already registered. */
  scan(root: ParentNode = document) {
    this.header = document.querySelector('.site-header');
    root.querySelectorAll<HTMLElement>('[data-model]').forEach((el) => {
      if (el.dataset.modelReady) return;
      el.dataset.modelReady = '1';
      this.add(el);
    });
    this.prune();
    this.start();
  }

  private add(el: HTMLElement) {
    const name = el.dataset.model || 'orb';
    const color = el.dataset.color || '#8b7bff';
    const scene = new THREE.Scene();
    scene.environment = this.env;
    const hemi = new THREE.HemisphereLight(0xffffff, 0x2a2350, 0.9);
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2.5, 3, 4);
    const rim = new THREE.PointLight(new THREE.Color(color), 18, 12);
    rim.position.set(-3, -1, -2);
    const fill = new THREE.PointLight(0xffd6f0, 6, 10);
    fill.position.set(3, -2, 3);
    scene.add(hemi, key, rim, fill);
    const model = buildModel(name, color);
    scene.add(model);
    const isHero = name === 'hero';
    const camera = new THREE.PerspectiveCamera(isHero ? 40 : 32, 1, 0.1, 50);
    camera.position.set(0, isHero ? 0.6 : 0.15, isHero ? 6.9 : 4.4);
    camera.lookAt(0, 0, 0);
    const view: View = {
      el, scene, camera, model, hover: 0, hoverTarget: 0, offset: Math.random() * 10,
      onEnter: () => (view.hoverTarget = 1),
      onLeave: () => (view.hoverTarget = 0),
    };
    const hoverHost = el.closest<HTMLElement>('[data-hover-host]') ?? el;
    hoverHost.addEventListener('pointerenter', view.onEnter);
    hoverHost.addEventListener('pointerleave', view.onLeave);
    this.views.push(view);
  }

  /** Drops views whose elements have left the document (after navigation). */
  prune() {
    this.views = this.views.filter((v) => {
      if (document.body.contains(v.el)) return true;
      v.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose?.();
      });
      return false;
    });
  }

  start() {
    if (this.running || document.hidden) return;
    this.running = true;
    this.clock.getDelta();
    const loop = () => {
      if (!this.running) return;
      this.frame();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
  }

  private frame() {
    const r = this.renderer;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const size = r.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) r.setSize(w, h, false);
    r.setScissorTest(false);
    r.clear();
    r.setScissorTest(true);
    const still = reducedMotion();
    const t = still ? 1.2 : this.clock.getElapsedTime();
    const clipTop = this.header ? Math.max(0, this.header.getBoundingClientRect().bottom) : 0;
    for (const v of this.views) {
      const rect = v.el.getBoundingClientRect();
      if (rect.bottom < clipTop || rect.top > h || rect.right < 0 || rect.left > w || rect.width === 0) continue;
      v.hover += (v.hoverTarget - v.hover) * 0.08;
      const update = v.model.userData.update as Updater | undefined;
      update?.(t + v.offset, v.hover);
      if (v.el.dataset.model === 'hero' && !still) {
        v.model.rotation.y += (this.pointer.x * 0.35 - v.model.rotation.y) * 0.04;
        v.model.rotation.x += (this.pointer.y * 0.18 - v.model.rotation.x) * 0.04;
      } else if (!still) {
        v.model.position.y = Math.sin((t + v.offset) * 1.1) * 0.05;
      }
      v.camera.aspect = rect.width / rect.height;
      v.camera.updateProjectionMatrix();
      const bottom = h - rect.bottom;
      r.setViewport(rect.left, bottom, rect.width, rect.height);
      // Never draw over the sticky header.
      const visibleTop = Math.max(rect.top, clipTop);
      r.setScissor(rect.left, bottom, rect.width, Math.max(0, rect.bottom - visibleTop));
      r.render(v.scene, v.camera);
    }
  }
}

let stage: Stage | null = null;

export function initStage(canvas: HTMLCanvasElement): Stage | null {
  if (stage) return stage;
  try {
    stage = new Stage(canvas);
    document.documentElement.classList.add('webgl');
    return stage;
  } catch (err) {
    console.warn('WebGL unavailable, using 2D fallbacks', err);
    document.documentElement.classList.add('no-webgl');
    return null;
  }
}
