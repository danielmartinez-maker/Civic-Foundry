import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDepthKey } from '../src/rendering/passes/RenderOrder.ts';
import { sortSceneSpriteCommands } from '../src/rendering/passes/SceneSpriteCommand.ts';

test('scene command order is deterministic across contributor order', () => {
  const commands = [
    { depth: makeDepthKey('objects', 4, 4, 0, 'building:b'), assetId: 'b', x: 4, y: 4, label: 'B' },
    { depth: makeDepthKey('objects', 4, 5, 0, 'tree:a'), assetId: 't', x: 4, y: 5, label: 'T' },
    { depth: makeDepthKey('objects', 4, 4, 0, 'facility:a'), assetId: 'f', x: 4, y: 4, label: 'F' },
  ] as const;
  const forward = sortSceneSpriteCommands(commands).map((command) => command.depth.stableId);
  const reverse = sortSceneSpriteCommands([...commands].reverse()).map((command) => command.depth.stableId);
  assert.deepEqual(forward, reverse);
  assert.ok(forward.indexOf('tree:a') > forward.indexOf('building:b'));
});

test('rear objects sort behind buildings while low props remain below the objects layer', () => {
  const commands = [
    { depth: makeDepthKey('objects', 5, 5, 0, 'building'), assetId: 'b', x: 5, y: 5, label: 'B' },
    { depth: makeDepthKey('objects', 3, 4, 0, 'tree:rear'), assetId: 't', x: 3, y: 4, label: 'T' },
    { depth: makeDepthKey('low-props', 9, 9, 0, 'bench'), assetId: 'p', x: 9, y: 9, label: 'P' },
  ] as const;
  const ordered = sortSceneSpriteCommands(commands).map((command) => command.depth.stableId);
  assert.ok(ordered.indexOf('tree:rear') < ordered.indexOf('building'));
  assert.ok(ordered.indexOf('bench') < ordered.indexOf('tree:rear'));
});

test('ObjectRenderPass exposes collection instead of owning final scene sorting and painting', () => {
  const source = readFileSync(new URL('../src/rendering/passes/ObjectRenderPass.ts', import.meta.url), 'utf8');
  assert.ok(source.includes('collect(core: SimulationCore, camera: IsometricCamera)'));
  assert.equal(source.includes('commands.sort('), false);
  assert.equal(source.includes('this.painter.draw('), false);
});
