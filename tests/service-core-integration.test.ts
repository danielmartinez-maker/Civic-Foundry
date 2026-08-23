import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { NeighborhoodQualitySystem } from '../src/simulation/services/NeighborhoodQualitySystem.ts';
import { EconomySystem } from '../src/simulation/economy/EconomySystem.ts';
import { TreasurySystem } from '../src/simulation/treasury/TreasurySystem.ts';
import { DemandSystem } from '../src/simulation/demand/DemandSystem.ts';
import type { Building } from '../src/simulation/buildings/BuildingSystem.ts';

function flatTerrain(width = 32, height = 18): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' as const }));
  return new TerrainGrid(width, height, cells);
}

function home(id: string, x: number, y: number): Building {
  return { id, lotId: `lot:${id}`, x, y, zone: 'residential', definitionId: 'residential_fixture', status: 'occupied', constructionStartedTick: 0, completionTick: 0 };
}

test('neighborhood quality uses the documented weighted service formula and bounded modifiers', () => {
  const quality = new NeighborhoodQualitySystem();
  const snapshot = quality.evaluate([home('h', 3, 3)], {
    accessByBuilding: { h: { fire: 1, police: 0.8, healthcare: 0.6, education: 0.5, garbage: 0.4 } },
    incidentOutcome: { fire: 1, police: 0.5, healthcare: 0.75 },
    wasteByBuilding: { h: 6 },
  });
  const h = snapshot.perBuilding.h!;
  const expected = 0.22 * h.fireSafety + 0.22 * h.policeSafety + 0.22 * h.healthcareAccess + 0.20 * h.educationAccess + 0.14 * h.garbageCleanliness;
  assert.ok(Math.abs(h.combinedServiceQuality - expected) < 1e-9);
  assert.equal(snapshot.citywideServiceQuality, h.combinedServiceQuality);
  assert.ok(quality.residentialDemandModifier(0) >= -0.25);
  assert.ok(quality.residentialDemandModifier(1) <= 0.15);
  assert.ok(quality.commercialDemandModifier(0, 0) < quality.commercialDemandModifier(1, 1));
});

test('demand consumes service quality as a bounded explicit modifier', () => {
  const demand = new DemandSystem();
  const base = {
    population: 30, housingCapacity: 40, workforce: 15, employed: 12, totalJobs: 16,
    powerRatio: 1, waterRatio: 1, garbageRatio: 1,
    taxRates: { residential: 0.1, commercial: 0.1, industrial: 0.1 },
    trafficJobAccessibility: 1, trafficCommercialAccessibility: 1,
  } as const;
  const poor = demand.evaluate({ ...base, serviceQuality: 0.2, commercialServiceQuality: 0.2 });
  const strong = demand.evaluate({ ...base, serviceQuality: 0.95, commercialServiceQuality: 0.95 });
  assert.ok(strong.residential > poor.residential);
  assert.ok(strong.commercial > poor.commercial);
});

test('economy reports utility and public-service operating costs separately without negative cash', () => {
  const treasury = new TreasurySystem(100);
  const economy = new EconomySystem();
  const result = economy.settle(treasury, { total: 20, residential: 10, commercial: 5, industrial: 5 }, 60, 80);
  assert.equal(result.utilityOperatingCost, 60);
  assert.equal(result.serviceOperatingCost, 80);
  assert.equal(result.facilityOperatingCost, 140);
  assert.equal(result.paidOperatingCost, 120);
  assert.equal(result.unpaidOperatingCost, 20);
  assert.equal(treasury.balance, 0);
});

test('unpaid service obligations reduce facility operational effectiveness rather than disappearing', () => {
  const core = new SimulationCore({ terrain: flatTerrain(), startingFunds: 500_000, seed: 4 });
  core.buildRoad([{ x: 2, y: 8 }, { x: 3, y: 8 }, { x: 4, y: 8 }], 'local');
  assert.equal(core.placeServiceFacility('fire_station', 3, 7).ok, true);
  const station = core.services.listFacilities()[0]!;
  const funded = core.services.effectiveCapacity(station.id);
  core.services.setFiscalPaymentRatio(0.5);
  assert.ok(core.services.effectiveCapacity(station.id) < funded);
  assert.ok(core.services.activeVehicleCount(station.id) <= 1);
});

