import test from 'node:test';
import assert from 'node:assert/strict';
import type { Building } from '../src/simulation/buildings/BuildingSystem.ts';
import { TripGenerationSystem } from '../src/simulation/traffic/TripGenerationSystem.ts';

function occupiedBuilding(id: string, zone: Building['zone']): Building {
  const definitionId = zone === 'residential'
    ? 'residential_cottage'
    : zone === 'commercial'
      ? 'commercial_shop'
      : 'industrial_factory';
  return {
    id,
    lotId: `lot:${id}`,
    x: 0,
    y: 0,
    zone,
    definitionId,
    status: 'occupied',
    constructionStartedTick: 0,
    completionTick: 0,
  };
}

function totalWeight(trips: readonly Readonly<{ travelerWeight: number }>[]): number {
  return trips.reduce((sum, trip) => sum + trip.travelerWeight, 0);
}

test('commute generation conserves the employed traveler pool across many homes', () => {
  const homes = Array.from({ length: 100 }, (_, index) => occupiedBuilding(`home:${String(index).padStart(3, '0')}`, 'residential'));
  const job = occupiedBuilding('job:1', 'industrial');
  const trips = new TripGenerationSystem(17).generate(10, [...homes, job], 100, 1);
  const commutes = trips.filter((trip) => trip.purpose === 'commute');

  assert.equal(commutes.length, homes.length);
  assert.ok(Math.abs(totalWeight(commutes) - 1) < 1e-9);
});

test('shopping generation conserves the shopper pool across many homes', () => {
  const homes = Array.from({ length: 100 }, (_, index) => occupiedBuilding(`home:${String(index).padStart(3, '0')}`, 'residential'));
  const shop = occupiedBuilding('shop:1', 'commercial');
  const population = 10;
  const shopperPool = Math.round(population * 0.25);
  const trips = new TripGenerationSystem(23).generate(10, [...homes, shop], population, 0);
  const shopping = trips.filter((trip) => trip.purpose === 'shopping');

  assert.equal(shopping.length, homes.length);
  assert.ok(Math.abs(totalWeight(shopping) - shopperPool) < 1e-9);
});
