export type TransportationIncidentKind = "crash" | "breakdown" | "closure" | "hazard";
export type TransportationResponseKind = "police" | "fire" | "medical" | "road-service" | "none";

export type TransportationIncident = Readonly<{
  id: string;
  kind: TransportationIncidentKind;
  segmentId: string;
  laneIds: readonly string[];
  startTick: number;
  endTick: number;
  capacityMultiplier: number;
  traversalPenaltyTicks: number;
  requiredResponse: TransportationResponseKind;
}>;

export type TransportationIncidentSnapshot = Readonly<{
  currentTick: number;
  incidents: readonly TransportationIncident[];
}>;

export type TransportationIncidentEffects = Readonly<{
  capacityMultiplier: number;
  closedLaneIds: readonly string[];
  traversalPenaltyTicks: number;
}>;

export type TransportationServiceRequest = Readonly<{
  incidentId: string;
  requiredResponse: Exclude<TransportationResponseKind, "none">;
}>;

function safeTick(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function canonicalIncident(input: TransportationIncident): TransportationIncident {
  if (input.id.length === 0) throw new Error("incident id must be non-empty");
  if (input.segmentId.length === 0) throw new Error("incident segmentId must be non-empty");
  const startTick = safeTick(input.startTick, "incident startTick");
  const endTick = safeTick(input.endTick, "incident endTick");
  if (endTick <= startTick) throw new Error("incident endTick must be greater than startTick");
  if (!Number.isFinite(input.capacityMultiplier) || input.capacityMultiplier < 0 || input.capacityMultiplier > 1) {
    throw new Error("incident capacityMultiplier must be finite and between 0 and 1");
  }
  if (!Number.isFinite(input.traversalPenaltyTicks) || input.traversalPenaltyTicks < 0) {
    throw new Error("incident traversalPenaltyTicks must be finite and non-negative");
  }
  const laneIds = [...new Set(input.laneIds)].sort();
  if (laneIds.some((id) => id.length === 0)) throw new Error("incident lane ids must be non-empty");

  return Object.freeze({
    ...input,
    laneIds: Object.freeze(laneIds),
    startTick,
    endTick,
  });
}

export class TransportationIncidentSystem {
  private readonly incidents = new Map<string, TransportationIncident>();
  private currentTick = 0;

  upsert(incident: TransportationIncident): void {
    const canonical = canonicalIncident(incident);
    this.incidents.set(canonical.id, canonical);
  }

  remove(incidentId: string): boolean {
    return this.incidents.delete(incidentId);
  }

  advance(simulationTick: number): void {
    this.currentTick = safeTick(simulationTick, "simulationTick");
  }

  active(): readonly TransportationIncident[] {
    return Object.freeze(
      [...this.incidents.values()]
        .filter((incident) => incident.startTick <= this.currentTick && this.currentTick < incident.endTick)
        .sort((a, b) => a.id.localeCompare(b.id)),
    );
  }

  effectsForSegment(segmentId: string): TransportationIncidentEffects {
    const matching = this.active().filter((incident) => incident.segmentId === segmentId);
    let capacityMultiplier = 1;
    let traversalPenaltyTicks = 0;
    const closedLaneIds = new Set<string>();
    for (const incident of matching) {
      capacityMultiplier *= incident.capacityMultiplier;
      traversalPenaltyTicks += incident.traversalPenaltyTicks;
      for (const laneId of incident.laneIds) closedLaneIds.add(laneId);
    }
    return Object.freeze({
      capacityMultiplier,
      closedLaneIds: Object.freeze([...closedLaneIds].sort()),
      traversalPenaltyTicks,
    });
  }

  serviceRequests(): readonly TransportationServiceRequest[] {
    return Object.freeze(
      this.active()
        .filter(
          (incident): incident is TransportationIncident & {
            requiredResponse: Exclude<TransportationResponseKind, "none">;
          } => incident.requiredResponse !== "none",
        )
        .map((incident) =>
          Object.freeze({ incidentId: incident.id, requiredResponse: incident.requiredResponse }),
        ),
    );
  }

  snapshot(): TransportationIncidentSnapshot {
    return Object.freeze({
      currentTick: this.currentTick,
      incidents: Object.freeze([...this.incidents.values()].sort((a, b) => a.id.localeCompare(b.id))),
    });
  }

  restore(snapshot: TransportationIncidentSnapshot): void {
    const currentTick = safeTick(snapshot.currentTick, "incident snapshot currentTick");
    const next = new Map<string, TransportationIncident>();
    for (const incident of snapshot.incidents) {
      const canonical = canonicalIncident(incident);
      if (next.has(canonical.id)) throw new Error(`duplicate incident id: ${canonical.id}`);
      next.set(canonical.id, canonical);
    }
    this.incidents.clear();
    for (const [id, incident] of next) this.incidents.set(id, incident);
    this.currentTick = currentTick;
  }
}
