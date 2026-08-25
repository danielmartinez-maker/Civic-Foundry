import test from 'node:test';
import assert from 'node:assert/strict';
import { hydrateCore, serializeCore } from '../src/save/save.ts';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import type { DevelopmentAward } from '../src/simulation/development/DevelopmentTypes.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import type { Lot } from '../src/world/lots/LotSystem.ts';

function flatTerrain(width = 20, height = 12): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

function awardFor(lot: Lot, tick: number): DevelopmentAward {
  return {
    id: `bid:${tick}:${lot.id}:residential_rowhouse:local_builder`,
    awardId: `development:${tick}:${lot.id}:residential_rowhouse:local_builder`,
    buildingId: `building:${lot.id}`,
    lotId: lot.id,
    definitionId: 'residential_rowhouse',
    zone: 'residential',
    developerId: 'local_builder',
    expectedReturn: 0.2,
    expectedReturnMargin: 0.1,
    requiredEquity: 30_000,
    financingCost: 2_000,
    totalDevelopmentCost: 82_000,
    preferenceBonus: 0.05,
    capitalEfficiencyBonus: 0.01,
    residualValueBonus: 0.01,
    riskPenalty: 0,
    rankScore: 0.17,
    residualLandValue: 40_000,
    awardTick: tick,
    completionTick: tick + 70,
    releaseTick: tick + 170,
  };
}

function buildOccupiedResidentialCore(): { core: SimulationCore; lot: Lot; buildingId: string } {
  const core = new SimulationCore({ terrain: flatTerrain(), startingFunds: 300_000, seed: 411 });
  assert.equal(core.buildRoad(Array.from({ length: 14 }, (_, i) => ({ x: i + 2, y: 6 })), 'local').ok, true);
  core.paintZone([{ x: 3, y: 5 }], 'residential');
  const lot = core.lots.list().find((item) => item.zone === 'residential');
  assert.ok(lot);
  const buildingId = `building:${lot.id}`;
  core.buildings.restore([{
    id: buildingId,
    lotId: lot.id,
    x: lot.x,
    y: lot.y,
    zone: 'residential',
    definitionId: 'residential_cottage',
    status: 'occupied',
    constructionStartedTick: 0,
    completionTick: 0,
  }]);
  core.rebuildEntityProjection();
  return { core, lot, buildingId };
}

function createFireIncident(core: SimulationCore, buildingId: string): string {
  const original = core.buildings.getById(buildingId);
  assert.ok(original);
  const beforeIds = new Set(core.incidents.listIncidents().map((incident) => incident.id));
  core.incidents.createIncident('fire', original, 0.5, 0, core.serviceDispatch);
  const created = core.incidents.listIncidents().find((incident) => !beforeIds.has(incident.id));
  assert.ok(created);
  return created.id;
}

function redevelopWithPreexistingIncident(): { core: SimulationCore; lot: Lot; buildingId: string; incidentId: string } {
  const { core, lot, buildingId } = buildOccupiedResidentialCore();
  const incidentId = createFireIncident(core, buildingId);
  core.rebuildEntityProjection();

  core.buildings.replaceDevelopment(1, lot, awardFor(lot, 1));
  core.step(1);
  return { core, lot, buildingId, incidentId };
}

test('same legacy building ID advances generation across redevelopment without weak-reference retargeting', () => {
  const { core, lot, buildingId } = buildOccupiedResidentialCore();
  const generation1 = core.entityRegistry.require('building', buildingId);
  assert.equal(generation1.generation, 1);

  const incidentId = createFireIncident(core, buildingId);
  core.rebuildEntityProjection();
  const preReplacementEdge = core.entityReferences.list().find((edge) => edge.relation === 'incident-building');
  assert.ok(preReplacementEdge);
  assert.equal(preReplacementEdge.target.generation, 1);

  core.buildings.replaceDevelopment(1, lot, awardFor(lot, 1));
  core.step(1);

  const generation2 = core.entityRegistry.require('building', buildingId);
  assert.equal(generation2.generation, 2);
  assert.equal(core.entityRegistry.isKnown(generation1), true);
  assert.equal(core.entityRegistry.isActive(generation1), false);
  assert.equal(core.entityRegistry.isActive(generation2), true);
  assert.ok(core.entityRegistry.listHistorical('building').some((handle) => handle.generation === 1));

  assert.equal(
    core.entityReferences.list().some((edge) => edge.relation === 'incident-building' && edge.target.generation === 2),
    false,
  );
  const unresolved = core.entityDiagnostics.unresolved.find((item) => item.relation === 'incident-building');
  assert.ok(unresolved);
  assert.equal(unresolved.source.legacyId, incidentId);
  assert.equal(unresolved.target.legacyId, buildingId);
  assert.equal(unresolved.semantics, 'weak');

  const replacement = core.buildings.getById(buildingId);
  assert.ok(replacement);
  core.buildings.restore([]);
  core.rebuildEntityProjection();
  assert.equal(core.entityRegistry.resolve('building', buildingId), undefined);
  assert.equal(core.entityRegistry.isActive(generation2), false);

  core.buildings.restore([replacement]);
  core.rebuildEntityProjection();
  const generation3 = core.entityRegistry.require('building', buildingId);
  assert.equal(generation3.generation, 3);
  assert.equal(core.entityRegistry.isKnown(generation2), true);
  assert.equal(core.entityRegistry.isActive(generation2), false);
});

test('Save V7 hydrate rebuilds only provable current identity and preserves ambiguous weak references as unresolved', () => {
  const { core, buildingId } = redevelopWithPreexistingIncident();
  const liveCurrent = core.entityRegistry.require('building', buildingId);
  assert.equal(liveCurrent.generation, 2);
  assert.ok(core.entityRegistry.listHistorical('building').some((handle) => handle.generation === 1));

  const save = structuredClone(serializeCore(core));
  const first = hydrateCore(structuredClone(save));
  const second = hydrateCore(structuredClone(save));

  const rebuilt = first.entityRegistry.require('building', buildingId);
  assert.equal(rebuilt.generation, 1);
  assert.equal(first.entityRegistry.listHistorical('building').length, 0);
  assert.ok(first.entityDiagnostics.unresolved.some((item) => item.relation === 'incident-building'));
  assert.equal(first.entityReferences.list().some((edge) => edge.relation === 'incident-building'), false);

  assert.deepEqual(first.entityRegistry.snapshot(), second.entityRegistry.snapshot());
  assert.deepEqual(first.entityReferences.snapshot(), second.entityReferences.snapshot());
  assert.deepEqual(first.entityDiagnostics, second.entityDiagnostics);
});
