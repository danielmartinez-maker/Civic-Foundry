import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { SimulationClock } from '../src/simulation/core/SimulationClock.ts';
import { SimulationKernel } from '../src/simulation/kernel/SimulationKernel.ts';
import { IntersectionSystem } from '../src/simulation/traffic/IntersectionSystem.ts';
import { TransportationGraph } from '../src/simulation/traffic/TransportationGraph.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { RoadSystem } from '../src/world/roads/RoadSystem.ts';
import { TreasurySystem } from '../src/simulation/treasury/TreasurySystem.ts';
import { TransitPanelController } from '../src/ui/TransitPanel.ts';
import { serializeCoreV6, hydrateCoreV6 } from '../src/save/saveV6.ts';
import { serializeCore, hydrateCore } from '../src/save/saveLegacy.ts';
import type { Firm } from '../src/simulation/economy/FirmSystem.ts';

function flatTerrain(width = 12, height = 8): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' as const }));
  return new TerrainGrid(width, height, cells);
}

function roadGraph(): { graph: TransportationGraph; roads: RoadSystem } {
  const terrain = flatTerrain();
  const treasury = new TreasurySystem(100_000);
  const roads = new RoadSystem(terrain);
  roads.placePath([{ x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 }], 'collector', treasury);
  roads.placePath([{ x: 4, y: 2 }, { x: 4, y: 3 }, { x: 4, y: 4 }], 'local', treasury);
  const graph = new TransportationGraph();
  graph.rebuildIfNeeded(roads);
  return { graph, roads };
}

test('intersection snapshots preserve durable released travelers until acknowledged', () => {
  const { graph } = roadGraph();
  const node = graph.findNodeAt(4, 3)!;
  const incoming = graph.outgoingEdges(node.id)[0]!;
  const original = new IntersectionSystem();
  original.enqueue(node.id, incoming.id, { vehicleId: 'vehicle:pending', travelerWeight: 1, queuedTick: 1 });
  assert.deepEqual(original.stepNode(graph, node.id, 2), ['vehicle:pending']);

  const restored = new IntersectionSystem();
  restored.restore(original.snapshot());
  assert.deepEqual(restored.stepNode(graph, node.id, 3), ['vehicle:pending']);
  restored.removeVehicle('vehicle:pending');
  assert.deepEqual(restored.stepNode(graph, node.id, 4), []);
});

test('legacy hydration rejects a queued traffic vehicle with no queue or pending release representation', () => {
  const core = new SimulationCore({ terrain: flatTerrain(), seed: 13 });
  core.buildRoad([{ x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 }], 'collector');
  core.transportationGraph.rebuildIfNeeded(core.roads);
  const edge = core.transportationGraph.edges[0]!;
  const save = structuredClone(serializeCore(core));
  save.traffic.vehicles.push({
    id: 'vehicle:corrupt', tripId: 'trip:corrupt', purpose: 'commute', travelerWeight: 1,
    originBuildingId: 'origin', destinationBuildingId: 'destination', edgeIds: [edge.id], currentEdgeIndex: 0,
    edgeProgressTicks: 0, departureTick: 0, accumulatedDelayTicks: 0, freeFlowTicks: edge.freeFlowTicks,
    status: 'queued', queuedNodeId: edge.to,
  });
  assert.throws(() => hydrateCore(save), /queued traffic.*intersection|intersection.*queued traffic/i);
});

test('V6 hydration rejects firms and financial rows that reference missing authoritative entities', () => {
  const core = new SimulationCore({ terrain: flatTerrain(), seed: 19 });
  const corrupt = structuredClone(serializeCoreV6(core));
  const fakeFirm: Firm = {
    id: 'firm:corrupt', buildingId: 'building:missing', zone: 'commercial', archetype: 'retail_local', status: 'operating',
    jobCapacity: 8, filledJobs: 1, vacancies: 7, productivity: 1, cashHealth: 1,
    consecutiveLossCycles: 0, consecutiveRecoveryCycles: 0, formationTick: 0, lastOperatingMargin: 0,
  };
  corrupt.economyDomain.firms.firms.push(fakeFirm);
  corrupt.economyDomain.financials.push({ firmId: 'firm:missing-financial', values: { revenue: 0, inputCost: 0, wageCost: 0, utilityCost: 0, taxCost: 0, logisticsCost: 0, shortagePenalty: 0, operatingMargin: 0 } });
  assert.throws(() => hydrateCoreV6(corrupt), /economy firm building reference|economy financial firm reference/i);
});

