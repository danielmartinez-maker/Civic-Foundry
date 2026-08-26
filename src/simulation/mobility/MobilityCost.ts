import type { MobilityCostBreakdown } from './MobilityTypes.ts';

export function buildMobilityCost(
  input: Omit<MobilityCostBreakdown, 'generalizedCost'>,
): MobilityCostBreakdown | null {
  const values = Object.values(input);
  if (values.some((value) => !Number.isFinite(value) || value < 0)) return null;
  const generalizedCost = values.reduce((sum, value) => sum + value, 0);
  return Object.freeze({ ...input, generalizedCost });
}
