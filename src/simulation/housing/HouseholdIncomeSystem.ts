import { HOUSEHOLD_WAGE_BY_ARCHETYPE, HOUSING_CONFIG } from '../../data/housing.ts';
import { clamp } from '../core/types.ts';
import type { Firm } from '../economy/FirmSystem.ts';
import { HouseholdCohortSystem } from './HouseholdCohortSystem.ts';
import type { HouseholdAffordabilityState, HouseholdCohort, HouseholdStateSnapshot } from './HousingTypes.ts';

export type HouseholdIncomeSnapshot = Readonly<{
  totalWorkers: number;
  employedWorkers: number;
  unemployedWorkers: number;
  aggregateGrossIncome: number;
  averageEmploymentStability: number;
}>;

type MutableHousehold = { -readonly [K in keyof HouseholdCohort]: HouseholdCohort[K] };

function affordabilityState(burden: number): HouseholdAffordabilityState {
  if (burden < HOUSING_CONFIG.comfortableBurden) return 'comfortable';
  if (burden < HOUSING_CONFIG.manageableBurden) return 'manageable';
  if (burden < HOUSING_CONFIG.severeBurden) return 'stressed';
  return 'severe';
}

function clone(h: HouseholdCohort): MutableHousehold {
  return {
    ...h,
    employerFirmIds: [...h.employerFirmIds],
    mortgage: h.mortgage ? { ...h.mortgage } : null,
    preferences: { ...h.preferences },
  } as MutableHousehold;
}

export class HouseholdIncomeSystem {
  reconcile(cohorts: HouseholdCohortSystem, firms: readonly Firm[]): HouseholdIncomeSnapshot {
    const snapshot = cohorts.snapshotState();
    const households = snapshot.households.map(clone);
    let nextId = snapshot.nextId;
    const fallback = HOUSING_CONFIG.unemployedWorkerFallbackIncome;

    for (const h of households) {
      h.employedWorkers = 0;
      h.employerFirmIds = [];
      h.grossIncome = h.workers * fallback;
      h.disposableHousingIncome = h.grossIncome * HOUSING_CONFIG.disposableIncomeRatio;
      h.employmentStability = h.workers === 0 ? 1 : 0.25;
      h.housingCostBurden = h.housingCost <= 0 ? 0 : h.grossIncome <= 0 ? 1 : h.housingCost / h.grossIncome;
      h.affordabilityState = affordabilityState(h.housingCostBurden);
    }

    const active = firms
      .filter((firm) => (firm.status === 'operating' || firm.status === 'distressed') && firm.filledJobs > 0)
      .slice()
      .sort((a, b) => b.cashHealth - a.cashHealth || a.id.localeCompare(b.id));

    const maxWorkers = households.reduce((max, h) => Math.max(max, h.workers), 0);
    for (const firm of active) {
      let remaining = Math.max(0, Math.floor(firm.filledJobs));
      const healthModifier = clamp(0.85 + firm.cashHealth * 0.30, 0.85, 1.15);
      const productivityModifier = clamp(0.90 + (firm.productivity - 1) * 0.20, 0.85, 1.20);
      const wage = HOUSEHOLD_WAGE_BY_ARCHETYPE[firm.archetype] * healthModifier * productivityModifier;

      for (let pass = 0; pass < maxWorkers && remaining > 0; pass++) {
        const candidates = households
          .filter((h) => h.workers > pass && h.employedWorkers === pass)
          .slice()
          .sort((a, b) => a.id.localeCompare(b.id));
        for (const candidate of candidates) {
          if (remaining <= 0) break;
          let target = candidate;
          if (remaining < candidate.weight) {
            const branch = clone(candidate);
            branch.id = `household:${nextId++}`;
            branch.weight = remaining;
            candidate.weight -= remaining;
            households.push(branch);
            target = branch;
          }
          const assigned = Math.min(remaining, target.weight);
          if (assigned !== target.weight) throw new Error('income allocation split invariant failed');
          target.employedWorkers += 1;
          target.employerFirmIds = [...target.employerFirmIds, firm.id];
          target.grossIncome += wage - fallback;
          target.disposableHousingIncome = target.grossIncome * HOUSING_CONFIG.disposableIncomeRatio;
          const employerHealth = target.employerFirmIds.map((id) => active.find((item) => item.id === id)?.cashHealth ?? 0.25);
          target.employmentStability = employerHealth.reduce((sum, value) => sum + value, 0) / Math.max(1, employerHealth.length);
          target.housingCostBurden = target.housingCost <= 0 ? 0 : target.housingCost / Math.max(1, target.grossIncome);
          target.affordabilityState = affordabilityState(target.housingCostBurden);
          remaining -= assigned;
        }
      }
    }

    households.sort((a, b) => a.id.localeCompare(b.id));
    const state: HouseholdStateSnapshot = { households, nextId };
    cohorts.restoreState(state);
    const totalWorkers = households.reduce((sum, h) => sum + h.workers * h.weight, 0);
    const employedWorkers = households.reduce((sum, h) => sum + h.employedWorkers * h.weight, 0);
    const aggregateGrossIncome = households.reduce((sum, h) => sum + h.grossIncome * h.weight, 0);
    const represented = households.reduce((sum, h) => sum + h.weight, 0);
    const averageEmploymentStability = represented === 0 ? 1 : households.reduce((sum, h) => sum + h.employmentStability * h.weight, 0) / represented;
    return Object.freeze({
      totalWorkers,
      employedWorkers,
      unemployedWorkers: Math.max(0, totalWorkers - employedWorkers),
      aggregateGrossIncome,
      averageEmploymentStability,
    });
  }
}
