import { BUILDING_DEFINITION_BY_ID, getBuildingDefinition } from '../../data/buildings.ts';
import { BUILDING_TYPOLOGY_BY_ID } from '../../data/buildingTypologies.ts';
import { clamp, clamp01 } from '../core/types.ts';
import type {
  DevelopmentAward,
  DevelopmentBid,
  DevelopmentFeasibilityResult,
  DeveloperCommitment,
  DeveloperMarketContext,
  DeveloperMarketStateSnapshot,
  DeveloperSeed,
  DeveloperState,
  PhysicalDevelopmentFeasibilityResult,
} from './DevelopmentTypes.ts';

export const DEFAULT_DEVELOPER_SEEDS: readonly DeveloperSeed[] = Object.freeze([
  Object.freeze({
    id: 'industrial_specialist', availableCapital: 260_000, hurdleRate: 0.105, maxLeverage: 0.65,
    financingSpread: 0.025, riskTolerance: 0.80, maxConcurrentProjects: 3, minimumProjectCost: 0,
    preferences: Object.freeze({ residential: -0.05, commercial: 0, industrial: 0.06 }),
  }),
  Object.freeze({
    id: 'institutional_developer', availableCapital: 600_000, hurdleRate: 0.09, maxLeverage: 0.75,
    financingSpread: 0.018, riskTolerance: 0.85, maxConcurrentProjects: 4, minimumProjectCost: 100_000,
    preferences: Object.freeze({ residential: 0.02, commercial: 0.03, industrial: 0.03 }),
  }),
  Object.freeze({
    id: 'local_builder', availableCapital: 120_000, hurdleRate: 0.10, maxLeverage: 0.55,
    financingSpread: 0.035, riskTolerance: 0.55, maxConcurrentProjects: 2, minimumProjectCost: 0,
    preferences: Object.freeze({ residential: 0.05, commercial: 0, industrial: -0.05 }),
  }),
  Object.freeze({
    id: 'urban_developer', availableCapital: 300_000, hurdleRate: 0.11, maxLeverage: 0.65,
    financingSpread: 0.030, riskTolerance: 0.70, maxConcurrentProjects: 3, minimumProjectCost: 0,
    preferences: Object.freeze({ residential: 0.025, commercial: 0.04, industrial: -0.02 }),
  }),
]);

type MutableDeveloperState = {
  id: string;
  availableCapital: number;
  committedCapital: number;
  hurdleRate: number;
  maxLeverage: number;
  financingSpread: number;
  riskTolerance: number;
  maxConcurrentProjects: number;
  minimumProjectCost: number;
  preferences: { residential: number; commercial: number; industrial: number };
};

export type DeveloperMarketOptions = Readonly<{
  developers?: readonly DeveloperSeed[];
}>;

function finite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function validateSeed(seed: DeveloperSeed): void {
  if (!seed.id) throw new Error('developer id is required');
  finite(`${seed.id}.availableCapital`, seed.availableCapital);
  finite(`${seed.id}.hurdleRate`, seed.hurdleRate);
  finite(`${seed.id}.maxLeverage`, seed.maxLeverage);
  finite(`${seed.id}.financingSpread`, seed.financingSpread);
  finite(`${seed.id}.riskTolerance`, seed.riskTolerance);
  finite(`${seed.id}.minimumProjectCost`, seed.minimumProjectCost);
  if (seed.availableCapital < 0) throw new Error(`${seed.id}.availableCapital must be non-negative`);
  if (seed.hurdleRate <= 0) throw new Error(`${seed.id}.hurdleRate must be positive`);
  if (seed.maxLeverage < 0 || seed.maxLeverage >= 1) throw new Error(`${seed.id}.maxLeverage must be within [0, 1)`);
  if (seed.financingSpread < 0) throw new Error(`${seed.id}.financingSpread must be non-negative`);
  if (seed.riskTolerance < 0 || seed.riskTolerance > 1) throw new Error(`${seed.id}.riskTolerance must be within [0, 1]`);
  if (!Number.isInteger(seed.maxConcurrentProjects) || seed.maxConcurrentProjects < 1) {
    throw new Error(`${seed.id}.maxConcurrentProjects must be a positive integer`);
  }
  if (seed.minimumProjectCost < 0) throw new Error(`${seed.id}.minimumProjectCost must be non-negative`);
  for (const zone of ['residential', 'commercial', 'industrial'] as const) {
    finite(`${seed.id}.preferences.${zone}`, seed.preferences[zone]);
  }
}

