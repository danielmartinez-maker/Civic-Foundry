import {
  IntersectionSystem,
  type IntersectionQueueEntry,
  type IntersectionSnapshot,
} from "../traffic/IntersectionSystem.ts";
import type { TransportationGraph } from "../traffic/TransportationGraph.ts";
import type {
  IntersectionControlSnapshot,
  MovementQueueEntry,
} from "./IntersectionControlSystem.ts";
import { Transportation3RRuntime } from "./Transportation3RRuntime.ts";
import type { JunctionId, TurnMovementId } from "./TransportNetworkTypes.ts";

export type QueuedOutgoingEdgeResolver = (
  vehicleId: string,
  nodeId: string,
  incomingEdgeId: string,
) => string | undefined;

export class MovementAwareIntersectionAdapter extends IntersectionSystem {
  private refreshNetwork: (() => void) | undefined;
  private resolveQueuedOutgoingEdge: QueuedOutgoingEdgeResolver | undefined;

  constructor(private readonly runtime: Transportation3RRuntime) {
    super();
  }

  setNetworkRefresher(refreshNetwork: () => void): void {
    this.refreshNetwork = refreshNetwork;
  }

  setQueuedOutgoingEdgeResolver(resolver: QueuedOutgoingEdgeResolver): void {
    this.resolveQueuedOutgoingEdge = resolver;
  }

  override enqueue(
    nodeId: string,
    incomingEdgeId: string,
    entry: IntersectionQueueEntry,
    outgoingEdgeId?: string,
  ): void {
    if (entry.released) throw new Error("released intersection entries are snapshot-only");
    this.refreshNetwork?.();
    const movementId = this.resolveMovement(
      nodeId,
      incomingEdgeId,
      outgoingEdgeId ?? this.resolveQueuedOutgoingEdge?.(entry.vehicleId, nodeId, incomingEdgeId),
    );
    this.runtime.intersections.enqueue(movementId, this.toMovementEntry(entry));
  }

  override stepNode(
    _graph: TransportationGraph,
    nodeId: string,
    tick = 0,
  ): string[] {
    this.refreshNetwork?.();
    const junctionId = this.runtime.junctionIdForLegacyNode(nodeId);
    if (!junctionId) return [];
    return this.runtime.intersections.stepJunction(junctionId, tick, {
      capacityMultiplierBySegment: this.runtime.incidentCapacityMultipliers(),
    });
  }

  override removeVehicle(vehicleId: string): void {
    this.runtime.intersections.removeVehicle(vehicleId);
  }

  override queueLength(nodeId?: string): number {
    if (nodeId === undefined) return this.runtime.intersections.queueLength();
    this.refreshNetwork?.();
    const junctionId = this.runtime.junctionIdForLegacyNode(nodeId);
    return junctionId ? this.runtime.intersections.queueLength(junctionId) : 0;
  }

