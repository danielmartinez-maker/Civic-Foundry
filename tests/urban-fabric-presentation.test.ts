import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { WorldRenderer } from '../src/rendering/WorldRenderer.ts';
import { ParcelInspector } from '../src/ui/ParcelInspector.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';

function flatTerrain(width = 8, height = 8): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

function coreFixture(): SimulationCore {
  const core = new SimulationCore({ terrain: flatTerrain(), startingFunds: 150_000, seed: 17 });
  assert.equal(core.buildRoad([{ x: 3, y: 4 }], 'local').ok, true);
  assert.equal(core.paintZone([{ x: 3, y: 3 }], 'residential').painted, 1);
  const parcel = core.cadastre.listParcels()[0];
  assert.ok(parcel);
  core.zoning.assignParcel(parcel.id, 'R2');
  return core;
}

function canvasStub(): HTMLCanvasElement {
  return {
    getContext: () => ({} as CanvasRenderingContext2D),
    getBoundingClientRect: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      toJSON: () => ({}),
    }),
  } as unknown as HTMLCanvasElement;
}

test('meter coordinates project consistently with legacy cell coordinates', () => {
  const core = coreFixture();
  const renderer = new WorldRenderer(canvasStub());
  const meters = renderer.worldMetersToCanvas({ x: 20, y: 40 }, core);
  const cells = renderer.worldToCanvas(1, 2, core);
  assert.deepEqual(meters, cells);
});

test('parcel inspector exposes zoning capacity condition and redevelopment drivers', () => {
  const core = coreFixture();
  const parcel = core.cadastre.listParcels()[0]!;
  const html = new ParcelInspector().render(parcel.id, core);

  for (const label of [
    'Area',
    'Frontage',
    'District',
    'Allowed FAR',
    'Effective FAR',
    'Height',
    'Coverage',
    'Condition',
    'Redevelopment pressure',
    'Lineage',
  ]) {
    assert.match(html, new RegExp(label, 'i'));
  }
  assert.match(html, /R2/);
});

test('parcel inspector escapes dynamic ownership text', () => {
  const core = coreFixture();
  const parcel = core.cadastre.listParcels()[0]!;
  core.propertyMarket.restore({
    holdings: [{
      parcelId: parcel.id,
      ownerId: '<script>alert(1)</script>',
      reservationValue: 125_000,
    }],
    transactions: [],
    nextTransactionId: 1,
  });

  const html = new ParcelInspector().render(parcel.id, core);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});
