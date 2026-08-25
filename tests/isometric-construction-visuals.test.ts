import test from 'node:test';
import assert from 'node:assert/strict';
import { constructionStageFor } from '../src/rendering/assets/ConstructionVisuals.ts';

const building = {
  id: 'building:lot:1', lotId: 'lot:1', x: 2, y: 3, zone: 'residential' as const,
  definitionId: 'residential_apartment', status: 'construction' as const,
  constructionStartedTick: 100, completionTick: 200,
};

test('construction timing derives four presentation stages plus completion', () => {
  assert.equal(constructionStageFor(building, 100), 'site');
  assert.equal(constructionStageFor(building, 120), 'foundation');
  assert.equal(constructionStageFor(building, 150), 'structure');
  assert.equal(constructionStageFor(building, 180), 'facade');
  assert.equal(constructionStageFor({ ...building, status: 'occupied' as const }, 220), 'complete');
});