function cloneDeveloper(state: MutableDeveloperState): DeveloperState {
  return {
    id: state.id,
    availableCapital: state.availableCapital,
    committedCapital: state.committedCapital,
    hurdleRate: state.hurdleRate,
    maxLeverage: state.maxLeverage,
    financingSpread: state.financingSpread,
    riskTolerance: state.riskTolerance,
    maxConcurrentProjects: state.maxConcurrentProjects,
    minimumProjectCost: state.minimumProjectCost,
    preferences: { ...state.preferences },
  };
}

function cloneCommitment(value: DeveloperCommitment): DeveloperCommitment {
  return { ...value };
}

function cloneBid(value: DevelopmentBid): DevelopmentBid {
  return { ...value };
}

function cloneAward(value: DevelopmentAward): DevelopmentAward {
  return { ...value };
}

function bidComparator(a: DevelopmentBid, b: DevelopmentBid): number {
  return b.rankScore - a.rankScore
    || b.expectedReturnMargin - a.expectedReturnMargin
    || b.residualLandValue - a.residualLandValue
    || a.requiredEquity - b.requiredEquity
    || a.lotId.localeCompare(b.lotId)
    || a.definitionId.localeCompare(b.definitionId)
    || (a.physicalCandidateId ?? '').localeCompare(b.physicalCandidateId ?? '')
    || a.developerId.localeCompare(b.developerId);
}

function physicalCandidateIdentity(opportunity: DevelopmentFeasibilityResult): string | undefined {
  const physical = opportunity as Partial<PhysicalDevelopmentFeasibilityResult>;
  return physical.candidateId;
}

function physicalConstructionTicks(opportunity: DevelopmentFeasibilityResult): number | undefined {
  const physical = opportunity as Partial<PhysicalDevelopmentFeasibilityResult>;
  const hasPhysicalState = physical.siteId !== undefined
    || physical.candidateId !== undefined
    || physical.typologyId !== undefined
    || physical.constructionTicks !== undefined;
  if (!hasPhysicalState) return undefined;
  if (physical.siteId !== opportunity.lotId) {
    throw new Error(`physical site id does not match compatibility lot id: ${physical.siteId ?? 'missing'}`);
  }
  if (!physical.candidateId || physical.candidateId.trim().length === 0) {
    throw new Error('physical candidate id is required');
  }
  if (!physical.typologyId || !BUILDING_TYPOLOGY_BY_ID[physical.typologyId]) {
    throw new Error(`unknown physical building typology: ${physical.typologyId ?? 'missing'}`);
  }
  if (!Number.isInteger(physical.constructionTicks) || (physical.constructionTicks ?? 0) <= 0) {
    throw new Error('physical constructionTicks must be a positive integer');
  }
  return physical.constructionTicks;
}

function validateCommitmentDefinition(definitionId: string): void {
  if (BUILDING_DEFINITION_BY_ID[definitionId] || BUILDING_TYPOLOGY_BY_ID[definitionId]) return;
  throw new Error(`unknown development definition: ${definitionId}`);
}

export class DeveloperMarketSystem {
  private readonly developers = new Map<string, MutableDeveloperState>();
  private readonly commitments = new Map<string, DeveloperCommitment>();
  private bids: DevelopmentBid[] = [];
  private awards: DevelopmentAward[] = [];

  constructor(options: DeveloperMarketOptions = {}) {
    const seeds = options.developers ?? DEFAULT_DEVELOPER_SEEDS;
    for (const seed of seeds.slice().sort((a, b) => a.id.localeCompare(b.id))) {
      validateSeed(seed);
      if (this.developers.has(seed.id)) throw new Error(`duplicate developer id: ${seed.id}`);
      this.developers.set(seed.id, {
        ...seed,
        committedCapital: 0,
        preferences: { ...seed.preferences },
      });
    }
  }