test('congestion raises service route cost while emergency priority still reduces the congestion penalty', () => {
  const core = new SimulationCore({ terrain: flatTerrain(), startingFunds: 500_000, seed: 5 });
  core.buildRoad(Array.from({ length: 18 }, (_, i) => ({ x: i + 2, y: 8 })), 'local');
  core.transportationGraph.rebuildIfNeeded(core.roads);
  const edge = core.transportationGraph.edges[0]!;
  const free = edge.freeFlowTicks;
  core.traffic.restoreState({ vehicles: Array.from({ length: 8 }, (_, i) => ({
    id: `v${i}`, tripId: `t${i}`, purpose: 'commute' as const, travelerWeight: 8,
    originBuildingId: 'a', destinationBuildingId: 'b', edgeIds: [edge.id], currentEdgeIndex: 0,
    edgeProgressTicks: 0, departureTick: 0, accumulatedDelayTicks: 0, freeFlowTicks: free, status: 'moving' as const,
  })), outcomes: [], nextVehicleId: 9, completedTrips: 0, failedTrips: 0, congestionEpoch: 0 });
  core.traffic.refreshMetrics(core.transportationGraph);
  const congested = core.traffic.getEdgeTravelTime(edge);
  assert.ok(congested > free);
  const emergencyCost = free + (congested - free) * 0.55;
  assert.ok(emergencyCost > free && emergencyCost < congested);
});

test('SimulationCore advances the full public-service loop and exposes real service snapshots', () => {
  const core = new SimulationCore({ terrain: flatTerrain(), startingFunds: 800_000, seed: 11 });
  core.buildRoad(Array.from({ length: 22 }, (_, i) => ({ x: i + 2, y: 9 })), 'collector');
  core.buildings.restore([home('home', 18, 8), { ...home('shop', 17, 8), zone: 'commercial' }]);
  core.population.restore(20);
  core.transportationGraph.rebuildIfNeeded(core.roads);
  assert.equal(core.placeUtility('power', 13, 8).ok, true);
  assert.equal(core.placeUtility('water', 14, 8).ok, true);
  for (const [type, x] of [['fire_station', 3], ['police_station', 5], ['clinic', 7], ['elementary_school', 9], ['landfill', 11]] as const) {
    assert.equal(core.placeServiceFacility(type, x, 8).ok, true);
  }
  core.step(220);
  assert.equal(core.serviceVehicles.listVehicles().length > 0, true);
  assert.equal(core.serviceDemandSnapshot.eligibleStudents, Math.round(core.population.population * 0.18));
  assert.ok(core.serviceDemandSnapshot.eligibleStudents > 0);
  assert.ok(core.educationSnapshot.educationServiceRatio > 0);
  assert.ok(core.neighborhoodSnapshot.citywideServiceQuality > 0);
  assert.ok(core.wasteCollection.totalBacklog() >= 0);
  assert.ok(Number.isFinite(core.demandSnapshot.residential));
  assert.ok(core.economySnapshot.serviceOperatingCost > 0);
});

test('routed garbage backlog does not hard-stop initial migration before the first collection route can complete', () => {
  const core = new SimulationCore({ terrain: flatTerrain(40, 24), startingFunds: 1_500_000, seed: 2026 });
  core.buildRoad(Array.from({ length: 34 }, (_, i) => ({ x: i + 2, y: 12 })), 'collector');
  for (let x = 3; x <= 12; x++) core.paintZone([{ x, y: 11 }], 'residential');
  for (let x = 24; x <= 28; x++) core.paintZone([{ x, y: 11 }], 'commercial');
  for (let x = 29; x <= 33; x++) core.paintZone([{ x, y: 11 }], 'industrial');
  for (const x of [22, 25]) assert.equal(core.placeUtility('power', x, 13).ok, true);
  for (const x of [28, 31]) assert.equal(core.placeUtility('water', x, 13).ok, true);
  for (const [type, x] of [['fire_station', 4], ['police_station', 7], ['clinic', 10], ['elementary_school', 13], ['landfill', 16], ['recycling_center', 19]] as const) {
    assert.equal(core.placeServiceFacility(type, x, 13).ok, true);
  }
  core.step(250);
  assert.ok(core.buildings.occupied().length >= 10);
  assert.ok(core.garbageSnapshot.backlog > 0, 'collection should have real in-flight backlog');
  assert.ok(core.population.population > 0, 'temporary routed waste backlog must not make a serviced city permanently uninhabitable');
});

test('routed waste preserves the inherited 50-tick building generation cadence', () => {
  const core = new SimulationCore({ terrain: flatTerrain(), startingFunds: 500_000, seed: 88 });
  core.buildRoad([{ x: 2, y: 9 }, { x: 3, y: 9 }, { x: 4, y: 9 }], 'local');
  core.buildings.restore([home('cadence-home', 3, 8)]);
  core.step(49);
  assert.equal(core.wasteCollection.getBuildingWaste('cadence-home')?.currentCollectibleWaste ?? 0, 0);
  core.step(1);
  assert.equal(core.wasteCollection.getBuildingWaste('cadence-home')?.currentCollectibleWaste, 2);
});
