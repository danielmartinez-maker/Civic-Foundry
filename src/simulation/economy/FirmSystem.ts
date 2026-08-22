import type { Building } from '../buildings/BuildingSystem.ts';
import { ARCHETYPES, LIFECYCLE, type FirmArchetype } from '../../data/economy.ts';

export type FirmStatus = 'forming' | 'operating' | 'distressed' | 'closed';
export type Firm = Readonly<{
  id: string;
  buildingId: string;
  zone: 'commercial' | 'industrial';
  archetype: FirmArchetype;
  status: FirmStatus;
  jobCapacity: number;
  filledJobs: number;
  vacancies: number;
  productivity: number;
  cashHealth: number;
  consecutiveLossCycles: number;
  consecutiveRecoveryCycles: number;
  formationTick: number;
  closureTick?: number;
  lastOperatingMargin: number;
  distressReason?: string;
}>;

type MutableFirm = Omit<Firm, 'status'> & { status: FirmStatus };

function stableNumber(text: string, seed: number): number {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

export class FirmSystem {
  private readonly firms = new Map<string, MutableFirm>();
  private nextId = 1;
  readonly seed: number;
  constructor(seed: number) { this.seed = seed; }

  syncEligibleBuildings(buildings: readonly Building[], tick: number): void {
    const eligible = buildings.filter((b) => b.status === 'occupied' && (b.zone === 'commercial' || b.zone === 'industrial')).sort((a, b) => a.id.localeCompare(b.id));
    const buildingIds = new Set(eligible.map((b) => b.id));
    for (const firm of this.firms.values()) {
      if (firm.status !== 'closed' && !buildingIds.has(firm.buildingId)) this.update(firm.id, { status: 'closed', closureTick: tick, filledJobs: 0, vacancies: 0, distressReason: 'building removed' });
    }
    for (const building of eligible) {
      if ([...this.firms.values()].some((firm) => firm.buildingId === building.id && firm.status !== 'closed')) continue;
      const zone = building.zone as 'commercial' | 'industrial';
      const choices: FirmArchetype[] = zone === 'commercial' ? ['retail_local', 'wholesale_logistics'] : ['light_manufacturing', 'assembly_manufacturing'];
      const archetype = choices[stableNumber(building.id, this.seed) % choices.length]!;
      const definition = ARCHETYPES[archetype];
      const id = `firm:${this.nextId++}`;
      this.firms.set(id, {
        id, buildingId: building.id, zone, archetype, status: 'forming', jobCapacity: definition.jobCapacity,
        filledJobs: 0, vacancies: 0, productivity: definition.baseProductivity, cashHealth: LIFECYCLE.initialCashHealth,
        consecutiveLossCycles: 0, consecutiveRecoveryCycles: 0, formationTick: tick, lastOperatingMargin: 0,
      });
    }
  }

  list(): Firm[] { return [...this.firms.values()].map((f) => ({ ...f })).sort((a, b) => a.id.localeCompare(b.id)); }
  get(id: string): Firm | undefined { const f = this.firms.get(id); return f ? { ...f } : undefined; }
  getByBuildingId(buildingId: string): Firm | undefined { const f = [...this.firms.values()].find((x) => x.buildingId === buildingId && x.status !== 'closed'); return f ? { ...f } : undefined; }
  update(id: string, patch: Partial<Omit<Firm, 'id' | 'buildingId' | 'zone' | 'archetype'>>): void { const f = this.firms.get(id); if (f) Object.assign(f, patch); }
  snapshotState(): { firms: Firm[]; nextId: number; seed: number } { return { firms: this.list(), nextId: this.nextId, seed: this.seed }; }
  restoreState(state: { firms: readonly Firm[]; nextId: number }): void { this.firms.clear(); for (const f of state.firms) this.firms.set(f.id, { ...f }); this.nextId = state.nextId; }
}
