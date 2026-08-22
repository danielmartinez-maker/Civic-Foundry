import type { EmploymentSnapshot } from '../employment/EmploymentSystem.ts';
import type { Firm } from './FirmSystem.ts';

export type LaborAllocation = Readonly<{ snapshot: EmploymentSnapshot; filledByFirm: Readonly<Record<string, number>> }>;

export class LaborMarketSystem {
  allocateDetailed(firms: readonly Firm[], population: number, inputs: { accessibility: number; utilityRatio: number }): LaborAllocation {
    const workforce = Math.floor(Math.max(0, population) * 0.5);
    const active = firms.filter((f) => f.status === 'operating' || f.status === 'distressed').sort((a, b) => b.cashHealth - a.cashHealth || a.id.localeCompare(b.id));
    const totalJobs = active.reduce((s, f) => s + f.jobCapacity, 0);
    const availability = Math.max(0, Math.min(1, inputs.accessibility)) * Math.max(0, Math.min(1, inputs.utilityRatio));
    let remaining = Math.floor(workforce * availability);
    const filledByFirm: Record<string, number> = {};
    for (const firm of active) { const filled = Math.min(firm.jobCapacity, remaining); filledByFirm[firm.id] = filled; remaining -= filled; }
    const employed = Object.values(filledByFirm).reduce((a, b) => a + b, 0);
    const unemployed = Math.max(0, workforce - employed);
    const snapshot: EmploymentSnapshot = { workforce, totalJobs, employed, unemployed, vacancies: Math.max(0, totalJobs - employed), unemploymentRate: workforce === 0 ? 0 : unemployed / workforce };
    return { snapshot, filledByFirm: Object.freeze(filledByFirm) };
  }
  allocate(firms: readonly Firm[], population: number, inputs: { accessibility: number; utilityRatio: number }): EmploymentSnapshot { return this.allocateDetailed(firms, population, inputs).snapshot; }
}
