import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { mapCadastralOverlay } from '../src/rendering/CadastralOverlayLayer.ts';
import { mapZoningEnvelope } from '../src/rendering/ZoningEnvelopeLayer.ts';
import { WorldRenderer } from '../src/rendering/WorldRenderer.ts';
import { OverlayRenderPass } from '../src/rendering/passes/OverlayRenderPass.ts';
import { IsometricCamera } from '../src/rendering/isometric/IsometricCamera.ts';
import { inspectParcelAt } from '../src/ui/Inspector.ts';
import { ParcelInspector } from '../src/ui/ParcelInspector.ts';
import { ToolController } from '../src/ui/ToolController.ts';
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

function recordingContext(): Readonly<{
  ctx: CanvasRenderingContext2D;
  strokes: () => number;
  fills: () => number;
  labels: () => readonly string[];
}> {
  let strokeCount = 0;
  let fillCount = 0;
  const text: string[] = [];
  const ctx = {
    save: () => undefined,
    restore: () => undefined,
    beginPath: () => undefined,
    closePath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    arc: () => undefined,
    stroke: () => { strokeCount += 1; },
    fill: () => { fillCount += 1; },
    fillRect: () => { fillCount += 1; },
    strokeRect: () => { strokeCount += 1; },
    fillText: (value: string) => { text.push(value); },
    setLineDash: () => undefined,
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'center',
    textBaseline: 'middle',
  } as unknown as CanvasRenderingContext2D;
  return {
    ctx,
    strokes: () => strokeCount,
    fills: () => fillCount,
    labels: () => text,
  };
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

test('inspect tool resolves the canonical parcel beneath a legacy cell', () => {
  const core = coreFixture();
  const parcel = core.cadastre.listParcels()[0]!;
  const tools = new ToolController();

  assert.equal(tools.parcelIdAt(core, 3, 3), parcel.id);
  assert.equal(tools.parcelIdAt(core, 0, 0), null);
});

test('inspector routes a clicked parcel to canonical parcel details', () => {
  const core = coreFixture();
  const parcel = core.cadastre.listParcels()[0]!;

  const html = inspectParcelAt(core, 3, 3);
  assert.ok(html);
  assert.match(html, new RegExp(parcel.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, /R2/);
  assert.equal(inspectParcelAt(core, 0, 0), null);
});

test('cadastral overlay exposes deterministic parcel boundaries and frontage', () => {
  const core = coreFixture();
  const parcel = core.cadastre.listParcels()[0]!;
  const snapshot = mapCadastralOverlay(core);
  const presented = snapshot.parcels.find((item) => item.parcelId === parcel.id);

  assert.ok(presented);
  assert.deepEqual(presented.boundary, core.cadastre.parcelPolygon(parcel.id));
  assert.equal(presented.frontage.length, parcel.frontageEdgeIds.length);
  assert.equal(snapshot.parcels[0]?.parcelId, parcel.id);
});

test('zoning envelope overlay exposes legal footprint and dimensional capacity', () => {
  const core = coreFixture();
  const parcel = core.cadastre.listParcels()[0]!;
  const snapshot = mapZoningEnvelope(core, parcel.id);

  assert.equal(snapshot.parcelId, parcel.id);
  assert.equal(snapshot.districtId, 'R2');
  assert.deepEqual(snapshot.parcelBoundary, core.cadastre.parcelPolygon(parcel.id));
  assert.ok(snapshot.buildableFootprint.length > 0);
  assert.ok(snapshot.maxHeightMeters > 0);
  assert.ok(snapshot.effectiveFAR > 0);
});

test('urban fabric overlay pass draws canonical cadastre and selected zoning envelope', () => {
  const core = coreFixture();
  const parcel = core.cadastre.listParcels()[0]!;
  const pass = new OverlayRenderPass();
  const camera = new IsometricCamera();

  const cadastre = recordingContext();
  pass.draw(cadastre.ctx, core, camera, 'none', 'none', 'none', 'none', 'cadastre', parcel.id);
  assert.ok(cadastre.strokes() > 0, 'cadastre mode should stroke canonical parcel/frontage geometry');

  const zoning = recordingContext();
  pass.draw(zoning.ctx, core, camera, 'none', 'none', 'none', 'none', 'zoning-envelope', parcel.id);
  assert.ok(zoning.strokes() > 0, 'zoning envelope should stroke parcel and legal footprint');
  assert.ok(zoning.fills() > 0, 'zoning envelope should fill setback/buildable areas');
  assert.ok(zoning.labels().some((label) => /m$/.test(label)), 'zoning envelope should label legal height');
});