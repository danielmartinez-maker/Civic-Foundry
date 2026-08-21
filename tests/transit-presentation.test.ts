import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { collectHudMetrics } from '../src/ui/Hud.ts';
import { inspectCell, inspectTransitLine, inspectTransitVehicle } from '../src/ui/Inspector.ts';
import { ToolController } from '../src/ui/ToolController.ts';
import { TransitPanelController, collectTransitPanelState } from '../src/ui/TransitPanel.ts';
import { mapTransitOverlay, type TransitOverlayMode } from '../src/rendering/TransitOverlayLayer.ts';
import { locateTransitVehicle } from '../src/rendering/TransitVehicleRenderer.ts';
import type { TransitPassengerCohort } from '../src/simulation/transit/PassengerQueueSystem.ts';

function flatTerrain(width = 20, height = 10): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' as const }));
  return new TerrainGrid(width, height, cells);
}

function transitCore(): { core: SimulationCore; lineId: string; stopA: string; stopB: string } {
  const core = new SimulationCore({ terrain: flatTerrain(), seed: 501, startingFunds: 1_000_000 });
  core.buildRoad(Array.from({ length: 16 }, (_, i) => ({ x: i + 2, y: 5 })), 'collector');
  core.transportationGraph.rebuildIfNeeded(core.roads);

  const tools = new ToolController();
  tools.setTool('transit-stop');
  assert.equal(tools.applyCell(core, 3, 4).ok, true);
  assert.equal(tools.applyCell(core, 15, 4).ok, true);
  const [first, second] = core.transit.listStops();
  assert.ok(first && second);

  const panel = new TransitPanelController(core);
  const lineId = panel.createLine('bus', 'Crosstown');
  assert.equal(panel.setLineStops(lineId, [first.id, second.id]).ok, true);
  assert.equal(panel.setHeadway(lineId, 30).ok, true);
  assert.equal(panel.setFare(lineId, 1.75).ok, true);
  assert.equal(panel.setEnabled(lineId, true).ok, true);
  assert.equal(panel.setFleetLimit(lineId, 1).ok, true);
  return { core, lineId, stopA: first.id, stopB: second.id };
}

test('HUD mirrors authoritative Phase V mobility values', () => {
  const { core } = transitCore();
  core.mobilitySnapshot = Object.freeze({
    carModeShare: 0.37, transitModeShare: 0.58, unmetShare: 0.05, personAccessibility: 0.81,
    ridership: 420, meanWaitTicks: 18.5, reliability: 0.93, crowding: 0.64,
    transitOperatingCost: 125.5, transitFareRevenue: 76.25,
  });
  const metrics = collectHudMetrics(core);
  assert.equal(metrics.carModeShare, 0.37);
  assert.equal(metrics.transitModeShare, 0.58);
  assert.equal(metrics.unmetTripShare, 0.05);
  assert.equal(metrics.personAccessibility, 0.81);
  assert.equal(metrics.transitRidership, 420);
  assert.equal(metrics.transitMeanWaitTicks, 18.5);
  assert.equal(metrics.transitReliability, 0.93);
  assert.equal(metrics.transitCrowding, 0.64);
  assert.equal(metrics.transitOperatingCost, 125.5);
  assert.equal(metrics.transitFareRevenue, 76.25);
});

test('transit stop, line, and vehicle inspectors expose authoritative operating state', () => {
  const { core, lineId, stopA, stopB } = transitCore();
  const passenger: TransitPassengerCohort = Object.freeze({
    id: 'presentation-passenger:1', personTripId: 'presentation-trip:1', travelerWeight: 25,
    lineId, directionKey: 'forward', boardingStopId: stopA, alightingStopId: stopB,
    destinationRoadNodeId: 'n:15,5', enqueuedTick: 0, transferLegs: Object.freeze([]),
  });
  core.mobility.passengers.enqueue(stopA, lineId, 'forward', passenger);

  const stop = core.transit.getStop(stopA)!;
  const stopInspection = inspectCell(core, stop.x, stop.y);
  assert.equal(stopInspection.kind, 'transit-stop');
  assert.ok(stopInspection.lines.some((line) => line.includes('Crosstown')));
  assert.ok(stopInspection.lines.includes('Waiting passengers: 25.0'));

  const lineInspection = inspectTransitLine(core, lineId);
  assert.equal(lineInspection.kind, 'transit-line');
  assert.ok(lineInspection.lines.includes('Mode: bus'));
  assert.ok(lineInspection.lines.includes('Headway: 30 ticks'));
  assert.ok(lineInspection.lines.includes('Fleet: 0 active / 1 limit'));
  assert.ok(lineInspection.lines.some((line) => line.startsWith('Cost recovery: ')));

  const vehicleId = core.mobility.vehicles.dispatchRun(core.transit.getLine(lineId)!, 0)!;
  const vehicleInspection = inspectTransitVehicle(core, vehicleId);
  assert.equal(vehicleInspection.kind, 'transit-vehicle');
  assert.ok(vehicleInspection.lines.includes('Line: Crosstown'));
  assert.ok(vehicleInspection.lines.some((line) => line.startsWith('Load: 0.0 / ')));
  assert.ok(vehicleInspection.lines.some((line) => line.startsWith('Next stop: ')));
});

