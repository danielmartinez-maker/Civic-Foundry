import assert from 'node:assert/strict';
import test from 'node:test';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { createBabylonEngine } from '../src/rendering/3d/BabylonEngineFactory.ts';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Scene } from '@babylonjs/core/scene.js';
import { MiniatureRenderPipeline } from '../src/rendering/3d/MiniatureRenderPipeline.ts';

const canvas = {} as HTMLCanvasElement;
const fakeEngine = Object.freeze({ kind: 'fake-engine' });

test('engine factory prefers WebGPU and falls back to WebGL after support/init failure', async () => {
  const calls: string[] = [];
  const result = await createBabylonEngine(canvas, {
    webGpuSupported: async () => true,
    createWebGpu: async () => {
      calls.push('webgpu');
      throw new Error('init failed');
    },
    createWebGl: () => {
      calls.push('webgl');
      return fakeEngine;
    },
  });

  assert.deepEqual(calls, ['webgpu', 'webgl']);
  assert.equal(result.backend, 'webgl');
  assert.equal(result.engine, fakeEngine);
  assert.ok(result.diagnostics.some((entry) => entry.includes('init failed')));
});

test('engine factory skips WebGPU construction when WebGPU is unsupported', async () => {
  const calls: string[] = [];
  const result = await createBabylonEngine(canvas, {
    webGpuSupported: async () => {
      calls.push('support');
      return false;
    },
    createWebGpu: async () => {
      calls.push('webgpu');
      return fakeEngine;
    },
    createWebGl: () => {
      calls.push('webgl');
      return fakeEngine;
    },
  });

  assert.deepEqual(calls, ['support', 'webgl']);
  assert.equal(result.backend, 'webgl');
  assert.equal(result.engine, fakeEngine);
  assert.deepEqual(result.diagnostics, []);
});

test('miniature render pipeline keeps FXAA disabled for the WebGL acceptance path', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const camera = new ArcRotateCamera('camera', 0.8, 0.8, 120, Vector3.Zero(), scene);
  const pipeline = new MiniatureRenderPipeline(scene, camera);

  assert.equal(pipeline.pipeline.fxaaEnabled, false);

  pipeline.dispose();
  scene.dispose();
  engine.dispose();
});

test('miniature render pipeline can disable depth of field for the WebGL fallback', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const camera = new ArcRotateCamera('camera', 0.8, 0.8, 120, Vector3.Zero(), scene);
  const pipeline = new MiniatureRenderPipeline(scene, camera, {
    enableDepthOfField: false,
    enablePostProcessing: false,
  });

  assert.equal(pipeline.pipeline, null);
  assert.equal(pipeline.postProcessingEnabled, false);

  pipeline.dispose();
  scene.dispose();
  engine.dispose();
});
