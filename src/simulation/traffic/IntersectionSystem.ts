import type { TransportationGraph } from "./TransportationGraph.ts";

export type IntersectionQueueEntry = Readonly<{
  vehicleId: string;
  travelerWeight: number;
  queuedTick: number;
  priority?: "normal" | "emergency";
  /** Snapshot-only marker for a traveler that cleared capacity but has not yet been acknowledged by its owning system. */
  released?: boolean;
}>;

export type IntersectionSnapshot = Readonly<
  Record<
    string,
    readonly Readonly<{
      incomingEdgeId: string;
      entries: readonly IntersectionQueueEntry[];
    }>[]
  >
>;

type MutableIntersectionQueueEntry = {
  vehicleId: string;
  travelerWeight: number;
  queuedTick: number;
  priority: "normal" | "emergency";
};

type ApproachQueue = {
  incomingEdgeId: string;
  entries: MutableIntersectionQueueEntry[];
};

export class IntersectionSystem {
  private readonly queues = new Map<string, ApproachQueue[]>();
  /** Released IDs remain pending until their owning vehicle system acknowledges them via removeVehicle(). */
  private readonly pendingReleased = new Map<string, Map<string, string>>();
  /** Prevents multiple consumers from spending the same node capacity more than once in a simulation tick. */
  private readonly lastSteppedTick = new Map<string, number>();

  enqueue(
    nodeId: string,
    incomingEdgeId: string,
    entry: IntersectionQueueEntry,
    _outgoingEdgeId?: string,
  ): void {
    if (entry.released)
      throw new Error("released intersection entries are snapshot-only");
    if (entry.travelerWeight <= 0 || !Number.isFinite(entry.travelerWeight))
      throw new Error("invalid traveler weight");
    const approaches = this.queues.get(nodeId) ?? [];
    let approach = approaches.find(
      (candidate) => candidate.incomingEdgeId === incomingEdgeId,
    );
    if (!approach) {
      approach = { incomingEdgeId, entries: [] };
      approaches.push(approach);
      approaches.sort((a, b) =>
        a.incomingEdgeId.localeCompare(b.incomingEdgeId),
      );
      this.queues.set(nodeId, approaches);
    }
    if (this.hasVehicle(entry.vehicleId)) return;
    approach.entries.push({ ...entry, priority: entry.priority ?? "normal" });
    approach.entries.sort(
      (a, b) =>
        (a.priority === "emergency" ? 0 : 1) -
          (b.priority === "emergency" ? 0 : 1) ||
        a.queuedTick - b.queuedTick ||
        a.vehicleId.localeCompare(b.vehicleId),
    );
  }

  stepNode(
    graph: TransportationGraph,
    nodeId: string,
    tick?: number,
  ): string[] {
    const pending = this.pendingReleased.get(nodeId);
    if (pending && pending.size > 0) return [...pending.keys()].sort();
    if (tick !== undefined && this.lastSteppedTick.get(nodeId) === tick)
      return [];
    if (tick !== undefined) this.lastSteppedTick.set(nodeId, tick);

    const approaches = this.queues.get(nodeId);
    if (!approaches || approaches.length === 0) return [];
    const outgoing = graph.outgoingEdges(nodeId);
    const capacity =
      outgoing.length === 0
        ? 0
        : Math.max(...outgoing.map((edge) => edge.intersectionServiceRate));
    if (capacity <= 0) return [];

    const candidates = approaches
      .flatMap((approach) =>
        approach.entries.map((entry) => ({ approach, entry })),
      )
      .sort(
        (a, b) =>
          (a.entry.priority === "emergency" ? 0 : 1) -
            (b.entry.priority === "emergency" ? 0 : 1) ||
          a.entry.queuedTick - b.entry.queuedTick ||
          a.entry.vehicleId.localeCompare(b.entry.vehicleId),
      );

    let remaining = capacity;
    const released: Array<{ vehicleId: string; incomingEdgeId: string }> = [];
    for (const candidate of candidates) {
      if (remaining <= 1e-9) break;
      if (candidate.entry.travelerWeight > remaining + 1e-9) {
        candidate.entry.travelerWeight -= remaining;
        remaining = 0;
        break;
      }
      remaining -= candidate.entry.travelerWeight;
      released.push({
        vehicleId: candidate.entry.vehicleId,
        incomingEdgeId: candidate.approach.incomingEdgeId,
      });
      const index = candidate.approach.entries.findIndex(
        (entry) => entry.vehicleId === candidate.entry.vehicleId,
      );
      if (index >= 0) candidate.approach.entries.splice(index, 1);
    }
    this.pruneEmpty(nodeId);
    if (released.length > 0)
      this.pendingReleased.set(
        nodeId,
        new Map(released.map((item) => [item.vehicleId, item.incomingEdgeId])),
      );
    return released.map((item) => item.vehicleId);
  }

