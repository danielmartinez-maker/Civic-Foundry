import {
  validateIntersectionPolicy,
  type IntersectionControlPolicy,
  type PedestrianCrossing,
  type PedestrianCrossingId,
  type PedestrianInterval,
  type PedestrianRuntimeState,
} from './IntersectionControlTypes.ts';

export type PedestrianStepInput = Readonly<{
  walkCrossingIds: ReadonlySet<PedestrianCrossingId>;
  demandByCrossing: Readonly<Record<string, number>>;
}>;

type MutablePedestrianState = {
  crossingId: PedestrianCrossingId;
  interval: PedestrianInterval;
  elapsedTicks: number;
  occupancyWeight: number;
};

const EPSILON = 1e-9;
const PEDESTRIAN_INTERVALS = new Set<PedestrianInterval>(['hold', 'walk', 'change', 'clearance']);

function requireFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be finite and non-negative`);
  }
}

function requirePositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be finite and greater than zero`);
  }
}

function cloneState(state: MutablePedestrianState): PedestrianRuntimeState {
  return Object.freeze({
    crossingId: state.crossingId,
    interval: state.interval,
    elapsedTicks: state.elapsedTicks,
    occupancyWeight: state.occupancyWeight,
  });
}

export function crossingClearanceTicks(
  crossingLengthMeters: number,
  policy: IntersectionControlPolicy,
): number {
  requirePositiveFinite(crossingLengthMeters, 'crossingLengthMeters');
  requirePositiveFinite(policy.pedestrianWalkingSpeedMps, 'pedestrianWalkingSpeedMps');
  return Math.ceil((crossingLengthMeters / policy.pedestrianWalkingSpeedMps) * 10);
}

export class PedestrianController {
  private readonly crossingsById = new Map<PedestrianCrossingId, PedestrianCrossing>();
  private readonly statesById = new Map<PedestrianCrossingId, MutablePedestrianState>();
  private readonly policy: IntersectionControlPolicy;

  constructor(
    crossings: readonly PedestrianCrossing[],
    policy: IntersectionControlPolicy,
  ) {
    validateIntersectionPolicy(policy);
    requirePositiveFinite(policy.pedestrianWalkingSpeedMps, 'pedestrianWalkingSpeedMps');
    this.policy = policy;

    for (const crossing of [...crossings].sort((a, b) => a.id.localeCompare(b.id))) {
      if (this.crossingsById.has(crossing.id)) {
        throw new Error(`duplicate pedestrian crossing ${crossing.id}`);
      }
      requirePositiveFinite(crossing.crossingLengthMeters, `crossingLengthMeters ${crossing.id}`);
      this.crossingsById.set(crossing.id, crossing);
      this.statesById.set(crossing.id, {
        crossingId: crossing.id,
        interval: 'hold',
        elapsedTicks: 0,
        occupancyWeight: 0,
      });
    }
  }

  step(input: PedestrianStepInput): void {
    for (const crossingId of input.walkCrossingIds) {
      if (!this.crossingsById.has(crossingId)) {
        throw new Error(`unknown pedestrian crossing ${crossingId}`);
      }
    }
    for (const [crossingId, demand] of Object.entries(input.demandByCrossing)) {
      if (!this.crossingsById.has(crossingId)) {
        throw new Error(`unknown pedestrian crossing demand ${crossingId}`);
      }
      requireFiniteNonNegative(demand, `pedestrian demand ${crossingId}`);
    }

    for (const crossingId of [...this.crossingsById.keys()].sort((a, b) => a.localeCompare(b))) {
      const crossing = this.crossingsById.get(crossingId);
      const current = this.statesById.get(crossingId);
      if (!crossing || !current) continue;

      const walk = input.walkCrossingIds.has(crossingId);
      const demand = input.demandByCrossing[crossingId] ?? 0;
      if (walk) {
        current.interval = 'walk';
        current.elapsedTicks = current.interval === 'walk' ? current.elapsedTicks + 1 : 1;
        current.occupancyWeight += demand;
        continue;
      }

      if (current.interval === 'walk') {
        if (current.occupancyWeight > EPSILON) {
          current.interval = 'change';
          current.elapsedTicks = 1;
        } else {
          current.interval = 'hold';
          current.elapsedTicks = 1;
          current.occupancyWeight = 0;
        }
        continue;
      }

      if (current.interval === 'change' || current.interval === 'clearance') {
        if (current.occupancyWeight <= EPSILON) {
          current.interval = 'hold';
          current.elapsedTicks = 1;
          current.occupancyWeight = 0;
          continue;
        }
        const clearanceTicks = crossingClearanceTicks(crossing.crossingLengthMeters, this.policy);
        if (current.elapsedTicks < clearanceTicks) {
          current.interval = 'clearance';
          current.elapsedTicks += 1;
        } else {
          current.interval = 'hold';
          current.elapsedTicks = 1;
          current.occupancyWeight = 0;
        }
        continue;
      }

      current.elapsedTicks += 1;
      current.occupancyWeight = 0;
    }
  }

