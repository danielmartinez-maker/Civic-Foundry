import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { LegacyCadastreRebuildService } from '../src/simulation/land/LegacyCadastreRebuildService.ts';
import type { ZoneType } from '../src/simulation/core/types.ts';
import { CadastralGraph } from '../src/world/cadastre/CadastralGraph.ts';
import { CadastralMutationSystem } from '../src/world/cadastre/CadastralMutationSystem.ts';
import type { Parcel } from '../src/world/cadastre/CadastralTypes.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';

function flatTerrain(width = 8, height = 6): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

function legacyZone(parcel: Parcel): ZoneType | undefined {
  const zone = parcel.zoningDistrictId;
  return zone === 'residential' || zone === 'commercial' || zone === 'industrial' ? zone : undefined;
}

test('protected parcel topology change is rejected without partial cadastral or lot mutation', () => {
  const core = new SimulationCore({ terrain: flatTerrain(), seed: 127, startingFunds: 500_000 });
  assert.equal(core.buildRoad([{ x: 2, y: 3 }, { x: 3, y: 3 }], 'local').ok, true);
  assert.equal(core.paintZone([{ x: 2, y: 2 }, { x: 3, y: 2 }], 'residential').painted, 2);
  const parcel = core.cadastre.listParcels()[0];
  assert.ok(parcel);
  core.zoning.assignParcel(parcel.id, 'R5');

  const beforeCadastre = core.cadastre.snapshot();
  const beforeLots = core.lots.list();
  const staged = new CadastralGraph(beforeCadastre);
  const polygon = staged.parcelPolygon(parcel.id);
  const xs = polygon.map((point) => point.x);
  const ys = polygon.map((point) => point.y);
  const splitX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const split = new CadastralMutationSystem(staged).splitParcel(parcel.id, [
    { x: splitX, y: Math.min(...ys) },
    { x: splitX, y: Math.max(...ys) },
  ]);
  assert.equal(split.committed, true, split.rejectionReasons.join('; '));

  const service = new LegacyCadastreRebuildService({
    cadastre: core.cadastre,
    lots: core.lots,
    zoning: core.zoning,
    buildings: core.buildings,
    propertyMarket: core.propertyMarket,
    legacyZoneResolver: legacyZone,
  });
  const result = service.rebuild(staged.snapshot(), core.clock.tick);

  assert.equal(result.committed, false);
  assert.equal(result.rejectionReason, 'protected-parcel-topology-change');
  assert.deepEqual(core.cadastre.snapshot(), beforeCadastre);
  assert.deepEqual(core.lots.list(), beforeLots);
  assert.equal(core.zoning.getParcelDistrictId(parcel.id), 'R5');
});