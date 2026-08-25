import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worldRenderer = readFileSync(new URL('../src/rendering/WorldRenderer.ts', import.meta.url), 'utf8');
const groundPass = readFileSync(new URL('../src/rendering/passes/GroundRenderPass.ts', import.meta.url), 'utf8');

test('presentation remains read-only and terrain-facade driven for world sizing and ground art', () => {
  assert.match(worldRenderer, /worldSize\(core\)/);
  assert.match(groundPass, /core\.terrain\.width/);
  assert.match(groundPass, /core\.terrain\.height/);
  assert.match(groundPass, /core\.terrain\.get\(x, y\)/);
  const source = `${worldRenderer}\n${groundPass}`;
  for (const forbidden of ['runDesignStorm(', 'serializeCore(', 'hydrateCore(', 'world.runDesignStorm(', 'world.snapshotAuthoritative(']) {
    assert.equal(source.includes(forbidden), false, `renderer must not call mutation/save API: ${forbidden}`);
  }
});