  allocate(opportunities: readonly DevelopmentFeasibilityResult[], context: DeveloperMarketContext): DevelopmentAward[] {
    if (!Number.isInteger(context.tick) || context.tick < 0) throw new Error('tick must be a non-negative integer');
    finite('marketInterestRate', context.marketInterestRate);
    if (context.marketInterestRate < 0) throw new Error('marketInterestRate must be non-negative');

    const candidateBids: DevelopmentBid[] = [];
    const constructionTicksByBidId = new Map<string, number>();
    const orderedOpportunities = opportunities
      .filter((item) => item.legal && item.feasible && !this.commitments.has(`building:${item.lotId}`))
      .slice()
      .sort((a, b) => a.lotId.localeCompare(b.lotId)
        || a.definitionId.localeCompare(b.definitionId)
        || (physicalCandidateIdentity(a) ?? '').localeCompare(physicalCandidateIdentity(b) ?? ''));

    for (const opportunity of orderedOpportunities) {
      const physicalTicks = physicalConstructionTicks(opportunity);
      const physicalCandidateId = physicalCandidateIdentity(opportunity);
      let constructionTicks: number;
      if (physicalTicks !== undefined) {
        const legacyDefinition = BUILDING_DEFINITION_BY_ID[opportunity.definitionId];
        if (legacyDefinition && legacyDefinition.zone !== opportunity.zone) continue;
        constructionTicks = physicalTicks;
      } else {
        const definition = getBuildingDefinition(opportunity.definitionId);
        if (definition.zone !== opportunity.zone) continue;
        constructionTicks = definition.constructionTicks;
      }

      for (const developer of [...this.developers.values()].sort((a, b) => a.id.localeCompare(b.id))) {
        const activeProjects = this.activeProjectCount(developer.id);
        if (activeProjects >= developer.maxConcurrentProjects) continue;
        if (opportunity.preFinanceDevelopmentCost < developer.minimumProjectCost) continue;
        if (opportunity.riskScore > developer.riskTolerance) continue;

        const leverage = Math.min(developer.maxLeverage, 0.75);
        const debt = opportunity.preFinanceDevelopmentCost * leverage;
        const requiredEquity = opportunity.preFinanceDevelopmentCost - debt;
        if (requiredEquity > developer.availableCapital) continue;
        const durationYears = constructionTicks / 250;
        const financingCost = debt * (context.marketInterestRate + developer.financingSpread) * durationYears;
        const totalDevelopmentCost = opportunity.preFinanceDevelopmentCost + financingCost;
        const expectedReturn = totalDevelopmentCost > 0
          ? (opportunity.stabilizedValue - totalDevelopmentCost) / totalDevelopmentCost
          : -1;
        if (expectedReturn < developer.hurdleRate) continue;
        const expectedReturnMargin = expectedReturn - developer.hurdleRate;
        const preferenceBonus = developer.preferences[opportunity.zone] ?? 0;
        const capitalEfficiencyBonus = clamp01(1 - requiredEquity / Math.max(1, developer.availableCapital)) * 0.025;
        const residualValueBonus = clamp(opportunity.residualLandValue / Math.max(1, opportunity.landValue), -1, 2) * 0.01;
        const riskPenalty = Math.max(0, opportunity.riskScore - developer.riskTolerance) * 0.10;
        const rankScore = expectedReturnMargin + preferenceBonus + capitalEfficiencyBonus + residualValueBonus - riskPenalty;
        const bidId = physicalCandidateId
          ? `bid:${context.tick}:${opportunity.lotId}:${opportunity.definitionId}:${physicalCandidateId}:${developer.id}`
          : `bid:${context.tick}:${opportunity.lotId}:${opportunity.definitionId}:${developer.id}`;

        candidateBids.push(Object.freeze({
          id: bidId,
          lotId: opportunity.lotId,
          definitionId: opportunity.definitionId,
          ...(physicalCandidateId ? { physicalCandidateId } : {}),
          zone: opportunity.zone,
          developerId: developer.id,
          expectedReturn,
          expectedReturnMargin,
          requiredEquity,
          financingCost,
          totalDevelopmentCost,
          preferenceBonus,
          capitalEfficiencyBonus,
          residualValueBonus,
          riskPenalty,
          rankScore,
          residualLandValue: opportunity.residualLandValue,
        }));
        constructionTicksByBidId.set(bidId, constructionTicks);
      }
    }

    this.bids = candidateBids.slice().sort(bidComparator);
    const awardedLots = new Set<string>();
    const awards: DevelopmentAward[] = [];

    for (const bid of this.bids) {
      if (awardedLots.has(bid.lotId)) continue;
      const developer = this.developers.get(bid.developerId);
      if (!developer) continue;
      if (this.activeProjectCount(developer.id) >= developer.maxConcurrentProjects) continue;
      if (bid.requiredEquity > developer.availableCapital) continue;

      const constructionTicks = constructionTicksByBidId.get(bid.id);
      if (!constructionTicks) throw new Error(`missing construction duration for bid: ${bid.id}`);
      const completionTick = context.tick + constructionTicks;
      const releaseTick = completionTick + 100;
      const awardId = `development:${context.tick}:${bid.lotId}:${bid.definitionId}:${bid.developerId}`;
      const buildingId = `building:${bid.lotId}`;
      if (this.commitments.has(buildingId)) continue;
      const award: DevelopmentAward = Object.freeze({
        ...bid,
        awardId,
        buildingId,
        awardTick: context.tick,
        completionTick,
        releaseTick,
      });

      developer.availableCapital -= bid.requiredEquity;
      developer.committedCapital += bid.requiredEquity;
      const commitment: DeveloperCommitment = Object.freeze({
        awardId,
        buildingId,
        lotId: bid.lotId,
        definitionId: bid.definitionId,
        developerId: bid.developerId,
        equity: bid.requiredEquity,
        awardTick: context.tick,
        completionTick,
        releaseTick,
        expectedReturn: bid.expectedReturn,
      });
      this.commitments.set(buildingId, commitment);
      awards.push(award);
      awardedLots.add(bid.lotId);
    }

    this.awards = awards;
    return this.lastAwards();
  }

