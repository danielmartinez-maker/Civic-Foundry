import {
  MovementAwarePathfindingSystem,
  type MovementPathfindingDiagnostics,
  type MovementRouteResult,
} from "./MovementAwarePathfindingSystem.ts";
import type { RoutingArc, RoutingTopology } from "./RoutingTopology.ts";
import type {
  CarriagewayId,
  JunctionId,
  TurnMovementId,
  VehiclePermissionMask,
} from "./TransportNetworkTypes.ts";

export type DynamicRoutingStateInput = Readonly<{
  travelTimeTicksByCarriageway?: Readonly<Record<CarriagewayId, number>>;
  congestionPenaltyTicksByCarriageway?: Readonly<Record<CarriagewayId, number>>;
  incidentPenaltyTicksByCarriageway?: Readonly<Record<CarriagewayId, number>>;
  blockedCarriagewayIds?: readonly CarriagewayId[];
  blockedMovementIds?: readonly TurnMovementId[];
}>;

export type DynamicRoutingSnapshot = Readonly<{
  costEpoch: number;
  state: Readonly<{
    travelTimeTicksByCarriageway: Readonly<Record<CarriagewayId, number>>;
    congestionPenaltyTicksByCarriageway: Readonly<
      Record<CarriagewayId, number>
    >;
    incidentPenaltyTicksByCarriageway: Readonly<Record<CarriagewayId, number>>;
    blockedCarriagewayIds: readonly CarriagewayId[];
    blockedMovementIds: readonly TurnMovementId[];
  }>;
}>;

export type DynamicRouteOptions = Readonly<{
  permissions: VehiclePermissionMask;
  destinationAccessible: boolean;
}>;

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be finite and non-negative`);
  }
  return value;
}

function canonicalRecord(
  input: Readonly<Record<string, number>> | undefined,
  label: string,
): Readonly<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const key of Object.keys(input ?? {}).sort()) {
    if (key.length === 0) throw new Error(`${label} contains an empty id`);
    result[key] = finiteNonNegative(input?.[key] ?? 0, `${label}.${key}`);
  }
  return Object.freeze(result);
}

function canonicalIds(
  input: readonly string[] | undefined,
  label: string,
): readonly string[] {
  const ids = [...new Set(input ?? [])].sort();
  if (ids.some((id) => id.length === 0))
    throw new Error(`${label} contains an empty id`);
  return Object.freeze(ids);
}

function canonicalState(
  input: DynamicRoutingStateInput,
): DynamicRoutingSnapshot["state"] {
  return Object.freeze({
    travelTimeTicksByCarriageway: canonicalRecord(
      input.travelTimeTicksByCarriageway,
      "travelTimeTicksByCarriageway",
    ),
    congestionPenaltyTicksByCarriageway: canonicalRecord(
      input.congestionPenaltyTicksByCarriageway,
      "congestionPenaltyTicksByCarriageway",
    ),
    incidentPenaltyTicksByCarriageway: canonicalRecord(
      input.incidentPenaltyTicksByCarriageway,
      "incidentPenaltyTicksByCarriageway",
    ),
    blockedCarriagewayIds: canonicalIds(
      input.blockedCarriagewayIds,
      "blockedCarriagewayIds",
    ),
    blockedMovementIds: canonicalIds(
      input.blockedMovementIds,
      "blockedMovementIds",
    ),
  });
}

function stateSignature(state: DynamicRoutingSnapshot["state"]): string {
  return JSON.stringify(state);
}

export class DynamicRoutingSystem {
  private readonly pathfinding = new MovementAwarePathfindingSystem();
  private currentState = canonicalState({});
  private signature = stateSignature(this.currentState);
  private epoch = 0;

  get costEpoch(): number {
    return this.epoch;
  }

  get diagnostics(): MovementPathfindingDiagnostics {
    return this.pathfinding.diagnostics;
  }

  updateState(input: DynamicRoutingStateInput): number {
    const next = canonicalState(input);
    const nextSignature = stateSignature(next);
    if (nextSignature !== this.signature) {
      this.currentState = next;
      this.signature = nextSignature;
      this.epoch++;
    }
    return this.epoch;
  }

  findRoute(
    topology: RoutingTopology,
    startJunctionId: JunctionId,
    endJunctionId: JunctionId,
    options: DynamicRouteOptions,
  ): MovementRouteResult | null {
    if (!options.destinationAccessible) return null;

    const blockedCarriageways = new Set(
      this.currentState.blockedCarriagewayIds,
    );
    const blockedMovements = new Set(this.currentState.blockedMovementIds);
    const arcCost = (arc: RoutingArc): number => {
      if (blockedCarriageways.has(arc.carriagewayId)) return Number.NaN;
      if (arc.movementId && blockedMovements.has(arc.movementId))
        return Number.NaN;

      const travelTime =
        this.currentState.travelTimeTicksByCarriageway[arc.carriagewayId] ??
        arc.traversalTicks;
      const congestion =
        this.currentState.congestionPenaltyTicksByCarriageway[
          arc.carriagewayId
        ] ?? 0;
      const incident =
        this.currentState.incidentPenaltyTicksByCarriageway[
          arc.carriagewayId
        ] ?? 0;
      return travelTime + congestion + incident + arc.movementPenaltyTicks;
    };

    return this.pathfinding.findRoute(
      topology,
      startJunctionId,
      endJunctionId,
      {
        permissions: options.permissions,
        costEpoch: this.epoch,
        costKey: `dynamic:${this.epoch}`,
        arcCost,
      },
    );
  }

  snapshot(): DynamicRoutingSnapshot {
    return Object.freeze({ costEpoch: this.epoch, state: this.currentState });
  }

  restore(snapshot: DynamicRoutingSnapshot): void {
    if (!Number.isSafeInteger(snapshot.costEpoch) || snapshot.costEpoch < 0) {
      throw new Error(
        "dynamic routing costEpoch must be a non-negative safe integer",
      );
    }
    const state = canonicalState(snapshot.state);
    this.currentState = state;
    this.signature = stateSignature(state);
    this.epoch = snapshot.costEpoch;
    this.pathfinding.clearCache();
  }
}
