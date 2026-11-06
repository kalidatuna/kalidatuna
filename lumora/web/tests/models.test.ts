import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MODELS, bubbleShape, buildModel, gearShape, shieldShape, sparkleShape } from '../src/three/models';

describe('3D models', () => {
  it('provides a model for every curriculum module and feature', () => {
    for (const name of ['orb', 'bubble', 'home', 'laptop', 'blocks', 'gears', 'prism', 'coins', 'shield', 'rocket', 'lock', 'trophy', 'book', 'sparkle', 'compass', 'hero']) {
      expect(MODELS[name], name).toBeTypeOf('function');
    }
  });

  it.each(Object.keys(MODELS).filter((n) => n !== 'hero'))('%s builds, animates and fits the frame', (name) => {
    const m = buildModel(name, '#8b7bff');
    let meshes = 0;
    m.traverse((o) => {
      if ((o as THREE.Mesh).isMesh || (o as THREE.LineSegments).isLineSegments) meshes++;
    });
    expect(meshes).toBeGreaterThan(0);
    const update = m.userData.update as (t: number, h: number) => void;
    expect(update).toBeTypeOf('function');
    for (const t of [0, 1.3, 7.7]) update(t, 1);
    const sphere = new THREE.Box3().setFromObject(m).getBoundingSphere(new THREE.Sphere());
    expect(sphere.radius).toBeGreaterThan(0.6);
    expect(sphere.radius).toBeLessThan(2.2);
    m.traverse((o) => {
      const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      const pos = g?.getAttribute?.('position');
      if (pos) for (let i = 0; i < pos.array.length; i++) expect(Number.isFinite(pos.array[i])).toBe(true);
    });
  });

  it('hero scene includes orbiting miniatures and a star field', () => {
    const h = buildModel('hero', '#8b7bff');
    let points = 0;
    h.traverse((o) => ((o as THREE.Points).isPoints ? points++ : 0));
    expect(points).toBe(1);
    (h.userData.update as (t: number, h: number) => void)(2, 0);
  });

  it('falls back to the orb for unknown names', () => {
    expect(buildModel('does-not-exist', '#fff').children.length).toBe(1);
  });

  it('builds valid custom shapes', () => {
    const gear = gearShape(12, 1, 0.8, 0.2);
    expect(gear.getPoints().length).toBeGreaterThan(40);
    expect(gear.holes.length).toBe(1);
    for (const s of [shieldShape(), bubbleShape(), sparkleShape()]) {
      const g = new THREE.ShapeGeometry(s);
      expect(g.getAttribute('position').count).toBeGreaterThan(10);
    }
  });
});
