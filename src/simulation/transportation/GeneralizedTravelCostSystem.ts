export type GeneralizedTravelCostInput = Readonly<{
  mode: string;
  available: boolean;
  inVehicleTimeTicks: number;
  waitTimeTicks: number;
  accessEgressTicks: number;
  transferCount: number;
  transferPenaltyTicks: number;
  reliabilityPenaltyTicks: number;
  parkingSearchTicks: number;
  moneyCost: number;
  moneyWeightTicksPerCurrency: number;
}>;

export type GeneralizedTravelCostBreakdown = Readonly<{
  inVehicleTimeTicks: number;
  waitTimeTicks: number;
  accessEgressTicks: number;
  transferPenaltyTicks: number;
  reliabilityPenaltyTicks: number;
  parkingSearchTicks: number;
  moneyImpedanceTicks: number;
}>;

export type GeneralizedTravelCostResult = Readonly<{
  input: GeneralizedTravelCostInput;
  totalTicks: number;
  breakdown: GeneralizedTravelCostBreakdown;
}>;

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be finite and non-negative`);
  }
  return value;
}

function validate(input: GeneralizedTravelCostInput): void {
  if (input.mode.trim().length === 0) throw new Error("mode must be non-empty");
  finiteNonNegative(input.inVehicleTimeTicks, "inVehicleTimeTicks");
  finiteNonNegative(input.waitTimeTicks, "waitTimeTicks");
  finiteNonNegative(input.accessEgressTicks, "accessEgressTicks");
  finiteNonNegative(input.transferPenaltyTicks, "transferPenaltyTicks");
  finiteNonNegative(input.reliabilityPenaltyTicks, "reliabilityPenaltyTicks");
  finiteNonNegative(input.parkingSearchTicks, "parkingSearchTicks");
  finiteNonNegative(input.moneyCost, "moneyCost");
  finiteNonNegative(
    input.moneyWeightTicksPerCurrency,
    "moneyWeightTicksPerCurrency",
  );
  if (!Number.isSafeInteger(input.transferCount) || input.transferCount < 0) {
    throw new Error("transferCount must be a non-negative safe integer");
  }
}

export class GeneralizedTravelCostSystem {
  evaluate(
    input: GeneralizedTravelCostInput,
  ): GeneralizedTravelCostResult | null {
    validate(input);
    if (!input.available) return null;

    const breakdown: GeneralizedTravelCostBreakdown = Object.freeze({
      inVehicleTimeTicks: input.inVehicleTimeTicks,
      waitTimeTicks: input.waitTimeTicks,
      accessEgressTicks: input.accessEgressTicks,
      transferPenaltyTicks: input.transferCount * input.transferPenaltyTicks,
      reliabilityPenaltyTicks: input.reliabilityPenaltyTicks,
      parkingSearchTicks: input.parkingSearchTicks,
      moneyImpedanceTicks: input.moneyCost * input.moneyWeightTicksPerCurrency,
    });
    const totalTicks = Object.values(breakdown).reduce(
      (total, value) => total + value,
      0,
    );
    if (!Number.isFinite(totalTicks))
      throw new Error("generalized travel cost must remain finite");

    return Object.freeze({
      input: Object.freeze({ ...input }),
      totalTicks,
      breakdown,
    });
  }
}
