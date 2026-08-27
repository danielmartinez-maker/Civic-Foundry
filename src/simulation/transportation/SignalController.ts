import type {
  IntersectionControlPolicy,
  MovementServiceState,
  SignalPhase,
  SignalRuntimeState,
  SignalTimingPlan,
} from './IntersectionControlTypes.ts';
import type {
  JunctionId,
  TurnMovement,
  TurnMovementId,
} from './TransportNetworkTypes.ts';

export type SignalRuntimeMode = 'green' | 'yellow' | 'allRed';

export type SignalMovementContext = Readonly<{
  stoppedTicks?: number;
  pedestrianConflictOccupied?: boolean;
}>;

type LocatedSignalState = Readonly<{
  phase: SignalPhase;
  phaseElapsedTicks: number;
  mode: SignalRuntimeMode;
}>;

function requireFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be finite and non-negative`);
  }
}

function requireIntegerNonNegative(value: number, name: string): void {
  requireFiniteNonNegative(value, name);
  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be an integer`);
  }
}

function normalizeCyclePosition(value: number, cycleTicks: number): number {
  return ((value % cycleTicks) + cycleTicks) % cycleTicks;
}

function phaseDuration(phase: SignalPhase): number {
  return phase.greenTicks + phase.yellowTicks + phase.allRedTicks;
}

// Executes immutable fixed-time plans only. Coordination and priority/preemption
// remain separate layers so this controller never becomes a second planning authority.
export class SignalController {
  private readonly movementsById = new Map<TurnMovementId, TurnMovement>();
  private readonly junctionId: JunctionId;
  private readonly plan: SignalTimingPlan;
  private readonly policy: IntersectionControlPolicy;
  private cyclePositionTicks: number;

  constructor(
    junctionId: JunctionId,
    plan: SignalTimingPlan,
    movements: readonly TurnMovement[],
    policy: IntersectionControlPolicy,
  ) {
    this.junctionId = junctionId;
    this.plan = plan;
    this.policy = policy;
    if (junctionId.length === 0) throw new Error('junctionId must not be empty');
    requireIntegerNonNegative(plan.cycleTicks, 'cycleTicks');
    if (plan.cycleTicks <= 0) throw new Error('cycleTicks must be greater than zero');
    requireIntegerNonNegative(plan.offsetTicks, 'offsetTicks');
    requireFiniteNonNegative(policy.minimumStopTicks, 'minimumStopTicks');
    if (plan.phases.length === 0) throw new Error('signal plan requires at least one phase');

    const phaseIds = new Set<string>();
    let computedCycleTicks = 0;
    for (const phase of plan.phases) {
      if (phase.id.length === 0) throw new Error('signal phase id must not be empty');
      if (phaseIds.has(phase.id)) throw new Error(`duplicate signal phase ${phase.id}`);
      phaseIds.add(phase.id);
      requireIntegerNonNegative(phase.greenTicks, `greenTicks ${phase.id}`);
      requireIntegerNonNegative(phase.yellowTicks, `yellowTicks ${phase.id}`);
      requireIntegerNonNegative(phase.allRedTicks, `allRedTicks ${phase.id}`);
      if (phase.greenTicks <= 0) throw new Error(`greenTicks ${phase.id} must be greater than zero`);
      computedCycleTicks += phaseDuration(phase);
    }
    if (computedCycleTicks !== plan.cycleTicks) {
      throw new Error(`signal cycle duration ${computedCycleTicks} does not match cycleTicks ${plan.cycleTicks}`);
    }

    for (const movement of movements) {
      if (movement.junctionId !== junctionId) {
        throw new Error(`movement ${movement.id} belongs to another junction`);
      }
      if (this.movementsById.has(movement.id)) throw new Error(`duplicate movement ${movement.id}`);
      this.movementsById.set(movement.id, movement);
    }

    for (const phase of plan.phases) {
      const protectedSet = new Set<TurnMovementId>();
      for (const movementId of phase.protectedMovementIds) {
        const movement = this.movementsById.get(movementId);
        if (!movement) throw new Error(`unknown protected movement ${movementId}`);
        if (!movement.allowed) throw new Error(`protected movement ${movementId} is not allowed`);
        if (protectedSet.has(movementId)) throw new Error(`duplicate protected movement ${movementId}`);
        protectedSet.add(movementId);
      }
      const permissiveSet = new Set<TurnMovementId>();
      for (const movementId of phase.permissiveMovementIds) {
        const movement = this.movementsById.get(movementId);
        if (!movement) throw new Error(`unknown permissive movement ${movementId}`);
        if (!movement.allowed) throw new Error(`permissive movement ${movementId} is not allowed`);
        if (permissiveSet.has(movementId)) throw new Error(`duplicate permissive movement ${movementId}`);
        if (protectedSet.has(movementId)) {
          throw new Error(`movement ${movementId} cannot be protected and permissive in one phase`);
        }
        permissiveSet.add(movementId);
      }
    }

    this.cyclePositionTicks = normalizeCyclePosition(plan.offsetTicks, plan.cycleTicks);
  }

