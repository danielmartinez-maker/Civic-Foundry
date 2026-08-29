import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import type { WorldPoint } from '../src/world/cadastre/Geometry.ts';

function flatTerrain(width = 10, height = 8): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

function splitLine(core: SimulationCore, parcelId: string): readonly WorldPoint[] {
  const polygon = core.cadastre.parcelPolygon(parcelId);
  const xs = polygon.map((point) => point.x);
  const ys = polygon.map((point) => point.y);
  const x = (Math.min(...xs) + Math.max(...xs)) / 2;
  return Object.freeze([
    Object.freeze({ x, y: Math.min(...ys) }),
    Object.freeze({ x, y: Math.max(...ys) }),
  ]);
}

function easementLine(core: SimulationCore, parcelId: string): readonly WorldPoint[] {
  const polygon = core.cadastre.parcelPolygon(parcelId);
  const xs = polygon.map((point) => point.x);
  const ys = polygon.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const midY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const inset = Math.min(1, (maxX - minX) / 4);
  return Object.freeze([
    Object.freeze({ x: minX + inset, y: midY }),
    Object.freeze({ x: maxX - inset, y: midY }),
  ]);
}

test('unrelated road edit preserves canonical easements and lineage', () => {
  const core = new SimulationCore({ terrain: flatTerrain(), startingFunds: 300_000, seed: 101 });
  assert.equal(core.buildRoad([
    { x: 0, y: 3 },
    { x: 1, y: 3 },
    { x: 2, y: 3 },
    { x: 3, y: 3 },
    { x: 4, y: 3 },
  ], 'local').ok, true);
  assert.equal(core.paintZone([
    { x: 1, y: 2 },
    { x: 2, y: 2 },
    { x: 3, y: 2 },
  ], 'residential').painted, 3);

  const source = core.cadastre.listParcels()[0];
  assert.ok(source);
  const split = core.cadastralMutations.splitParcel(source.id, splitLine(core, source.id));
  assert.equal(split.committed, true, split.rejectionReasons.join(','));
  assert.equal(split.resultingParcelIds.length, 2);

  const easementParcelId = [...split.resultingParcelIds].sort()[0]!;
  const easement = core.cadastralMutations.createEasement(
    [easementParcelId],
    'access',
    easementLine(core, easementParcelId),
  );
  assert.equal(easement.committed, true, easement.rejectionReasons.join(','));

  const easementsBefore = core.cadastre.listEasements();
  const lineageBefore = core.cadastre.listLineage();
  assert.ok(easementsBefore.length > 0);
  assert.ok(lineageBefore.length > 0);

  const unrelated = core.buildRoad([{ x: 8, y: 6 }], 'local');

  assert.equal(unrelated.ok, true);
  assert.deepEqual(core.cadastre.listEasements(), easementsBefore);
  assert.deepEqual(core.cadastre.listLineage(), lineageBefore);
});
