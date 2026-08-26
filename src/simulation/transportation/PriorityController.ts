import type {
  IntersectionPriorityRequest,
} from './IntersectionControlTypes.ts';
import type { TurnMovementId } from './TransportNetworkTypes.ts';

export const MAX_TRANSIT_PRIORITY_TICKS = 20;

export type PriorityDecisionContext = Readonly<{
  activeMovementIds: ReadonlySet<TurnMovementId>;
  conflicts(a: TurnMovementId, b: TurnMovementId): boolean;
  clearanceComplete: boolean;
  requestedMovementIsActivePhase?: boolean;
  ticksUntilRequestedPhase?: number;
}>;

export type PriorityDecision = Readonly<{
  action: 'none' | 'transition' | 'grant' | 'transitAdjust';
  request?: IntersectionPriorityRequest;
  advanceTicks?: number;
  extendTicks?: number;
}>;

const REQUEST_KINDS = new Set<IntersectionPriorityRequest['kind']>([
  'emergencyPreemption',
  'transitPriority',
]);

function requireNonEmpty(value: string, name: string): void {
  if (value.length === 0) throw new Error(`${name} must not be empty`);
}

function requireIntegerNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function validateRequest(request: IntersectionPriorityRequest): void {
  requireNonEmpty(request.id, 'priority request id');
  requireNonEmpty(request.junctionId, 'priority request junctionId');
  requireNonEmpty(request.movementId, 'priority request movementId');
  if (!REQUEST_KINDS.has(request.kind)) {
    throw new Error(`invalid priority request kind ${String(request.kind)}`);
  }
  requireIntegerNonNegative(request.requestedTick, 'priority request requestedTick');
  requireIntegerNonNegative(request.expiresTick, 'priority request expiresTick');
  if (request.expiresTick < request.requestedTick) {
    throw new Error('priority request expiresTick must not precede requestedTick');
  }
}

function cloneRequest(request: IntersectionPriorityRequest): IntersectionPriorityRequest {
  return Object.freeze({
    id: request.id,
    junctionId: request.junctionId,
    movementId: request.movementId,
    kind: request.kind,
    requestedTick: request.requestedTick,
    expiresTick: request.expiresTick,
  });
}

function requestRank(kind: IntersectionPriorityRequest['kind']): number {
  return kind === 'emergencyPreemption' ? 0 : 1;
}

function compareRequests(a: IntersectionPriorityRequest, b: IntersectionPriorityRequest): number {
  return requestRank(a.kind) - requestRank(b.kind)
    || a.requestedTick - b.requestedTick
    || a.id.localeCompare(b.id);
}

function none(): PriorityDecision {
  return Object.freeze({ action: 'none' });
}

export class PriorityController {
  private readonly requestsById = new Map<string, IntersectionPriorityRequest>();

  submit(request: IntersectionPriorityRequest): void {
    validateRequest(request);
    this.requestsById.set(request.id, cloneRequest(request));
  }

  remove(requestId: string): void {
    this.requestsById.delete(requestId);
  }

  private purgeExpired(tick: number): void {
    requireIntegerNonNegative(tick, 'tick');
    for (const [requestId, request] of this.requestsById) {
      if (tick > request.expiresTick) this.requestsById.delete(requestId);
    }
  }

  select(tick: number): IntersectionPriorityRequest | undefined {
    this.purgeExpired(tick);
    return [...this.requestsById.values()].sort(compareRequests)[0];
  }

  decide(tick: number, context: PriorityDecisionContext): PriorityDecision {
    const selected = this.select(tick);
    if (!selected) return none();

    const conflictingActive = [...context.activeMovementIds].some(
      (movementId) => context.conflicts(selected.movementId, movementId),
    );

    if (selected.kind === 'emergencyPreemption') {
      if (conflictingActive || (context.activeMovementIds.size === 0 && !context.clearanceComplete)) {
        return Object.freeze({ action: 'transition', request: selected });
      }
      return Object.freeze({ action: 'grant', request: selected });
    }

    if (conflictingActive) return none();

    if (context.requestedMovementIsActivePhase === true) {
      return Object.freeze({
        action: 'transitAdjust',
        request: selected,
        advanceTicks: 0,
        extendTicks: MAX_TRANSIT_PRIORITY_TICKS,
      });
    }

    const ticksUntilRequestedPhase = context.ticksUntilRequestedPhase ?? 0;
    requireIntegerNonNegative(ticksUntilRequestedPhase, 'ticksUntilRequestedPhase');
    if (ticksUntilRequestedPhase === 0) return none();
    return Object.freeze({
      action: 'transitAdjust',
      request: selected,
      advanceTicks: Math.min(MAX_TRANSIT_PRIORITY_TICKS, ticksUntilRequestedPhase),
      extendTicks: 0,
    });
  }

  snapshot(): readonly IntersectionPriorityRequest[] {
    return Object.freeze([...this.requestsById.values()]
      .map((request) => cloneRequest(request))
      .sort(compareRequests));
  }

  restore(snapshot: readonly IntersectionPriorityRequest[]): void {
    const next = new Map<string, IntersectionPriorityRequest>();
    for (const request of snapshot) {
      validateRequest(request);
      if (next.has(request.id)) throw new Error(`duplicate priority request ${request.id}`);
      next.set(request.id, cloneRequest(request));
    }

    this.requestsById.clear();
    for (const request of [...next.values()].sort(compareRequests)) {
      this.requestsById.set(request.id, request);
    }
  }
}
