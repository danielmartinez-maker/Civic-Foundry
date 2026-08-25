import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDING_VARIANTS } from '../src/data/buildings.ts';
import { RenovationSystem } from '../src/simulation/urban/RenovationSystem.ts';
import { UrbanFabricDomain } from '../src/simulation/urban/UrbanFabricDomain.ts';
import type { UrbanBuildingState } from '../src/simulation/urban/UrbanTypes.ts';

function state(buildingId: string, conditionScore: number): UrbanBuildingState {
  return {
    buildingId,
    useComponents: [{ use: 'residential', areaShareBps: 10_000, residentCapacity: 28, jobCapacity: 0, taxBase: 250 }],
    qualityTier: 'standard',
    conditionScore,
    lifecycleState: 'aging',
    conditionEstablishedTick: 0,
    lastConditionTick: 500,
    renovationCount: 0,
    parking: { profile: 'standard', spaces: 6 },
  };
}

test('renovation candidate evaluation is deterministic and building-id ordered', () => {
  const domain = new UrbanFabricDomain();
  domain.install(state('building:b', 50));
  domain.install(state('building:a', 55));
  const system = new RenovationSystem(domain);
  const definition = BUILDING_VARIANTS.residential[1]!;
  const inputs = [
    { buildingId: 'building:b', developerId: 'developer:1', startTick: 500, definition },
    { buildingId: 'building:a', developerId: 'developer:1', startTick: 500, definition },
  ] as const;

  const evaluate = Reflect.get(system, 'evaluateCandidates');
  assert.equal(typeof evaluate, 'function', 'RenovationSystem must expose evaluateCandidates');
  const forward = Reflect.apply(evaluate as (...args: unknown[]) => readonly { buildingId: string }[], system, [inputs]);
  const reverse = Reflect.apply(evaluate as (...args: unknown[]) => readonly { buildingId: string }[], system, [[...inputs].reverse()]);

  assert.deepEqual(forward, reverse);
  assert.deepEqual(forward.map((item) => item.buildingId), ['building:a', 'building:b']);
});
