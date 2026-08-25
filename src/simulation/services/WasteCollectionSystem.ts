import { SERVICE_DEFINITIONS } from '../../data/services.ts';
import { definitionForBuilding, type Building } from '../buildings/BuildingSystem.ts';
import type { ServiceDispatchSystem, ServiceJob } from './ServiceDispatchSystem.ts';
import type { ServiceFacilitySystem } from './ServiceFacilitySystem.ts';

export type BuildingWasteState = Readonly<{
  buildingId: string;
  currentCollectibleWaste: number;
  wasteGenerationRate: number;
  lastCollectionTick: number;
  missedCollectionCount: number;
}>;

type MutableWasteState = {
  buildingId: string;
  currentCollectibleWaste: number;
  wasteGenerationRate: number;
  lastCollectionTick: number;
  missedCollectionCount: number;
};

export type WasteCollectionSnapshot = Readonly<{
  buildings: readonly BuildingWasteState[];
  processingQueue: number;
  processedTotal: number;
  jobCargo: readonly (readonly [string, number])[];
  jobAssignments: readonly (readonly [string, string])[];
}>;

export class WasteCollectionSystem {
  readonly pickupThreshold = 6;
  readonly truckCapacity = 20;
  private readonly states = new Map<string, MutableWasteState>();
  private readonly jobByBuilding = new Map<string, string>();
  private readonly cargoByJob = new Map<string, number>();
  processingQueue = 0;
  processedTotal = 0;

  syncBuildings(buildings: readonly Building[], tick: number): void {
    const occupiedIds = new Set<string>();
    for (const building of buildings.filter((item) => item.status === 'occupied').sort((a, b) => a.id.localeCompare(b.id))) {
      occupiedIds.add(building.id);
      const rate = definitionForBuilding(building).garbageGeneration;
      const existing = this.states.get(building.id);
      if (existing) existing.wasteGenerationRate = rate;
      else this.states.set(building.id, { buildingId: building.id, currentCollectibleWaste: 0, wasteGenerationRate: rate, lastCollectionTick: tick, missedCollectionCount: 0 });
    }
    for (const id of [...this.states.keys()]) {
      if (!occupiedIds.has(id)) {
        this.states.delete(id);
        this.jobByBuilding.delete(id);
      }
    }
  }

  generate(buildings: readonly Building[], tick: number): number {
    this.syncBuildings(buildings, tick);
    let generated = 0;
    for (const state of [...this.states.values()].sort((a, b) => a.buildingId.localeCompare(b.buildingId))) {
      state.currentCollectibleWaste += state.wasteGenerationRate;
      generated += state.wasteGenerationRate;
      if (state.currentCollectibleWaste >= this.pickupThreshold && tick - state.lastCollectionTick >= 100 && !this.jobByBuilding.has(state.buildingId)) state.missedCollectionCount++;
    }
    return generated;
  }

  pendingCollectionTargets(): string[] {
    return [...this.states.values()]
      .filter((state) => state.currentCollectibleWaste >= this.pickupThreshold && !this.jobByBuilding.has(state.buildingId))
      .map((state) => state.buildingId)
      .sort();
  }

  createCollectionJobs(tick: number, dispatch: ServiceDispatchSystem): string[] {
    const ids: string[] = [];
    for (const buildingId of this.pendingCollectionTargets()) {
      const state = this.states.get(buildingId)!;
      const severity = Math.max(0.1, Math.min(1, state.currentCollectibleWaste / 40));
      const jobId = dispatch.createJob('garbage_collection', buildingId, tick, severity);
      this.jobByBuilding.set(buildingId, jobId);
      ids.push(jobId);
    }
    return ids;
  }

  applyJobs(jobs: readonly ServiceJob[], facilities: ServiceFacilitySystem, tick: number): void {
    for (const job of jobs.filter((item) => item.type === 'garbage_collection').sort((a, b) => a.id.localeCompare(b.id))) {
      if (job.status === 'completed' && this.cargoByJob.has(job.id)) {
        this.processingQueue += this.cargoByJob.get(job.id) ?? 0;
        this.cargoByJob.delete(job.id);
        this.jobByBuilding.delete(job.targetBuildingId);
      }
      const state = this.states.get(job.targetBuildingId);
      if (!state) continue;
      if (job.status === 'servicing' && !this.cargoByJob.has(job.id)) {
        const collected = Math.min(this.truckCapacity, state.currentCollectibleWaste);
        state.currentCollectibleWaste -= collected;
        state.lastCollectionTick = tick;
        state.missedCollectionCount = 0;
        this.cargoByJob.set(job.id, collected);
      }
      if (job.status === 'failed') this.jobByBuilding.delete(job.targetBuildingId);
    }
    this.processQueue(facilities);
  }

  processQueue(facilities: ServiceFacilitySystem): number {
    if (this.processingQueue <= 0) return 0;
    let remainingCapacity = 0;
    for (const facility of facilities.listFacilities().filter((item) => item.department === 'garbage')) {
      const definition = SERVICE_DEFINITIONS[facility.type];
      remainingCapacity += facilities.effectiveCapacity(facility.id) * definition.processingEfficiency;
    }
    const processed = Math.min(this.processingQueue, remainingCapacity);
    this.processingQueue -= processed;
    this.processedTotal += processed;
    return processed;
  }

  getBuildingWaste(buildingId: string): BuildingWasteState | undefined {
    const state = this.states.get(buildingId);
    return state ? { ...state } : undefined;
  }

  totalBuildingWaste(): number {
    return [...this.states.values()].reduce((sum, state) => sum + state.currentCollectibleWaste, 0);
  }

  totalBacklog(): number {
    return this.totalBuildingWaste() + this.processingQueue;
  }

  snapshot(): WasteCollectionSnapshot {
    return Object.freeze({
      buildings: Object.freeze([...this.states.values()].map((state) => ({ ...state })).sort((a, b) => a.buildingId.localeCompare(b.buildingId))),
      processingQueue: this.processingQueue,
      processedTotal: this.processedTotal,
      jobCargo: Object.freeze([...this.cargoByJob.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([id, value]) => [id, value] as const)),
      jobAssignments: Object.freeze([...this.jobByBuilding.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([buildingId, jobId]) => [buildingId, jobId] as const)),
    });
  }

  restore(states: readonly BuildingWasteState[], processingQueue: number, processedTotal: number, jobCargo: readonly (readonly [string, number])[], jobAssignments: readonly (readonly [string, string])[] = []): void {
    this.states.clear();
    for (const state of states) {
      if (!Number.isFinite(state.currentCollectibleWaste) || state.currentCollectibleWaste < 0) throw new Error('invalid building waste');
      this.states.set(state.buildingId, { ...state });
    }
    if (!Number.isFinite(processingQueue) || processingQueue < 0 || !Number.isFinite(processedTotal) || processedTotal < 0) throw new Error('invalid waste processing state');
    this.processingQueue = processingQueue;
    this.processedTotal = processedTotal;
    this.cargoByJob.clear();
    for (const [id, value] of jobCargo) this.cargoByJob.set(id, value);
    this.jobByBuilding.clear();
    for (const [buildingId, jobId] of jobAssignments) this.jobByBuilding.set(buildingId, jobId);
  }
}