  advance(tick: number): void {
    if (!Number.isInteger(tick) || tick < 0) throw new Error('tick must be a non-negative integer');
    const releasable = [...this.commitments.values()]
      .filter((item) => item.releaseTick <= tick)
      .sort((a, b) => a.releaseTick - b.releaseTick || a.buildingId.localeCompare(b.buildingId));
    for (const commitment of releasable) {
      const developer = this.developers.get(commitment.developerId);
      if (!developer) throw new Error(`unknown developer for commitment: ${commitment.developerId}`);
      const realizedReturn = clamp(commitment.expectedReturn, -0.25, 0.35);
      developer.availableCapital += commitment.equity * (1 + realizedReturn);
      developer.committedCapital = Math.max(0, developer.committedCapital - commitment.equity);
      this.commitments.delete(commitment.buildingId);
    }
  }

  cancelProject(buildingId: string, recoveryRatio = 0.50): boolean {
    finite('recoveryRatio', recoveryRatio);
    if (recoveryRatio < 0 || recoveryRatio > 1) throw new Error('recoveryRatio must be within [0, 1]');
    const commitment = this.commitments.get(buildingId);
    if (!commitment) return false;
    const developer = this.developers.get(commitment.developerId);
    if (!developer) throw new Error(`unknown developer for commitment: ${commitment.developerId}`);
    developer.availableCapital += commitment.equity * recoveryRatio;
    developer.committedCapital = Math.max(0, developer.committedCapital - commitment.equity);
    this.commitments.delete(commitment.buildingId);
    return true;
  }

