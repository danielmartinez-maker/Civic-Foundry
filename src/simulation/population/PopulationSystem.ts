import { clamp01 } from '../core/types.ts';

export class PopulationSystem {
  population: number;

  constructor(initialPopulation = 0) {
    this.population = Math.max(0, Math.floor(initialPopulation));
  }

  update(residentialCapacity: number, attractiveness: number): void {
    const capacity = Math.max(0, Math.floor(residentialCapacity));
    if (this.population > capacity) this.population = capacity;
    if (capacity === 0) {
      this.population = 0;
      return;
    }
    const score = clamp01(attractiveness);
    if (score < 0.3) {
      this.population = Math.max(0, this.population - 2);
    } else if (this.population < capacity) {
      this.population = Math.min(capacity, this.population + Math.max(1, Math.floor(2 * score)));
    }
  }
}
