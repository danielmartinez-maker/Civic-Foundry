import type { CadastralGraph } from '../../world/cadastre/CadastralGraph.ts';
import type { PropertyMarketSystem } from './PropertyMarketSystem.ts';

const MAX_ASSEMBLY_PARCELS = 4;
const TRANSACTION_COST_RATE = 0.02;
const CARRYING_COST_RATE = 0.01;

export type SiteAssemblyEnvelopeResolution = Readonly<{
  bestFeasibleHbuValue: number;
  expectedReturn: number;
  developerHurdleRate: number;
  incrementalDemolitionCost: number;
}>;

export type SiteAssemblyEnvelopeResolver = (
  parcelIds: readonly string[],
) => SiteAssemblyEnvelopeResolution;

export type SiteAssemblyCandidate = Readonly<{
  seedParcelId: string;
  parcelIds: readonly string[];
  addedParcelIds: readonly string[];
  independentHbuValue: number;
  assembledHbuValue: number;
  incrementalDevelopmentValue: number;
  acquisitionPremiums: number;
  transactionCosts: number;
  carryingCost: number;
  incrementalDemolitionCost: number;
  incrementalAssemblyCost: number;
  netAssemblyUplift: number;
  expectedReturn: number;
  developerHurdleRate: number;
}>;

export class SiteAssemblySystem {
  candidates(
    seedParcelId: string,
    graph: CadastralGraph,
    propertyMarket: PropertyMarketSystem,
    envelopeResolver: SiteAssemblyEnvelopeResolver,
  ): readonly SiteAssemblyCandidate[] {
    const seedParcel = graph.getParcel(seedParcelId);
    if (!seedParcel) throw new Error(`unknown assembly seed parcel: ${seedParcelId}`);

    const seedOwnerId = propertyMarket.ownerOf(seedParcelId);
    if (!seedOwnerId) throw new Error(`assembly seed parcel has no property owner: ${seedParcelId}`);

    const connectedSets = enumerateConnectedSets(seedParcelId, graph)
      .filter((parcelIds) => parcelIds.every((parcelId) => {
        const parcel = graph.getParcel(parcelId);
        return parcel?.blockId === seedParcel.blockId
          && parcel.zoningDistrictId === seedParcel.zoningDistrictId;
      }));

    const candidates: SiteAssemblyCandidate[] = [];
    for (const parcelIds of connectedSets) {
      const independentResolutions = parcelIds.map((parcelId) => {
        const resolution = envelopeResolver(Object.freeze([parcelId]));
        validateResolution(resolution, `independent parcel ${parcelId}`);
        return resolution;
      });
      const assembledResolution = envelopeResolver(parcelIds);
      validateResolution(assembledResolution, `assembled parcels ${parcelIds.join('+')}`);

      const independentHbuValue = independentResolutions
        .reduce((sum, resolution) => sum + resolution.bestFeasibleHbuValue, 0);
      const assembledHbuValue = assembledResolution.bestFeasibleHbuValue;
      const incrementalDevelopmentValue = assembledHbuValue - independentHbuValue;
      const addedParcelIds = parcelIds.filter((parcelId) => parcelId !== seedParcelId);

      let acquisitionPremiums = 0;
      let transactionCosts = 0;
      let carryingCost = 0;
      let missingHolding = false;
      for (const addedParcelId of addedParcelIds) {
        const ownerId = propertyMarket.ownerOf(addedParcelId);
        const reservationValue = propertyMarket.reservationValue(addedParcelId);
        if (!ownerId || reservationValue === undefined) {
          missingHolding = true;
          break;
        }
        if (ownerId === seedOwnerId) continue;
        const independentIndex = parcelIds.indexOf(addedParcelId);
        const independentValue = independentResolutions[independentIndex]!.bestFeasibleHbuValue;
        acquisitionPremiums += Math.max(0, reservationValue - independentValue);
        transactionCosts += reservationValue * TRANSACTION_COST_RATE;
        carryingCost += reservationValue * CARRYING_COST_RATE;
      }
      if (missingHolding) continue;

      const incrementalAssemblyCost = acquisitionPremiums
        + transactionCosts
        + carryingCost
        + assembledResolution.incrementalDemolitionCost;
      if (incrementalDevelopmentValue <= incrementalAssemblyCost) continue;
      if (assembledResolution.expectedReturn < assembledResolution.developerHurdleRate) continue;

      candidates.push(Object.freeze({
        seedParcelId,
        parcelIds: Object.freeze([...parcelIds]),
        addedParcelIds: Object.freeze([...addedParcelIds]),
        independentHbuValue,
        assembledHbuValue,
        incrementalDevelopmentValue,
        acquisitionPremiums,
        transactionCosts,
        carryingCost,
        incrementalDemolitionCost: assembledResolution.incrementalDemolitionCost,
        incrementalAssemblyCost,
        netAssemblyUplift: incrementalDevelopmentValue - incrementalAssemblyCost,
        expectedReturn: assembledResolution.expectedReturn,
        developerHurdleRate: assembledResolution.developerHurdleRate,
      }));
    }

    candidates.sort((left, right) =>
      right.netAssemblyUplift - left.netAssemblyUplift
      || left.parcelIds.length - right.parcelIds.length
      || left.parcelIds.join('|').localeCompare(right.parcelIds.join('|')));
    return Object.freeze(candidates);
  }
}

function enumerateConnectedSets(seedParcelId: string, graph: CadastralGraph): readonly (readonly string[])[] {
  const seen = new Set<string>();
  const results: string[][] = [];

  const visit = (current: readonly string[]): void => {
    const canonical = canonicalParcelIds(current);
    const key = canonical.join('|');
    if (seen.has(key)) return;
    seen.add(key);
    if (canonical.length >= 2) results.push(canonical);
    if (canonical.length >= MAX_ASSEMBLY_PARCELS) return;

    const selected = new Set(canonical);
    const neighbors = canonical
      .flatMap((parcelId) => [...graph.adjacentParcelIds(parcelId)])
      .filter((parcelId) => !selected.has(parcelId))
      .sort((left, right) => left.localeCompare(right));

    for (const neighbor of [...new Set(neighbors)]) visit([...canonical, neighbor]);
  };

  visit([seedParcelId]);
  results.sort((left, right) =>
    left.length - right.length
    || left.join('|').localeCompare(right.join('|')));
  return Object.freeze(results.map((parcelIds) => Object.freeze([...parcelIds])));
}

function canonicalParcelIds(parcelIds: readonly string[]): string[] {
  return [...new Set(parcelIds)].sort((left, right) => left.localeCompare(right));
}

function validateResolution(resolution: SiteAssemblyEnvelopeResolution, label: string): void {
  requireFiniteNonNegative(`${label} bestFeasibleHbuValue`, resolution.bestFeasibleHbuValue);
  requireFiniteNonNegative(`${label} expectedReturn`, resolution.expectedReturn);
  requireFiniteNonNegative(`${label} developerHurdleRate`, resolution.developerHurdleRate);
  requireFiniteNonNegative(`${label} incrementalDemolitionCost`, resolution.incrementalDemolitionCost);
}

function requireFiniteNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite and non-negative`);
}
