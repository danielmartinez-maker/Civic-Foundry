import assert from 'node:assert/strict';
import test from 'node:test';
import { createBabylonEngine } from '../src/rendering/3d/BabylonEngineFactory.ts';

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