  stateFor(crossingId: PedestrianCrossingId): PedestrianRuntimeState | undefined {
    const state = this.statesById.get(crossingId);
    return state === undefined ? undefined : cloneState(state);
  }

  isOccupied(crossingId: PedestrianCrossingId): boolean {
    return (this.statesById.get(crossingId)?.occupancyWeight ?? 0) > EPSILON;
  }

  activeCrossingIds(): readonly PedestrianCrossingId[] {
    return Object.freeze([...this.statesById.values()]
      .filter((state) => state.occupancyWeight > EPSILON)
      .map((state) => state.crossingId)
      .sort((a, b) => a.localeCompare(b)));
  }

  snapshot(): readonly PedestrianRuntimeState[] {
    return Object.freeze([...this.statesById.values()]
      .map((state) => cloneState(state))
      .sort((a, b) => a.crossingId.localeCompare(b.crossingId)));
  }

  restore(snapshot: readonly PedestrianRuntimeState[]): void {
    if (snapshot.length !== this.crossingsById.size) {
      throw new Error('pedestrian runtime snapshot must contain exactly one state per crossing');
    }

    const next = new Map<PedestrianCrossingId, MutablePedestrianState>();
    for (const state of snapshot) {
      const crossing = this.crossingsById.get(state.crossingId);
      if (!crossing) throw new Error(`unknown pedestrian crossing ${state.crossingId}`);
      if (next.has(state.crossingId)) throw new Error(`duplicate pedestrian crossing state ${state.crossingId}`);
      if (!PEDESTRIAN_INTERVALS.has(state.interval)) {
        throw new Error(`invalid pedestrian interval ${String(state.interval)}`);
      }
      requireFiniteNonNegative(state.elapsedTicks, `elapsedTicks ${state.crossingId}`);
      if (!Number.isInteger(state.elapsedTicks)) {
        throw new Error(`elapsedTicks ${state.crossingId} must be an integer`);
      }
      requireFiniteNonNegative(state.occupancyWeight, `occupancyWeight ${state.crossingId}`);
      if (state.interval === 'hold' && state.occupancyWeight > EPSILON) {
        throw new Error(`hold pedestrian state ${state.crossingId} cannot be occupied`);
      }
      if (state.interval === 'change' || state.interval === 'clearance') {
        if (state.occupancyWeight <= EPSILON) {
          throw new Error(`${state.interval} pedestrian state ${state.crossingId} requires occupancy`);
        }
        const clearanceTicks = crossingClearanceTicks(crossing.crossingLengthMeters, this.policy);
        if (state.elapsedTicks < 1 || state.elapsedTicks > clearanceTicks) {
          throw new Error(`pedestrian clearance elapsedTicks ${state.crossingId} is out of range`);
        }
      }

      next.set(state.crossingId, {
        crossingId: state.crossingId,
        interval: state.interval,
        elapsedTicks: state.elapsedTicks,
        occupancyWeight: state.occupancyWeight,
      });
    }

    this.statesById.clear();
    for (const crossingId of [...next.keys()].sort((a, b) => a.localeCompare(b))) {
      const state = next.get(crossingId);
      if (state) this.statesById.set(crossingId, state);
    }
  }
}