  listDevelopers(): DeveloperState[] {
    return [...this.developers.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(cloneDeveloper);
  }

  getDeveloperState(id: string): DeveloperState | undefined {
    const state = this.developers.get(id);
    return state ? cloneDeveloper(state) : undefined;
  }

  commitmentForBuilding(buildingId: string): DeveloperCommitment | undefined {
    if (typeof buildingId !== 'string' || buildingId.trim().length === 0) throw new Error('buildingId must be non-empty');
    const commitment = this.commitments.get(buildingId);
    return commitment ? cloneCommitment(commitment) : undefined;
  }

  listCommitments(): DeveloperCommitment[] {
    return [...this.commitments.values()]
      .sort((a, b) => a.releaseTick - b.releaseTick || a.buildingId.localeCompare(b.buildingId))
      .map(cloneCommitment);
  }

  lastBids(): DevelopmentBid[] {
    return this.bids.map(cloneBid);
  }

  lastAwards(): DevelopmentAward[] {
    return this.awards.map(cloneAward);
  }

  snapshotState(): DeveloperMarketStateSnapshot {
    return {
      developers: this.listDevelopers(),
      commitments: this.listCommitments(),
    };
  }

  restoreState(snapshot: DeveloperMarketStateSnapshot): void {
    if (!snapshot || typeof snapshot !== 'object') throw new Error('developer market state must be an object');
    if (!Array.isArray(snapshot.developers) || !Array.isArray(snapshot.commitments)) {
      throw new Error('developer market state must contain developers and commitments arrays');
    }

    const nextDevelopers = new Map<string, MutableDeveloperState>();
    for (const raw of snapshot.developers) {
      const seed: DeveloperSeed = {
        id: raw.id,
        availableCapital: raw.availableCapital,
        hurdleRate: raw.hurdleRate,
        maxLeverage: raw.maxLeverage,
        financingSpread: raw.financingSpread,
        riskTolerance: raw.riskTolerance,
        maxConcurrentProjects: raw.maxConcurrentProjects,
        minimumProjectCost: raw.minimumProjectCost,
        preferences: raw.preferences,
      };
      validateSeed(seed);
      finite(`${seed.id}.committedCapital`, raw.committedCapital);
      if (raw.committedCapital < 0) throw new Error(`${seed.id}.committedCapital must be non-negative`);
      if (nextDevelopers.has(seed.id)) throw new Error(`duplicate developer id: ${seed.id}`);
      nextDevelopers.set(seed.id, {
        ...seed,
        committedCapital: raw.committedCapital,
        preferences: { ...seed.preferences },
      });
    }

    const nextCommitments = new Map<string, DeveloperCommitment>();
    const awardIds = new Set<string>();
    const equityByDeveloper = new Map<string, number>();
    for (const raw of snapshot.commitments) {
      if (!raw.awardId || !raw.buildingId || !raw.developerId || !raw.lotId || !raw.definitionId) {
        throw new Error('development commitment identifiers are required');
      }
      if (awardIds.has(raw.awardId)) throw new Error(`duplicate development award: ${raw.awardId}`);
      if (nextCommitments.has(raw.buildingId)) throw new Error(`duplicate development building commitment: ${raw.buildingId}`);
      if (!nextDevelopers.has(raw.developerId)) throw new Error(`unknown development developer: ${raw.developerId}`);
      finite(`${raw.buildingId}.equity`, raw.equity);
      finite(`${raw.buildingId}.expectedReturn`, raw.expectedReturn);
      if (raw.equity < 0) throw new Error(`${raw.buildingId}.equity must be non-negative`);
      for (const [name, value] of [
        ['awardTick', raw.awardTick], ['completionTick', raw.completionTick], ['releaseTick', raw.releaseTick],
      ] as const) {
        if (!Number.isInteger(value) || value < 0) throw new Error(`${raw.buildingId}.${name} must be a non-negative integer`);
      }
      if (raw.completionTick < raw.awardTick || raw.releaseTick < raw.completionTick) {
        throw new Error(`${raw.buildingId} has invalid development commitment timing`);
      }
      validateCommitmentDefinition(raw.definitionId);
      const commitment = Object.freeze({ ...raw });
      nextCommitments.set(raw.buildingId, commitment);
      awardIds.add(raw.awardId);
      equityByDeveloper.set(raw.developerId, (equityByDeveloper.get(raw.developerId) ?? 0) + raw.equity);
    }

    for (const developer of nextDevelopers.values()) {
      const expected = equityByDeveloper.get(developer.id) ?? 0;
      if (Math.abs(expected - developer.committedCapital) > 1e-6) {
        throw new Error(`${developer.id}.committedCapital does not match active commitments`);
      }
    }

    this.developers.clear();
    for (const [id, developer] of nextDevelopers) this.developers.set(id, developer);
    this.commitments.clear();
    for (const [id, commitment] of nextCommitments) this.commitments.set(id, commitment);
    this.bids = [];
    this.awards = [];
  }

  private activeProjectCount(developerId: string): number {
    let count = 0;
    for (const commitment of this.commitments.values()) if (commitment.developerId === developerId) count += 1;
    return count;
  }
}