  private locate(position = this.cyclePositionTicks): LocatedSignalState {
    let start = 0;
    for (const phase of this.plan.phases) {
      const duration = phaseDuration(phase);
      if (position < start + duration) {
        const phaseElapsedTicks = position - start;
        const mode: SignalRuntimeMode = phaseElapsedTicks < phase.greenTicks
          ? 'green'
          : phaseElapsedTicks < phase.greenTicks + phase.yellowTicks
            ? 'yellow'
            : 'allRed';
        return Object.freeze({ phase, phaseElapsedTicks, mode });
      }
      start += duration;
    }
    throw new Error(`cycle position ${position} is outside signal plan`);
  }

  runtimeMode(): SignalRuntimeMode {
    return this.locate().mode;
  }

  activePhase(): SignalPhase {
    return this.locate().phase;
  }

  serviceStateFor(
    movementId: TurnMovementId,
    context: SignalMovementContext = {},
  ): MovementServiceState {
    const movement = this.movementsById.get(movementId);
    if (!movement) throw new Error(`unknown signal movement ${movementId}`);
    if (!movement.allowed) return 'prohibited';

    if (context.stoppedTicks !== undefined) {
      requireFiniteNonNegative(context.stoppedTicks, 'stoppedTicks');
    }

    const located = this.locate();
    if (located.mode !== 'green') return 'clearance';

    if (located.phase.protectedMovementIds.includes(movementId)) {
      return context.pedestrianConflictOccupied === true ? 'clearance' : 'protected';
    }
    if (located.phase.permissiveMovementIds.includes(movementId)) {
      return context.pedestrianConflictOccupied === true ? 'clearance' : 'permissive';
    }

    if (movement.turnKind !== 'right' || !this.policy.rightTurnOnRed) {
      return 'prohibited';
    }
    if (context.pedestrianConflictOccupied === true) return 'stop';

    const stoppedTicks = context.stoppedTicks ?? 0;
    return stoppedTicks < this.policy.minimumStopTicks ? 'stop' : 'yield';
  }

  step(ticks = 1): void {
    requireIntegerNonNegative(ticks, 'ticks');
    this.cyclePositionTicks = normalizeCyclePosition(
      this.cyclePositionTicks + ticks,
      this.plan.cycleTicks,
    );
  }

  snapshot(): SignalRuntimeState {
    const located = this.locate();
    return Object.freeze({
      junctionId: this.junctionId,
      phaseId: located.phase.id,
      phaseElapsedTicks: located.phaseElapsedTicks,
      cyclePositionTicks: this.cyclePositionTicks,
    });
  }

  restore(snapshot: SignalRuntimeState): void {
    if (snapshot.junctionId !== this.junctionId) {
      throw new Error(`signal runtime belongs to ${snapshot.junctionId}, expected ${this.junctionId}`);
    }
    requireIntegerNonNegative(snapshot.cyclePositionTicks, 'cyclePositionTicks');
    if (snapshot.cyclePositionTicks >= this.plan.cycleTicks) {
      throw new Error('cyclePositionTicks is outside signal cycle');
    }
    requireIntegerNonNegative(snapshot.phaseElapsedTicks, 'phaseElapsedTicks');

    const located = this.locate(snapshot.cyclePositionTicks);
    if (snapshot.phaseId !== located.phase.id) {
      throw new Error(`signal phase ${snapshot.phaseId} does not match cycle position`);
    }
    if (snapshot.phaseElapsedTicks !== located.phaseElapsedTicks) {
      throw new Error('signal phase elapsed ticks do not match cycle position');
    }

    this.cyclePositionTicks = snapshot.cyclePositionTicks;
  }
}
