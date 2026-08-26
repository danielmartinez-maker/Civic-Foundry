import { clamp01 } from '../core/types.ts';
import type { PersonPopulationProjection } from '../people/PersonPopulationProjection.ts';

export class PopulationSystem {
  private legacyPopulation: number;
  private personProjection: PersonPopulationProjection | null = null;

  constructor(initialPopulation = 0) {
    this.legacyPopulation = Math.max(0, Math.floor(initialPopulation));
  }

  get population(): number {
    return this.personProjection?.snapshot().population ?? this.legacyPopulation;
  }

  attachPersonProjection(projection: PersonPopulationProjection): void {
    if (this.personProjection && this.personProjection !== projection) {
      throw new Error('population is already person-derived');
    }
    this.personProjection = projection;
  }

  update(residentialCapacity: number, attractiveness: number): void {
    if (this.personProjection) throw new Error('population is person-derived');

    const capacity = Math.max(0, Math.floor(residentialCapacity));
    if (this.legacyPopulation > capacity) this.legacyPopulation = capacity;
    if (capacity === 0) {
      this.legacyPopulation = 0;
      return;
    }
    const score = clamp01(attractiveness);
    if (score < 0.3) {
      this.legacyPopulation = Math.max(0, this.legacyPopulation - 2);
    } else if (this.legacyPopulation < capacity) {
      this.legacyPopulation = Math.min(
        capacity,
        this.legacyPopulation + Math.max(1, Math.floor(2 * score)),
      );
    }
  }

  restore(population: number): void {
    if (this.personProjection) throw new Error('population is person-derived');
    if (!Number.isFinite(population) || population < 0) throw new Error('invalid population restore');
    this.legacyPopulation = Math.floor(population);
  }
}
