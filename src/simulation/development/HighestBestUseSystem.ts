export type HighestBestUseStrategy =
  | 'none'
  | 'hold'
  | 'renovate'
  | 'convert'
  | 'redevelop'
  | 'assemble';

export type HighestBestUseAlternative = Readonly<{
  strategy: Exclude<HighestBestUseStrategy, 'none'>;
  netValue: number;
  expectedReturn: number;
  riskScore: number;
  riskAdjustedReturn: number;
  eligible: boolean;
}>;

export type HighestBestUseInput = Readonly<{
  parcelIds: readonly string[];
  holdValue: number;
  buildingCondition: number;
  developerHurdleRate: number;
  renovationNetValue: number;
  renovationExpectedReturn: number;
  renovationRiskScore: number;
  conversionNetValue: number;
  conversionExpectedReturn: number;
  conversionRiskScore: number;
  redevelopmentNetValue: number;
  redevelopmentExpectedReturn: number;
  redevelopmentRiskScore: number;
  assemblyNetValue?: number;
  assemblyExpectedReturn?: number;
  assemblyRiskScore?: number;
}>;

export type HighestBestUseResult = Readonly<{
  parcelIds: readonly string[];
  buildingCondition: number;
  bestStrategy: HighestBestUseStrategy;
  bestValue: number;
  holdValue: number;
  redevelopmentPremium: number;
  alternatives: readonly HighestBestUseAlternative[];
}>;

const STRATEGY_ORDER: Readonly<Record<Exclude<HighestBestUseStrategy, 'none'>, number>> = Object.freeze({
  hold: 0,
  renovate: 1,
  convert: 2,
  redevelop: 3,
  assemble: 4,
});

export class HighestBestUseSystem {
  evaluate(input: HighestBestUseInput): HighestBestUseResult {
    validateInput(input);
    const parcelIds = canonicalParcelIds(input.parcelIds);
    const alternatives: HighestBestUseAlternative[] = [
      createHoldAlternative(input.holdValue),
      createAlternative('renovate', input.renovationNetValue, input.renovationExpectedReturn, input.renovationRiskScore, input.developerHurdleRate),
      createAlternative('convert', input.conversionNetValue, input.conversionExpectedReturn, input.conversionRiskScore, input.developerHurdleRate),
      createAlternative('redevelop', input.redevelopmentNetValue, input.redevelopmentExpectedReturn, input.redevelopmentRiskScore, input.developerHurdleRate),
    ];

    if (input.assemblyNetValue !== undefined) {
      alternatives.push(createAlternative(
        'assemble',
        input.assemblyNetValue,
        input.assemblyExpectedReturn ?? 0,
        input.assemblyRiskScore ?? 0,
        input.developerHurdleRate,
      ));
    }

    alternatives.sort((a, b) => STRATEGY_ORDER[a.strategy] - STRATEGY_ORDER[b.strategy]);
    const eligible = alternatives
      .filter((alternative) => alternative.eligible)
      .sort((a, b) => b.netValue - a.netValue || STRATEGY_ORDER[a.strategy] - STRATEGY_ORDER[b.strategy]);
    const best = eligible[0];

    return Object.freeze({
      parcelIds: Object.freeze(parcelIds),
      buildingCondition: input.buildingCondition,
      bestStrategy: best?.strategy ?? 'none',
      bestValue: best?.netValue ?? 0,
      holdValue: input.holdValue,
      redevelopmentPremium: input.redevelopmentNetValue - input.holdValue,
      alternatives: Object.freeze(alternatives),
    });
  }
}

function createHoldAlternative(holdValue: number): HighestBestUseAlternative {
  return Object.freeze({
    strategy: 'hold',
    netValue: holdValue,
    expectedReturn: 0,
    riskScore: 0,
    riskAdjustedReturn: 0,
    eligible: holdValue > 0,
  });
}

function createAlternative(
  strategy: Exclude<HighestBestUseStrategy, 'none' | 'hold'>,
  netValue: number,
  expectedReturn: number,
  riskScore: number,
  hurdleRate: number,
): HighestBestUseAlternative {
  const riskAdjustedReturn = expectedReturn * (1 - riskScore);
  return Object.freeze({
    strategy,
    netValue,
    expectedReturn,
    riskScore,
    riskAdjustedReturn,
    eligible: netValue > 0 && riskAdjustedReturn >= hurdleRate,
  });
}

function validateInput(input: HighestBestUseInput): void {
  if (!Array.isArray(input.parcelIds) || input.parcelIds.length === 0) {
    throw new Error('highest-and-best-use requires at least one parcel');
  }
  const seen = new Set<string>();
  for (const parcelId of input.parcelIds) {
    if (typeof parcelId !== 'string' || parcelId.trim().length === 0) throw new Error('parcel id must be non-empty');
    if (seen.has(parcelId)) throw new Error(`duplicate parcel id: ${parcelId}`);
    seen.add(parcelId);
  }

  validateNonNegative('holdValue', input.holdValue);
  validateRange('buildingCondition', input.buildingCondition, 0, 100);
  validateRange('developerHurdleRate', input.developerHurdleRate, 0, 1);
  validateAlternative('renovation', input.renovationNetValue, input.renovationExpectedReturn, input.renovationRiskScore);
  validateAlternative('conversion', input.conversionNetValue, input.conversionExpectedReturn, input.conversionRiskScore);
  validateAlternative('redevelopment', input.redevelopmentNetValue, input.redevelopmentExpectedReturn, input.redevelopmentRiskScore);

  if (input.assemblyNetValue !== undefined) {
    validateAlternative(
      'assembly',
      input.assemblyNetValue,
      input.assemblyExpectedReturn ?? 0,
      input.assemblyRiskScore ?? 0,
    );
  } else if (input.assemblyExpectedReturn !== undefined || input.assemblyRiskScore !== undefined) {
    throw new Error('assembly return or risk requires assemblyNetValue');
  }
}

function validateAlternative(name: string, netValue: number, expectedReturn: number, riskScore: number): void {
  validateNonNegative(`${name}NetValue`, netValue);
  validateRange(`${name}ExpectedReturn`, expectedReturn, 0, 1);
  validateRange(`${name}RiskScore`, riskScore, 0, 1);
}

function validateNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite and non-negative`);
}

function validateRange(name: string, value: number, minimum: number, maximum: number): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be within [${minimum}, ${maximum}]`);
  }
}

function canonicalParcelIds(parcelIds: readonly string[]): string[] {
  return [...parcelIds].sort((a, b) => a.localeCompare(b));
}
