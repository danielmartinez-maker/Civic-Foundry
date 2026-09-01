import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import {
  bindProductionPickIdentity,
  resolveProductionPresentationId,
} from '../src/rendering/3d/scene/BabylonProductionSceneAdapter.ts';

function sceneNodes() {
  const engine = new NullEngine({ renderWidth: 64, renderHeight: 64 });
  const scene = new Scene(engine);
  const root = new TransformNode('root', scene);
  const child = new TransformNode('child', scene);
  child.parent = root;
  return { engine, scene, root, child };
}

test('production pick identity is bound to root and descendants', () => {
  const { engine, scene, root, child } = sceneNodes();
  try {
    bindProductionPickIdentity(root, { presentationId: 'building:42', canonicalId: '42' });
    assert.equal(resolveProductionPresentationId(root), 'building:42');
    assert.equal(resolveProductionPresentationId(child), 'building:42');
  } finally {
    scene.dispose(); engine.dispose();
  }
});

test('pick identity remains stable when a retained root is rebound after LOD/prototype replacement', () => {
  const { engine, scene, root, child } = sceneNodes();
  try {
    bindProductionPickIdentity(root, { presentationId: 'building:42', canonicalId: '42' });
    bindProductionPickIdentity(root, { presentationId: 'building:42', canonicalId: '42' });
    assert.equal(resolveProductionPresentationId(child), 'building:42');
  } finally {
    scene.dispose(); engine.dispose();
  }
});

test('pick resolution walks parent identity when a late child has no copied metadata', () => {
  const { engine, scene, root } = sceneNodes();
  const lateChild = new TransformNode('late-child', scene);
  lateChild.parent = root;
  try {
    bindProductionPickIdentity(root, { presentationId: 'facility:fire:1', canonicalId: 'fire:1' });
    lateChild.metadata = null;
    assert.equal(resolveProductionPresentationId(lateChild), 'facility:fire:1');
  } finally {
    scene.dispose(); engine.dispose();
  }
});
