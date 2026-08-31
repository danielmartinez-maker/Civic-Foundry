import assert from 'node:assert/strict';
import test from 'node:test';
import { BuildingVisualResolver } from '../src/rendering/3d/presentation/BuildingVisualResolver.ts';
import { WorldPresentationSnapshotBuilder } from '../src/rendering/3d/presentation/WorldPresentationSnapshotBuilder.ts';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import type { BuildingV2 } from '../src/simulation/buildings/BuildingTypes.ts';

function building(overrides: Partial<BuildingV2> = {}): BuildingV2 {
  return {
    id: 'canonical-house-a',
    parcelIds: ['parcel:1'],
    typologyId: 'typology:residential_cottage',
    footprint: [
      { x: 0, y: 0 },
      { x: 9, y: 0 },
      { x: 9, y: 12 },
      { x: 0, y: 12 },
    ],
    grossFloorAreaM2: 150,
    usableFloorAreaM2: 129,
    heightMeters: 7.6,
    stories: 2,
    realizedFAR: 1.39,
    coverageRatio: 0.72,
    floors: [
      {
        level: 0,
        elevationMeters: 0,
        grossAreaM2: 75,
        usableAreaM2: 64.5,
        uses: [{ use: 'residential', floorAreaM2: 64.5, residentialUnits: 1 }],
      },
      {
        level: 1,
        elevationMeters: 3.2,
        grossAreaM2: 75,
        usableAreaM2: 64.5,
        uses: [{ use: 'residential', floorAreaM2: 64.5, residentialUnits: 1 }],
      },
    ],
    status: 'occupied',
    yearBuilt: 2026,
    developerId: 'developer:test',
    ownerId: 'owner:test',
    projectCost: 250_000,
    entitlement: {
      approvalTick: 0,
      zoningDistrictId: 'R1',
      approvedFAR: 2,
      approvedHeightMeters: 10,
      approvedUses: ['residential'],
    },
    lifecycle: {
      ageTicks: 0,
      condition: 92,
      structuralCondition: 95,
      systemsCondition: 90,
      exteriorCondition: 92,
      maintenanceBacklog: 0,
      deferredMaintenanceTicks: 0,
      effectiveAge: 0,
      vacancyDurationTicks: 0,
      distressScore: 0,
    },
    ...overrides,
  };
}

function installBuildings(core: SimulationCore, buildings: readonly BuildingV2[], power = 1): void {
  core.buildings.restoreV2(buildings);
  core.utilitySnapshot = {
    power: { production: 1, demand: 1, served: power, unserved: 1 - power, serviceRatio: power },
    water: { production: 1, demand: 1, served: 1, unserved: 0, serviceRatio: 1 },
    perBuilding: Object.freeze(Object.fromEntries(buildings.map((item) => [item.id, { power, water: 1 }]))),
  };
}

test('canonical residential cottage resolves to House A from BuildingV2 state only', () => {
  const resolver = new BuildingVisualResolver();
  const cottage = building();
  const state = resolver.resolve(cottage, { powerRatio: 1, visualTime: 'night' });

  assert.equal(state.presentationId, `building:${cottage.id}`);
  assert.equal(state.canonicalBuildingId, cottage.id);
  assert.equal(state.assetId, 'cf_bld_res_detached_house_a_low_v01');
  assert.deepEqual(state.transform.positionM, { x: 4.5, y: 0, z: 6 });
  assert.equal(state.transform.rotationYRad, 0);
  assert.deepEqual(state.transform.scale, { x: 1, y: 1, z: 1 });
  assert.equal(state.state.condition, 'excellent');
  assert.equal(state.state.occupancy, 'occupied');
  assert.equal(state.state.powered, true);
  assert.equal(state.state.construction, 'none');
  assert.equal(state.state.constructionProgress, 0);
  assert.equal(state.state.nightLighting, true);
  assert.equal(Number.isInteger(state.variationSeed), true);
});

test('unsupported typology keeps canonical bounds instead of borrowing an unrelated asset', () => {
  const resolver = new BuildingVisualResolver();
  const unsupported = building({ typologyId: 'typology:residential_rowhouse', heightMeters: 10.2 });
  const state = resolver.resolve(unsupported, { powerRatio: 1, visualTime: 'day' });

  assert.equal(state.assetId, null);
  assert.deepEqual(state.fallbackBoundsM, {
    footprint: unsupported.footprint,
    heightM: unsupported.heightMeters,
  });
});

test('fresh snapshot builders reconstruct byte-equivalent deterministic presentation state', () => {
  const core = new SimulationCore({ width: 4, height: 4, seed: 71 });
  installBuildings(core, [building()]);
  const before = JSON.stringify(core.buildings.listV2());

  const first = new WorldPresentationSnapshotBuilder().build(core, 'day');
  const second = new WorldPresentationSnapshotBuilder().build(core, 'day');

  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first.buildings[0]?.variationSeed, second.buildings[0]?.variationSeed);
  assert.deepEqual(first.dirty.structuralBuildings, ['building:canonical-house-a']);
  assert.deepEqual(first.dirty.appearanceBuildings, []);
  assert.deepEqual(first.dirty.removedBuildings, []);
  assert.equal(JSON.stringify(core.buildings.listV2()), before);
});

test('retained snapshot dirty sets distinguish appearance changes from structural changes', () => {
  const core = new SimulationCore({ width: 4, height: 4, seed: 72 });
  const builder = new WorldPresentationSnapshotBuilder();
  const initial = building();
  installBuildings(core, [initial]);
  const first = builder.build(core, 'day');

  const worn = building({ lifecycle: { ...initial.lifecycle, exteriorCondition: 50 } });
  installBuildings(core, [worn]);
  const appearance = builder.build(core, 'day');
  assert.deepEqual(appearance.dirty.structuralBuildings, []);
  assert.deepEqual(appearance.dirty.appearanceBuildings, ['building:canonical-house-a']);
  assert.equal(appearance.revision.buildings, first.revision.buildings + 1);

  const taller = building({
    lifecycle: worn.lifecycle,
    heightMeters: 8.4,
  });
  installBuildings(core, [taller]);
  const structural = builder.build(core, 'day');
  assert.deepEqual(structural.dirty.structuralBuildings, ['building:canonical-house-a']);
  assert.deepEqual(structural.dirty.appearanceBuildings, []);
  assert.equal(structural.revision.buildings, appearance.revision.buildings + 1);
});

test('visual time changes environment revision and only changes building appearance', () => {
  const core = new SimulationCore({ width: 4, height: 4, seed: 73 });
  const builder = new WorldPresentationSnapshotBuilder();
  installBuildings(core, [building()]);
  const day = builder.build(core, 'day');
  const night = builder.build(core, 'night');

  assert.equal(night.revision.environment, day.revision.environment + 1);
  assert.equal(night.revision.buildings, day.revision.buildings + 1);
  assert.deepEqual(night.dirty.structuralBuildings, []);
  assert.deepEqual(night.dirty.appearanceBuildings, ['building:canonical-house-a']);
  assert.equal(night.buildings[0]?.state.nightLighting, true);
});
