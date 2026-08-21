import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { TreasurySystem } from '../src/simulation/treasury/TreasurySystem.ts';
import { RoadSystem } from '../src/world/roads/RoadSystem.ts';
import { TransportationGraph } from '../src/simulation/traffic/TransportationGraph.ts';
import { TripGenerationSystem } from '../src/simulation/traffic/TripGenerationSystem.ts';
import { PersonTripSystem } from '../src/simulation/mobility/PersonTripSystem.ts';
import { ModeChoiceSystem } from '../src/simulation/mobility/ModeChoiceSystem.ts';
import type { Building } from '../src/simulation/buildings/BuildingSystem.ts';
import type { JourneyPlan } from '../src/simulation/transit/JourneyPlanner.ts';

function graphFixture() {
  const cells: TerrainCell[] = Array.from({ length: 12 * 8 }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' }));
  const terrain = new TerrainGrid(12, 8, cells); const treasury = new TreasurySystem(100_000); const roads = new RoadSystem(terrain);
  roads.placePath(Array.from({ length: 10 }, (_, i) => ({ x: i + 1, y: 4 })), 'collector', treasury); const graph = new TransportationGraph(); graph.rebuildIfNeeded(roads); return graph;
}
const buildings: Building[] = [
  { id: 'home:a', lotId: 'lot:a', x: 2, y: 3, zone: 'residential', definitionId: 'residential_cottage', status: 'occupied', constructionStartedTick: 0, completionTick: 0 },
  { id: 'home:b', lotId: 'lot:b', x: 4, y: 3, zone: 'residential', definitionId: 'residential_cottage', status: 'occupied', constructionStartedTick: 0, completionTick: 0 },
  { id: 'job:a', lotId: 'lot:c', x: 9, y: 3, zone: 'commercial', definitionId: 'commercial_shop', status: 'occupied', constructionStartedTick: 0, completionTick: 0 },
];
function plan(mode: 'car' | 'transit', cost: number, fare = 0): JourneyPlan { return { mode, nodeIds: ['a', 'b'], legs: [], totalGeneralizedCost: cost, walkingTicks: 0, expectedWaitTicks: 0, inVehicleTicks: cost, transferPenaltyTicks: 0, fare, boardings: mode === 'transit' ? 1 : 0, transfers: 0 }; }

test('person-trip cohorts are deterministic and preserve weighted Phase 3 demand', () => {
  const graph = graphFixture(); const a = new PersonTripSystem(new TripGenerationSystem(77)); const b = new PersonTripSystem(new TripGenerationSystem(77));
  const first = a.generate(100, buildings, 20, 8, graph); const second = b.generate(100, buildings, 20, 8, graph);
  assert.deepEqual(first, second); assert.ok(first.length > 0); assert.ok(first.every((trip) => trip.travelerWeight > 0)); assert.ok(first.every((trip) => trip.originRoadNodeId && trip.destinationRoadNodeId)); assert.ok(first.some((trip) => trip.purpose === 'commute'));
});
test('competitive transit beats a more expensive car alternative', () => { const choice = new ModeChoiceSystem().choose(plan('car', 120), plan('transit', 70)); assert.equal(choice.mode, 'transit'); assert.equal(choice.chosenCost, 70); });
test('slow or circuitous transit loses to a cheaper car trip', () => { assert.equal(new ModeChoiceSystem().choose(plan('car', 80), plan('transit', 150)).mode, 'car'); });
test('crowding can reverse transit mode choice while fare remains embedded in generalized cost', () => { const chooser = new ModeChoiceSystem(); assert.equal(chooser.choose(plan('car', 100), plan('transit', 90, 4)).mode, 'transit'); const crowded = chooser.choose(plan('car', 100), plan('transit', 90, 4), { crowdingPenaltyTicks: 25 }); assert.equal(crowded.mode, 'car'); assert.equal(crowded.transitCost, 115); });
test('equal generalized cost deterministically favors car and missing alternatives degrade safely', () => { const chooser = new ModeChoiceSystem(); assert.equal(chooser.choose(plan('car', 90), plan('transit', 90)).mode, 'car'); assert.equal(chooser.choose(null, plan('transit', 90)).mode, 'transit'); assert.equal(chooser.choose(plan('car', 90), null).mode, 'car'); assert.equal(chooser.choose(null, null).mode, 'unmet'); });
test('person trips retain unmet access as null rather than fabricating a route', () => { const graph = graphFixture(); const isolated: Building[] = [{ ...buildings[0]!, id: 'isolated-home', x: 11, y: 7 }, buildings[2]!]; const trips = new PersonTripSystem(new TripGenerationSystem(12)).generate(100, isolated, 10, 5, graph); assert.ok(trips.length > 0); assert.equal(trips[0]?.originRoadNodeId, null); });