  override snapshot(): IntersectionSnapshot {
    this.refreshNetwork?.();
    const snapshot = this.runtime.intersections.snapshot();
    const result = new Map<
      string,
      Map<string, IntersectionQueueEntry[]>
    >();
    const append = (
      junctionId: JunctionId,
      movementId: TurnMovementId,
      entry: IntersectionQueueEntry,
    ): void => {
      const movement = this.runtime
        .networkSnapshot()
        .movements.find((candidate) => candidate.id === movementId);
      if (!movement || movement.junctionId !== junctionId) return;
      const nodeId = this.runtime.legacyNodeIdForJunction(junctionId);
      const incomingEdgeId = this.runtime.legacyEdgeIdForCarriageway(
        movement.fromCarriagewayId,
      );
      if (!nodeId || !incomingEdgeId) return;
      const approaches = result.get(nodeId) ?? new Map<string, IntersectionQueueEntry[]>();
      const entries = approaches.get(incomingEdgeId) ?? [];
      entries.push(Object.freeze({ ...entry }));
      approaches.set(incomingEdgeId, entries);
      result.set(nodeId, approaches);
    };

    for (const queue of snapshot.queues) {
      const movement = this.runtime
        .networkSnapshot()
        .movements.find((candidate) => candidate.id === queue.movementId);
      if (!movement) continue;
      for (const entry of queue.entries) append(movement.junctionId, queue.movementId, entry);
    }
    for (const pending of snapshot.pendingReleased) {
      for (const release of pending.releases) {
        append(pending.junctionId, release.movementId, {
          vehicleId: release.vehicleId,
          travelerWeight: 0,
          queuedTick: 0,
          priority: "normal",
          released: true,
        });
      }
    }

    return Object.freeze(
      Object.fromEntries(
        [...result.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([nodeId, approaches]) => [
            nodeId,
            Object.freeze(
              [...approaches.entries()]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([incomingEdgeId, entries]) =>
                  Object.freeze({
                    incomingEdgeId,
                    entries: Object.freeze(
                      [...entries].sort(
                        (a, b) =>
                          Number(Boolean(a.released)) - Number(Boolean(b.released)) ||
                          (a.priority === "emergency" ? 0 : 1) -
                            (b.priority === "emergency" ? 0 : 1) ||
                          a.queuedTick - b.queuedTick ||
                          a.vehicleId.localeCompare(b.vehicleId),
                      ),
                    ),
                  }),
                ),
            ),
          ]),
      ),
    );
  }

  override restore(snapshot: IntersectionSnapshot): void {
    this.refreshNetwork?.();
    const queues = new Map<TurnMovementId, MovementQueueEntry[]>();
    const pendingReleased = new Map<
      JunctionId,
      Array<{ vehicleId: string; movementId: TurnMovementId }>
    >();
    const seenVehicles = new Set<string>();

    for (const nodeId of Object.keys(snapshot).sort()) {
      for (const approach of snapshot[nodeId] ?? []) {
        for (const entry of approach.entries) {
          if (seenVehicles.has(entry.vehicleId)) {
            throw new Error(`duplicate intersection vehicle ${entry.vehicleId}`);
          }
          seenVehicles.add(entry.vehicleId);
          const outgoingEdgeId = this.resolveQueuedOutgoingEdge?.(
            entry.vehicleId,
            nodeId,
            approach.incomingEdgeId,
          );
          const movementId = this.resolveMovement(
            nodeId,
            approach.incomingEdgeId,
            outgoingEdgeId,
          );
          const movement = this.runtime
            .networkSnapshot()
            .movements.find((candidate) => candidate.id === movementId);
          if (!movement) throw new Error(`missing movement ${movementId}`);
          if (entry.released) {
            const releases = pendingReleased.get(movement.junctionId) ?? [];
            releases.push({ vehicleId: entry.vehicleId, movementId });
            pendingReleased.set(movement.junctionId, releases);
          } else {
            const entries = queues.get(movementId) ?? [];
            entries.push(this.toMovementEntry(entry));
            queues.set(movementId, entries);
          }
        }
      }
    }

    const converted: IntersectionControlSnapshot = Object.freeze({
      controls: Object.freeze([]),
      queues: Object.freeze(
        [...queues.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([movementId, entries]) =>
            Object.freeze({ movementId, entries: Object.freeze(entries) }),
          ),
      ),
      pendingReleased: Object.freeze(
        [...pendingReleased.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([junctionId, releases]) =>
            Object.freeze({
              junctionId,
              releases: Object.freeze(
                releases.sort((a, b) => a.vehicleId.localeCompare(b.vehicleId)),
              ),
            }),
          ),
      ),
      serviceCredits: Object.freeze([]),
      lastSteppedTicks: Object.freeze([]),
    });
    this.runtime.intersections.restore(converted);
  }

  private resolveMovement(
    nodeId: string,
    incomingEdgeId: string,
    outgoingEdgeId?: string,
  ): TurnMovementId {
    const explicit = outgoingEdgeId
      ? this.runtime.movementIdForLegacyTurn(nodeId, incomingEdgeId, outgoingEdgeId)
      : undefined;
    if (explicit) return explicit;

    const junctionId = this.runtime.junctionIdForLegacyNode(nodeId);
    const incomingCarriagewayId = this.runtime.carriagewayIdForLegacyEdge(incomingEdgeId);
    if (!junctionId || !incomingCarriagewayId) {
      throw new Error(`cannot map legacy intersection approach ${nodeId}/${incomingEdgeId}`);
    }
    const candidates = this.runtime
      .networkSnapshot()
      .movements.filter(
        (movement) =>
          movement.allowed &&
          movement.junctionId === junctionId &&
          movement.fromCarriagewayId === incomingCarriagewayId,
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    if (candidates.length !== 1) {
      throw new Error(
        `queued vehicle requires an outgoing edge at ${nodeId}/${incomingEdgeId}`,
      );
    }
    return candidates[0]!.id;
  }

  private toMovementEntry(entry: IntersectionQueueEntry): MovementQueueEntry {
    return Object.freeze({
      vehicleId: entry.vehicleId,
      travelerWeight: entry.travelerWeight,
      queuedTick: entry.queuedTick,
      priority: entry.priority ?? "normal",
    });
  }
}
