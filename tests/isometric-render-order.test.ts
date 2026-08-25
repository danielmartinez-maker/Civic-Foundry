import test from 'node:test';
import assert from 'node:assert/strict';
import { compareDepthKeys, makeDepthKey } from '../src/rendering/passes/RenderOrder.ts';

test('objects sort by isometric depth then elevation then stable id', () => {
  const keys = [
    makeDepthKey('objects', 4, 2, 0, 'b'),
    makeDepthKey('objects', 4, 2, 0, 'a'),
    makeDepthKey('objects', 2, 1, 0, 'z'),
  ].sort(compareDepthKeys);
  assert.deepEqual(keys.map((key) => key.stableId), ['z', 'a', 'b']);
});

test('scene layer order is deterministic before depth', () => {
  const keys = [
    makeDepthKey('vehicles', 0, 0, 0, 'vehicle'),
    makeDepthKey('terrain', 20, 20, 0, 'terrain'),
    makeDepthKey('roads', 10, 10, 0, 'road'),
  ].sort(compareDepthKeys);
  assert.deepEqual(keys.map((key) => key.stableId), ['terrain', 'road', 'vehicle']);
});
