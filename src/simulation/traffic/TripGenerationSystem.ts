import type { Building } from '../buildings/BuildingSystem.ts';
import type { HouseholdTravelDemand } from '../housing/HousingTypes.ts';
import { SeededRandom } from '../core/SeededRandom.ts';

export type TripPurpose = 'commute' | 'shopping';

export type TripRequest = Readonly<{
  id: string;
  originBuildingId: string;
  destinationBuildingId: string;
  departureTick: number;
  travelerWeight: number;
  purpose: TripPurpose;
}>;

export class TripGenerationSystem {
  private readonly random: SeededRandom;
  private nextTripId = 1;

  constructor(seed: number) {
    this.random = new SeededRandom(seed ^ 0x5f3759df);
  }

  generate(tick: number, buildings: readonly Building[], population: number, employed: number): TripRequest[] {
    const occupied = buildings.filter((building) => building.status === 'occupied').slice().sort((a, b) => a.id.localeCompare(b.id));
    const homes = occupied.filter((building) => building.zone === 'residential');
    const jobs = occupied.filter((building) => building.zone === 'commercial' || building.zone === 'industrial');
    const shops = occupied.filter((building) => building.zone === 'commercial');
    if (homes.length === 0) return [];

    const trips: TripRequest[] = [];
    const commuterWeight = Math.max(1, Math.ceil(Math.max(0, employed) / homes.length));
    const shopperPool = Math.max(0, Math.round(Math.max(0, population) * 0.25));
    const shoppingWeight = Math.max(1, Math.ceil(shopperPool / homes.length));

    if (jobs.length > 0 && employed > 0) {
      for (let i = 0; i < homes.length; i++) {
        const home = homes[i];
        if (!home) continue;
        const offset = this.random.nextInt(jobs.length);
        const destination = jobs[(i + offset) % jobs.length];
        if (!destination) continue;
        trips.push(this.createTrip(tick, home.id, destination.id, commuterWeight, 'commute'));
      }
    }

    if (shops.length > 0 && shopperPool > 0) {
      for (let i = 0; i < homes.length; i++) {
        const home = homes[i];
        if (!home) continue;
        const offset = this.random.nextInt(shops.length);
        const destination = shops[(i + offset) % shops.length];
        if (!destination) continue;
        trips.push(this.createTrip(tick, home.id, destination.id, shoppingWeight, 'shopping'));
      }
    }

    return trips.sort((a, b) => a.id.localeCompare(b.id));
  }

  generateHouseholdDemand(tick: number, buildings: readonly Building[], demand: readonly HouseholdTravelDemand[]): TripRequest[] {
    const occupied = buildings.filter((building) => building.status === 'occupied').slice().sort((a, b) => a.id.localeCompare(b.id));
    const validIds = new Set(occupied.map((building) => building.id));
    const shops = occupied.filter((building) => building.zone === 'commercial');
    const trips: TripRequest[] = [];
    const ordered = demand.slice().sort((a, b) => a.originBuildingId.localeCompare(b.originBuildingId) || (a.destinationBuildingId ?? '').localeCompare(b.destinationBuildingId ?? ''));

    for (let index = 0; index < ordered.length; index++) {
      const item = ordered[index]!;
      if (!validIds.has(item.originBuildingId)) continue;
      if (item.commuterWeight > 0 && item.destinationBuildingId && validIds.has(item.destinationBuildingId)) {
        trips.push(this.createTrip(tick, item.originBuildingId, item.destinationBuildingId, item.commuterWeight, 'commute'));
      }
      if (item.shoppingWeight > 0 && shops.length > 0) {
        const offset = this.random.nextInt(shops.length);
        const destination = shops[(index + offset) % shops.length]!;
        trips.push(this.createTrip(tick, item.originBuildingId, destination.id, item.shoppingWeight, 'shopping'));
      }
    }
    return trips.sort((a, b) => a.id.localeCompare(b.id));
  }

  getRandomState(): number { return this.random.getState(); }
  restoreRandomState(state: number, nextTripId: number): void { this.random.setState(state); this.nextTripId = Math.max(1, Math.floor(nextTripId)); }
  getNextTripId(): number { return this.nextTripId; }

  private createTrip(tick: number, originBuildingId: string, destinationBuildingId: string, travelerWeight: number, purpose: TripPurpose): TripRequest {
    return { id: `trip:${this.nextTripId++}`, originBuildingId, destinationBuildingId, departureTick: tick, travelerWeight, purpose };
  }
}
