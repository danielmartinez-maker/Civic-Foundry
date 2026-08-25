import type { Building } from '../../simulation/buildings/BuildingSystem.ts';

export type ConstructionVisualStage = 'site' | 'foundation' | 'structure' | 'facade' | 'complete';

export function constructionProgress(building: Pick<Building, 'status' | 'constructionStartedTick' | 'completionTick'>, tick: number): number {
  if (building.status === 'occupied') return 1;
  const duration = Math.max(1, building.completionTick - building.constructionStartedTick);
  return Math.max(0, Math.min(1, (tick - building.constructionStartedTick) / duration));
}

export function constructionStageFor(
  building: Pick<Building, 'status' | 'constructionStartedTick' | 'completionTick'>,
  tick: number,
): ConstructionVisualStage {
  if (building.status === 'occupied') return 'complete';
  const progress = constructionProgress(building, tick);
  if (progress < 0.15) return 'site';
  if (progress < 0.35) return 'foundation';
  if (progress < 0.70) return 'structure';
  return 'facade';
}