test('transit overlays expose deterministic data and numeric legends', () => {
  const { core } = transitCore();
  core.mobilitySnapshot = Object.freeze({
    carModeShare: 0.4, transitModeShare: 0.55, unmetShare: 0.05, personAccessibility: 0.78,
    ridership: 110, meanWaitTicks: 12, reliability: 0.9, crowding: 0.5,
    transitOperatingCost: 30, transitFareRevenue: 15,
  });
  const modes: TransitOverlayMode[] = ['routes', 'access', 'ridership', 'crowding', 'wait', 'reliability', 'mode-share', 'accessibility'];
  for (const mode of modes) {
    const snapshot = mapTransitOverlay(core, mode);
    assert.equal(snapshot.mode, mode);
    assert.ok(snapshot.legend.length > 0);
  }
  assert.equal(mapTransitOverlay(core, 'routes').routes.length, 1);
  assert.equal(mapTransitOverlay(core, 'access').stops.length, 2);
  assert.match(mapTransitOverlay(core, 'access').legend, /\d/);
  assert.match(mapTransitOverlay(core, 'ridership').legend, /\d/);
  assert.match(mapTransitOverlay(core, 'crowding').legend, /0%.*100%/);
  assert.match(mapTransitOverlay(core, 'wait').legend, /\d/);
  assert.match(mapTransitOverlay(core, 'reliability').legend, /0%.*100%/);
  assert.match(mapTransitOverlay(core, 'mode-share').legend, /0%.*100%/);
  assert.match(mapTransitOverlay(core, 'accessibility').legend, /0%.*100%/);
  assert.equal(mapTransitOverlay(core, 'mode-share').globalValue, 0.55);
  assert.equal(mapTransitOverlay(core, 'accessibility').globalValue, 0.78);
});

test('transit player commands wire stop placement and line configuration to authoritative systems', () => {
  const { core, lineId, stopA, stopB } = transitCore();
  const panel = new TransitPanelController(core);
  const state = collectTransitPanelState(core);
  assert.equal(state.lines.length, 1);
  assert.deepEqual(state.lines[0]?.stopIds, [stopA, stopB]);
  assert.equal(state.lines[0]?.headwayTicks, 30);
  assert.equal(state.lines[0]?.fare, 1.75);
  assert.equal(state.lines[0]?.fleetLimit, 1);
  assert.equal(state.lines[0]?.enabled, true);

  assert.equal(panel.setHeadway(lineId, 45).ok, true);
  assert.equal(core.transit.getLine(lineId)?.headwayTicks, 45);
  assert.equal(panel.setFare(lineId, 2.25).ok, true);
  assert.equal(core.transit.getLine(lineId)?.fare, 2.25);
  assert.equal(panel.setEnabled(lineId, false).ok, true);
  assert.equal(core.transit.getLine(lineId)?.enabled, false);
  assert.equal(panel.setFleetLimit(lineId, 3).ok, true);
  assert.equal(core.mobility.operations.snapshotLine(lineId).fleetLimit, 3);
});

test('transit vehicle render position derives from authoritative stop/route progress', () => {
  const { core, lineId, stopA } = transitCore();
  const vehicleId = core.mobility.vehicles.dispatchRun(core.transit.getLine(lineId)!, 0)!;
  const vehicle = core.mobility.vehicles.getVehicle(vehicleId)!;
  const position = locateTransitVehicle(vehicle, core.transit, core.transportationGraph, new Map());
  const stop = core.transit.getStop(stopA)!;
  assert.deepEqual(position, { x: stop.x, y: stop.y });
});
