import type { TransportationEdge, TransportationGraph } from '../traffic/TransportationGraph.ts';
import type { PathfindingSystem, RouteResult } from '../traffic/PathfindingSystem.ts';
import type { TransitNetworkSystem } from '../transit/TransitNetworkSystem.ts';
import type { MultimodalRoutingGraph } from '../transit/MultimodalRoutingGraph.ts';
import type { JourneyPlanner } from '../transit/JourneyPlanner.ts';
import type { PassengerQueueSystem } from '../transit/PassengerQueueSystem.ts';
import type {
  MobilityAlternative,
  MobilityJourneyRequest,
  MobilityModeId,
} from './MobilityTypes.ts';

export type MobilityRuntimeContext = Readonly<{
  tick: number;
  costEpoch: number;
  roadGraph: TransportationGraph;
  transit: TransitNetworkSystem;
  pathfinding: PathfindingSystem;
  roadTravelTime: (edge: TransportationEdge) => number;
  multimodalGraph: MultimodalRoutingGraph;
  journeyPlanner: JourneyPlanner;
  passengers: PassengerQueueSystem;
  crowdingPenaltyTicks: number;
  submitLegacyCarTrip: (sourceTripId: string, travelerWeight: number, route: RouteResult) => void;
}>;

export interface MobilityAlternativeProvider {
  readonly id: string;
  readonly priority: number;
  readonly modes: readonly MobilityModeId[];
  buildAlternatives(request: MobilityJourneyRequest, context: MobilityRuntimeContext): readonly MobilityAlternative[];
  execute(alternative: MobilityAlternative, request: MobilityJourneyRequest, context: MobilityRuntimeContext): boolean;
}

export class MobilityProviderRegistry {
  private readonly providers = new Map<string, MobilityAlternativeProvider>();
  private readonly modeOwners = new Map<MobilityModeId, string>();

  constructor(providers: readonly MobilityAlternativeProvider[] = []) {
    for (const provider of providers) this.register(provider);
  }

  register(provider: MobilityAlternativeProvider): void {
    if (!provider.id.trim()) throw new Error('mobility provider id is required');
    if (!Number.isFinite(provider.priority)) throw new Error(`invalid mobility provider priority: ${provider.id}`);
    if (this.providers.has(provider.id)) throw new Error(`duplicate provider: ${provider.id}`);
    if (provider.modes.length === 0) throw new Error(`mobility provider must own at least one mode: ${provider.id}`);
    if (new Set(provider.modes).size !== provider.modes.length) throw new Error(`duplicate provider mode: ${provider.id}`);

    for (const mode of provider.modes) {
      const owner = this.modeOwners.get(mode);
      if (owner) throw new Error(`mobility mode ${mode} already owned by provider ${owner}`);
    }

    this.providers.set(provider.id, provider);
    for (const mode of provider.modes) this.modeOwners.set(mode, provider.id);
  }

  get(id: string): MobilityAlternativeProvider | undefined {
    return this.providers.get(id);
  }

  list(): readonly MobilityAlternativeProvider[] {
    return Object.freeze([...this.providers.values()].sort((a, b) =>
      a.priority - b.priority || a.id.localeCompare(b.id)));
  }
}
