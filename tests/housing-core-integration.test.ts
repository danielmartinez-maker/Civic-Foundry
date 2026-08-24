import assert from 'node:assert/strict';
import test from 'node:test';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';

test('SimulationCore owns tenure and relocation systems and exposes conserved housing snapshots', () => {
  const core = new SimulationCore({ width: 16, height: 10, seed: 1701 });
  const integrated = core as unknown as {
    housingTenure?: { snapshot(): unknown };
    housingRelocation?: { snapshotState(): { allocations: readonly unknown[]; unplaced: readonly unknown[] } };
    housingTenureSnapshot?: { options: readonly unknown[] };
    housingRelocationSnapshot?: { population: number; housedResidents: number; unplacedResidents: number };
  };

  assert.equal(typeof integrated.housingTenure?.snapshot, 'function');
  assert.equal(typeof integrated.housingRelocation?.snapshotState, 'function');
  assert.ok(integrated.housingTenureSnapshot);
  assert.ok(integrated.housingRelocationSnapshot);
  const snapshot = integrated.housingRelocationSnapshot!;
  assert.equal(snapshot.housedResidents + snapshot.unplacedResidents, snapshot.population);
  assert.equal(snapshot.population, core.population.population);
});

test('housing core reconciliation remains conserved across a regular city cycle', () => {
  const core = new SimulationCore({ width: 16, height: 10, seed: 1702 });
  core.step(50);
  const snapshot = (core as any).housingRelocationSnapshot;
  assert.ok(snapshot);
  assert.equal(snapshot.housedResidents + snapshot.unplacedResidents, core.population.population);
});