  removeVehicle(vehicleId: string): void {
    for (const [nodeId, approaches] of [...this.queues.entries()]) {
      for (const approach of approaches) {
        const index = approach.entries.findIndex(
          (entry) => entry.vehicleId === vehicleId,
        );
        if (index >= 0) approach.entries.splice(index, 1);
      }
      this.pruneEmpty(nodeId);
    }
    for (const [nodeId, ids] of [...this.pendingReleased.entries()]) {
      ids.delete(vehicleId);
      if (ids.size === 0) this.pendingReleased.delete(nodeId);
    }
  }

  queueLength(nodeId?: string): number {
    if (nodeId !== undefined)
      return (this.queues.get(nodeId) ?? []).reduce(
        (sum, approach) => sum + approach.entries.length,
        0,
      );
    let total = 0;
    for (const approaches of this.queues.values())
      total += approaches.reduce(
        (sum, approach) => sum + approach.entries.length,
        0,
      );
    return total;
  }

  snapshot(): IntersectionSnapshot {
    const result: Record<
      string,
      Array<{ incomingEdgeId: string; entries: IntersectionQueueEntry[] }>
    > = {};
    const nodeIds = new Set([
      ...this.queues.keys(),
      ...this.pendingReleased.keys(),
    ]);
    for (const nodeId of [...nodeIds].sort()) {
      const approaches = this.queues.get(nodeId) ?? [];
      const pending =
        this.pendingReleased.get(nodeId) ?? new Map<string, string>();
      const edgeIds = new Set([
        ...approaches.map((approach) => approach.incomingEdgeId),
        ...pending.values(),
      ]);
      result[nodeId] = [...edgeIds].sort().map((incomingEdgeId) => {
        const approach = approaches.find(
          (candidate) => candidate.incomingEdgeId === incomingEdgeId,
        );
        const entries: IntersectionQueueEntry[] = (approach?.entries ?? []).map(
          (entry) => ({ ...entry }),
        );
        for (const [vehicleId, edgeId] of [...pending.entries()].sort(
          ([a], [b]) => a.localeCompare(b),
        )) {
          if (edgeId !== incomingEdgeId) continue;
          entries.push({
            vehicleId,
            travelerWeight: 0,
            queuedTick: 0,
            priority: "normal",
            released: true,
          });
        }
        return { incomingEdgeId, entries };
      });
    }
    return result;
  }

  restore(snapshot: IntersectionSnapshot): void {
    this.queues.clear();
    this.pendingReleased.clear();
    this.lastSteppedTick.clear();
    for (const nodeId of Object.keys(snapshot).sort()) {
      const approaches = snapshot[nodeId] ?? [];
      const queued: ApproachQueue[] = [];
      const released = new Map<string, string>();
      for (const approach of approaches) {
        const entries: MutableIntersectionQueueEntry[] = [];
        for (const entry of approach.entries) {
          if (entry.released) {
            if (released.has(entry.vehicleId))
              throw new Error("duplicate released intersection vehicle");
            released.set(entry.vehicleId, approach.incomingEdgeId);
            continue;
          }
          entries.push({ ...entry, priority: entry.priority ?? "normal" });
        }
        if (entries.length > 0)
          queued.push({ incomingEdgeId: approach.incomingEdgeId, entries });
      }
      if (queued.length > 0) this.queues.set(nodeId, queued);
      if (released.size > 0) this.pendingReleased.set(nodeId, released);
    }
  }

  private hasVehicle(vehicleId: string): boolean {
    for (const approaches of this.queues.values()) {
      if (
        approaches.some((approach) =>
          approach.entries.some((entry) => entry.vehicleId === vehicleId),
        )
      )
        return true;
    }
    for (const released of this.pendingReleased.values())
      if (released.has(vehicleId)) return true;
    return false;
  }

  private pruneEmpty(nodeId: string): void {
    const approaches = this.queues.get(nodeId);
    if (!approaches) return;
    const remaining = approaches.filter(
      (approach) => approach.entries.length > 0,
    );
    if (remaining.length === 0) this.queues.delete(nodeId);
    else this.queues.set(nodeId, remaining);
  }
}
