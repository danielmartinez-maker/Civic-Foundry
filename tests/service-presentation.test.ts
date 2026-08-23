import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { collectHudMetrics } from '../src/ui/Hud.ts';
import { inspectCell } from '../src/ui/Inspector.ts';
import { ToolController } from '../src/ui/ToolController.ts';
import { mapServiceOverlay } from '../src/rendering/ServiceOverlayLayer.ts';
import { locateServiceVehicle } from '../src/rendering/ServiceVehicleRenderer.ts';

function flatTerrain(width = 24, height = 16): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' as const }));
  return new TerrainGrid(width, height, cells);
}

function seededCore(): SimulationCore {
  const core = new SimulationCore({ terrain: flatTerrain(), seed: 77, startingFunds: 500_000 });
  core.buildRoad(Array.from({ length: 18 }, (_, i) => ({ x: i + 2, y: 8 })), 'collector');
  core.buildings.restore([
    { id: 'building:home', lotId: 'lot:home', x: 6, y: 7, zone: 'residential', definitionId: 'residential_fixture', status: 'occupied', constructionStartedTick: 0, completionTick: 0 },
  ]);
  core.population.restore(10);
  core.services.restore([
    { id: 'service:1', type: 'fire_station', department: 'fire', x: 3, y: 7 },
    { id: 'service:2', type: 'elementary_school', department: 'education', x: 10, y: 7 },
  ], { fire: 120, education: 80 }, 3, 0.9);
  core.serviceVehicles.syncFleet(core.services);
  core.serviceAccessByBuilding = Object.freeze({
    'building:home': Object.freeze({ fire: 0.8, police: 0.4, healthcare: 0.6, education: 0.7, garbage: 0.5 }),
  });
  core.neighborhoodSnapshot = Object.freeze({
    perBuilding: Object.freeze({
      'building:home': Object.freeze({
        buildingId: 'building:home', fireSafety: 0.82, policeSafety: 0.38, healthcareAccess: 0.6,
        educationAccess: 0.7, garbageCleanliness: 0.45, combinedServiceQuality: 0.61, primaryIssue: 'police',
      }),
    }),
    citywideServiceQuality: 0.61,
    commercialServiceQuality: 0.415,
  });
  core.educationSnapshot = Object.freeze({
    eligibleStudents: 2, reachableStudents: 2, enrolledStudents: 2, effectiveSeats: 96,
    overcrowdedStudents: 0, averageSchoolAccessTicks: 33, educationServiceRatio: 0.74,
  });
  core.wasteCollection.restore([
    { buildingId: 'building:home', currentCollectibleWaste: 9, wasteGenerationRate: 2, lastCollectionTick: 0, missedCollectionCount: 1 },
  ], 0, 0, []);
  const jobId = core.serviceDispatch.createJob('fire_response', 'building:home', 10, 0.8);
  core.serviceDispatch.restore([{ ...core.serviceDispatch.getJob(jobId)!, status: 'waiting' }], 2);
  return core;
}

test('HUD mirrors authoritative public-service quality, education, fleet, jobs, and fiscal state', () => {
  const core = seededCore();
  const metrics = collectHudMetrics(core);
  assert.equal(metrics.serviceQuality, 0.61);
  assert.equal(metrics.educationServiceRatio, 0.74);
  assert.equal(metrics.activeServiceVehicles, core.serviceVehicles.listVehicles().filter((vehicle) => vehicle.state !== 'unavailable').length);
  assert.equal(metrics.waitingServiceJobs, 1);
  assert.equal(metrics.serviceOperatingCost, core.services.totalOperatingCost());
  assert.equal(metrics.serviceFiscalRatio, 0.9);
});

test('building inspector explains service access, quality issue, and detailed waste', () => {
  const core = seededCore();
  const inspection = inspectCell(core, 6, 7);
  assert.equal(inspection.kind, 'building');
  assert.ok(inspection.lines.includes('Service quality: 61%'));
  assert.ok(inspection.lines.includes('Primary service issue: police'));
  assert.ok(inspection.lines.includes('Fire access: 80%'));
  assert.ok(inspection.lines.includes('Education access: 70%'));
  assert.ok(inspection.lines.includes('Collectible waste: 9.0'));
});

test('service facility inspector exposes department funding, staffing, capacity, vehicles, jobs, and operating cost', () => {
  const core = seededCore();
  const inspection = inspectCell(core, 3, 7);
  assert.equal(inspection.kind, 'service');
  assert.ok(inspection.lines.includes('Department: fire'));
  assert.ok(inspection.lines.includes('Funding: 120%'));
  assert.ok(inspection.lines.some((line) => line.startsWith('Effective staffing: ')));
  assert.ok(inspection.lines.some((line) => line.startsWith('Effective capacity: ')));
  assert.ok(inspection.lines.some((line) => line.startsWith('Active vehicles: ')));
  assert.ok(inspection.lines.some((line) => line.startsWith('Open jobs: ')));
  assert.ok(inspection.lines.some((line) => line.startsWith('Operating cost: $')));
});

test('service overlay maps authoritative building scores and always includes a numeric legend', () => {
  const core = seededCore();
  const fire = mapServiceOverlay(core, 'fire');
  const quality = mapServiceOverlay(core, 'quality');
  assert.equal(fire.cells.length, 1);
  assert.equal(fire.cells[0]?.buildingId, 'building:home');
  assert.equal(fire.cells[0]?.value, 0.82);
  assert.match(fire.cells[0]?.label ?? '', /82%/);
  assert.match(fire.legend, /0%/);
  assert.match(fire.legend, /100%/);
  assert.equal(quality.cells[0]?.value, 0.61);
});

test('service build tools invoke typed service placement instead of utility placement', () => {
  const core = new SimulationCore({ terrain: flatTerrain(), startingFunds: 500_000 });
  core.buildRoad([{ x: 4, y: 8 }, { x: 5, y: 8 }], 'local');
  const tools = new ToolController();
  tools.setTool('service-fire');
  const fire = tools.applyCell(core, 4, 7);
  assert.equal(fire.ok, true);
  assert.equal(core.services.getAt(4, 7)?.type, 'fire_station');
  tools.setTool('service-recycling');
  const recycling = tools.applyCell(core, 5, 7);
  assert.equal(recycling.ok, true);
  assert.equal(core.services.getAt(5, 7)?.type, 'recycling_center');
});

test('service vehicle render position is derived from its authoritative route progress', () => {
  const core = seededCore();
  core.transportationGraph.rebuildIfNeeded(core.roads);
  const edge = core.transportationGraph.edges.find((candidate) => candidate.from !== candidate.to)!;
  const fireVehicle = core.serviceVehicles.listVehicles().find((vehicle) => vehicle.vehicleType === 'fire_engine')!;
  core.serviceVehicles.restore([{ ...fireVehicle, state: 'outbound', edgeIds: [edge.id], returnEdgeIds: [edge.id], currentEdgeIndex: 0, edgeProgressTicks: edge.freeFlowTicks / 2, currentJobId: 'service-job:1', currentNodeId: edge.from, destinationNodeId: edge.to, homeNodeId: edge.from }]);
  const position = locateServiceVehicle(core.serviceVehicles.listVehicles()[0]!, core.transportationGraph, new Map([[edge.id, edge.freeFlowTicks]]));
  const from = core.transportationGraph.getNode(edge.from)!;
  const to = core.transportationGraph.getNode(edge.to)!;
  assert.ok(position);
  assert.equal(position!.x, (from.x + to.x) / 2);
  assert.equal(position!.y, (from.y + to.y) / 2);
});