test('transit line configuration validates the full patch before mutating any field', () => {
  const core = new SimulationCore({ terrain: flatTerrain(), seed: 23 });
  const controller = new TransitPanelController(core) as TransitPanelController & Partial<{
    applyLineConfig(lineId: string, patch: { headwayTicks: number; fare: number; fleetLimit: number; enabled: boolean }): { ok: boolean; reason?: string };
  }>;
  const lineId = controller.createLine('bus', 'Atomic');
  const beforeLine = core.transit.getLine(lineId)!;
  const beforeFleet = core.mobility.operations.snapshotLine(lineId).fleetLimit;
  assert.equal(typeof controller.applyLineConfig, 'function');
  const result = controller.applyLineConfig!(lineId, { headwayTicks: 200, fare: 3.25, fleetLimit: 9, enabled: true });
  assert.equal(result.ok, false);
  const afterLine = core.transit.getLine(lineId)!;
  assert.equal(afterLine.headwayTicks, beforeLine.headwayTicks);
  assert.equal(afterLine.fare, beforeLine.fare);
  assert.equal(afterLine.enabled, beforeLine.enabled);
  assert.equal(core.mobility.operations.snapshotLine(lineId).fleetLimit, beforeFleet);
});

test('HTML escaping neutralizes user-controlled transit names', async () => {
  const modulePath = '../src/ui/escapeHtml.ts';
  const module = await import(modulePath) as { escapeHtml(value: string): string };
  assert.equal(module.escapeHtml(`<img src=x onerror="boom()"> O'Reilly & Co.`), '&lt;img src=x onerror=&quot;boom()&quot;&gt; O&#39;Reilly &amp; Co.');
});

test('GameApp uses V7 as the primary save slot while retaining a V6 migration key', async () => {
  const source = await readFile(new URL('../src/app/GameApp.ts', import.meta.url), 'utf8');
  assert.match(source, /civic-foundry-save-v7/);
  assert.match(source, /civic-foundry-save-v6/);
  assert.doesNotMatch(source, />Save V6</);
  assert.doesNotMatch(source, /Saved V6|Loaded V6/);
});

test('fatal kernel tick errors put the kernel into fail-stop mode instead of allowing continued mutation', () => {
  const clock = new SimulationClock();
  const kernel = new SimulationKernel({ clock, seed: 31 });
  let mutations = 0;
  kernel.registerSystem({
    id: 'faulting-system', reads: [], writes: ['state'], cadence: { every: 1 },
    execute: () => { mutations++; throw new Error('fatal tick'); },
  });
  assert.throws(() => kernel.step(), /fatal tick/);
  assert.equal(mutations, 1);
  assert.throws(() => kernel.step(), /faulted/i);
  assert.equal(mutations, 1);
});

test('terrain dimensions must be finite positive integers', () => {
  const cell: TerrainCell = { elevation: 0.5, water: false, buildable: true, biome: 'grass' };
  assert.throws(() => new TerrainGrid(2.5, 2, Array.from({ length: 5 }, () => cell)), /invalid terrain dimensions/);
  assert.throws(() => TerrainGrid.generate(Number.POSITIVE_INFINITY, 2, 1), /invalid terrain dimensions/);
});

test('lint is an independent source-quality gate rather than a duplicate typecheck command', async () => {
  const raw = await readFile(new URL('../package.json', import.meta.url), 'utf8');
  const pkg = JSON.parse(raw) as { scripts: Record<string, string> };
  assert.ok(pkg.scripts.lint);
  assert.notEqual(pkg.scripts.lint, pkg.scripts.typecheck);
});
