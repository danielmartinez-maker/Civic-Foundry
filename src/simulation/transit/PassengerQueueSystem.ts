export type TransitTransferLeg = Readonly<{ lineId: string; directionKey: string; boardingStopId: string; alightingStopId: string }>;
export type TransitPassengerCohort = Readonly<{ id: string; personTripId: string; travelerWeight: number; lineId: string; directionKey: string; boardingStopId: string; alightingStopId: string; destinationRoadNodeId: string; enqueuedTick: number; transferLegs: readonly TransitTransferLeg[] }>;
export type PassengerQueueEntry = Readonly<{ stopId: string; lineId: string; directionKey: string; cohorts: readonly TransitPassengerCohort[] }>;
export type PassengerQueueSnapshot = Readonly<{ nextSplitId: number; queues: readonly PassengerQueueEntry[] }>;
export type PassengerBoardingResult = Readonly<{ boarded: readonly TransitPassengerCohort[]; boardedWeight: number; leftBehindWeight: number }>;
const queueKey = (stopId: string, lineId: string, directionKey: string): string => `${stopId}|${lineId}|${directionKey}`;
const cloneCohort = (cohort: TransitPassengerCohort): TransitPassengerCohort => ({ ...cohort, transferLegs: cohort.transferLegs.map((leg) => ({ ...leg })) });

export class PassengerQueueSystem {
  private readonly queues = new Map<string, { stopId: string; lineId: string; directionKey: string; cohorts: TransitPassengerCohort[] }>();
  private nextSplitId = 1;
  enqueue(stopId: string, lineId: string, directionKey: string, cohort: TransitPassengerCohort): boolean {
    if (!Number.isFinite(cohort.travelerWeight) || cohort.travelerWeight <= 0) return false;
    if (cohort.lineId !== lineId || cohort.directionKey !== directionKey || cohort.boardingStopId !== stopId) return false;
    const key = queueKey(stopId, lineId, directionKey); const queue = this.queues.get(key) ?? { stopId, lineId, directionKey, cohorts: [] };
    queue.cohorts.push(cloneCohort(cohort)); queue.cohorts.sort((a, b) => a.enqueuedTick - b.enqueuedTick || a.id.localeCompare(b.id)); this.queues.set(key, queue); return true;
  }
  board(stopId: string, lineId: string, directionKey: string, capacity: number): PassengerBoardingResult {
    const key = queueKey(stopId, lineId, directionKey); const queue = this.queues.get(key); let remaining = Math.max(0, Number.isFinite(capacity) ? capacity : 0); const boarded: TransitPassengerCohort[] = [];
    if (queue) {
      while (queue.cohorts.length > 0 && remaining > 1e-9) {
        const first = queue.cohorts[0]; if (!first) break;
        if (first.travelerWeight <= remaining + 1e-9) { boarded.push(cloneCohort(first)); remaining -= first.travelerWeight; queue.cohorts.shift(); }
        else { const weight = remaining; boarded.push({ ...cloneCohort(first), id: `passenger-split:${this.nextSplitId++}`, travelerWeight: weight }); queue.cohorts[0] = { ...cloneCohort(first), travelerWeight: first.travelerWeight - weight }; remaining = 0; }
      }
      if (queue.cohorts.length === 0) this.queues.delete(key);
    }
    const boardedWeight = boarded.reduce((sum, cohort) => sum + cohort.travelerWeight, 0);
    return Object.freeze({ boarded: Object.freeze(boarded), boardedWeight, leftBehindWeight: this.waitingWeight(stopId, lineId, directionKey) });
  }
  alight(onboard: readonly TransitPassengerCohort[], stopId: string): { alighted: TransitPassengerCohort[]; continuing: TransitPassengerCohort[] } {
    const alighted: TransitPassengerCohort[] = []; const continuing: TransitPassengerCohort[] = [];
    for (const cohort of onboard) (cohort.alightingStopId === stopId ? alighted : continuing).push(cloneCohort(cohort)); return { alighted, continuing };
  }
  enqueueNextTransfer(cohort: TransitPassengerCohort, tick: number): boolean {
    const [next, ...rest] = cohort.transferLegs; if (!next) return false;
    return this.enqueue(next.boardingStopId, next.lineId, next.directionKey, { ...cloneCohort(cohort), lineId: next.lineId, directionKey: next.directionKey, boardingStopId: next.boardingStopId, alightingStopId: next.alightingStopId, enqueuedTick: tick, transferLegs: rest });
  }
  peek(stopId: string, lineId: string, directionKey: string): TransitPassengerCohort[] { return (this.queues.get(queueKey(stopId, lineId, directionKey))?.cohorts ?? []).map(cloneCohort); }
  waitingWeight(stopId: string, lineId: string, directionKey: string): number { return (this.queues.get(queueKey(stopId, lineId, directionKey))?.cohorts ?? []).reduce((sum, cohort) => sum + cohort.travelerWeight, 0); }
  totalWaitingWeight(): number { let total = 0; for (const queue of this.queues.values()) total += queue.cohorts.reduce((sum, cohort) => sum + cohort.travelerWeight, 0); return total; }
  invalidateStop(stopId: string): TransitPassengerCohort[] { return this.removeMatching((queue) => queue.stopId === stopId || queue.cohorts.some((cohort) => cohort.alightingStopId === stopId || cohort.transferLegs.some((leg) => leg.boardingStopId === stopId || leg.alightingStopId === stopId))); }
  invalidateLine(lineId: string): TransitPassengerCohort[] { return this.removeMatching((queue) => queue.lineId === lineId || queue.cohorts.some((cohort) => cohort.transferLegs.some((leg) => leg.lineId === lineId))); }
  snapshot(): PassengerQueueSnapshot { return Object.freeze({ nextSplitId: this.nextSplitId, queues: Object.freeze([...this.queues.values()].sort((a, b) => queueKey(a.stopId, a.lineId, a.directionKey).localeCompare(queueKey(b.stopId, b.lineId, b.directionKey))).map((queue) => Object.freeze({ stopId: queue.stopId, lineId: queue.lineId, directionKey: queue.directionKey, cohorts: Object.freeze(queue.cohorts.map(cloneCohort)) }))) }); }
  restore(snapshot: PassengerQueueSnapshot): void {
    this.queues.clear();
    for (const queue of snapshot.queues) { const cohorts = queue.cohorts.map(cloneCohort).sort((a, b) => a.enqueuedTick - b.enqueuedTick || a.id.localeCompare(b.id)); if (cohorts.some((cohort) => !Number.isFinite(cohort.travelerWeight) || cohort.travelerWeight <= 0)) throw new Error('invalid passenger queue weight'); this.queues.set(queueKey(queue.stopId, queue.lineId, queue.directionKey), { stopId: queue.stopId, lineId: queue.lineId, directionKey: queue.directionKey, cohorts }); }
    this.nextSplitId = Math.max(1, Math.floor(snapshot.nextSplitId));
  }
  private removeMatching(predicate: (queue: { stopId: string; lineId: string; directionKey: string; cohorts: TransitPassengerCohort[] }) => boolean): TransitPassengerCohort[] {
    const removed: TransitPassengerCohort[] = [];
    for (const [key, queue] of [...this.queues.entries()].sort((a, b) => a[0].localeCompare(b[0]))) { if (!predicate(queue)) continue; removed.push(...queue.cohorts.map(cloneCohort)); this.queues.delete(key); }
    return removed.sort((a, b) => a.enqueuedTick - b.enqueuedTick || a.id.localeCompare(b.id));
  }
}
