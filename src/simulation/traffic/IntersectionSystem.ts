import type { TransportationGraph } from './TransportationGraph.ts';

export type IntersectionQueueEntry = Readonly<{
  vehicleId: string;
  travelerWeight: number;
  queuedTick: number;
}>;

type ApproachQueue = {
  incomingEdgeId: string;
  entries: IntersectionQueueEntry[];
};

export class IntersectionSystem {
  private readonly queues = new Map<string, ApproachQueue[]>();

  enqueue(nodeId: string, incomingEdgeId: string, entry: IntersectionQueueEntry): void {
    if (entry.travelerWeight <= 0 || !Number.isFinite(entry.travelerWeight)) throw new Error('invalid traveler weight');
    const approaches = this.queues.get(nodeId) ?? [];
    let approach = approaches.find((candidate) => candidate.incomingEdgeId === incomingEdgeId);
    if (!approach) {
      approach = { incomingEdgeId, entries: [] };
      approaches.push(approach);
      approaches.sort((a, b) => a.incomingEdgeId.localeCompare(b.incomingEdgeId));
      this.queues.set(nodeId, approaches);
    }
    if (this.hasVehicle(entry.vehicleId)) return;
    approach.entries.push({ ...entry });
    approach.entries.sort((a, b) => a.queuedTick - b.queuedTick || a.vehicleId.localeCompare(b.vehicleId));
  }

  stepNode(graph: TransportationGraph, nodeId: string): string[] {
    const approaches = this.queues.get(nodeId);
    if (!approaches || approaches.length === 0) return [];
    const outgoing = graph.outgoingEdges(nodeId);
    const capacity = outgoing.length === 0 ? 0 : Math.max(...outgoing.map((edge) => edge.intersectionServiceRate));
    if (capacity <= 0) return [];

    const candidates = approaches
      .flatMap((approach) => approach.entries.map((entry) => ({ approach, entry })))
      .sort((a, b) => a.entry.queuedTick - b.entry.queuedTick || a.entry.vehicleId.localeCompare(b.entry.vehicleId));

    let remaining = capacity;
    const released: string[] = [];
    for (const candidate of candidates) {
      if (candidate.entry.travelerWeight > remaining) break;
      remaining -= candidate.entry.travelerWeight;
      released.push(candidate.entry.vehicleId);
      const index = candidate.approach.entries.findIndex((entry) => entry.vehicleId === candidate.entry.vehicleId);
      if (index >= 0) candidate.approach.entries.splice(index, 1);
    }
    this.pruneEmpty(nodeId);
    return released;
  }

  removeVehicle(vehicleId: string): void {
    for (const [nodeId, approaches] of this.queues.entries()) {
      for (const approach of approaches) {
        const index = approach.entries.findIndex((entry) => entry.vehicleId === vehicleId);
        if (index >= 0) approach.entries.splice(index, 1);
      }
      this.pruneEmpty(nodeId);
    }
  }

  queueLength(nodeId?: string): number {
    if (nodeId !== undefined) {
      return (this.queues.get(nodeId) ?? []).reduce((sum, approach) => sum + approach.entries.length, 0);
    }
    let total = 0;
    for (const approaches of this.queues.values()) total += approaches.reduce((sum, approach) => sum + approach.entries.length, 0);
    return total;
  }

  snapshot(): Readonly<Record<string, readonly Readonly<{ incomingEdgeId: string; entries: readonly IntersectionQueueEntry[] }>[]>> {
    const result: Record<string, Readonly<{ incomingEdgeId: string; entries: readonly IntersectionQueueEntry[] }>[]> = {};
    for (const [nodeId, approaches] of [...this.queues.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      result[nodeId] = approaches.map((approach) => ({
        incomingEdgeId: approach.incomingEdgeId,
        entries: approach.entries.map((entry) => ({ ...entry })),
      }));
    }
    return result;
  }

  private hasVehicle(vehicleId: string): boolean {
    for (const approaches of this.queues.values()) {
      if (approaches.some((approach) => approach.entries.some((entry) => entry.vehicleId === vehicleId))) return true;
    }
    return false;
  }

  private pruneEmpty(nodeId: string): void {
    const approaches = this.queues.get(nodeId);
    if (!approaches) return;
    const remaining = approaches.filter((approach) => approach.entries.length > 0);
    if (remaining.length === 0) this.queues.delete(nodeId);
    else this.queues.set(nodeId, remaining);
  }
}
