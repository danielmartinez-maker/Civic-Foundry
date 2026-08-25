import { SeededRandom } from '../core/SeededRandom.ts';
import type { Building } from '../buildings/BuildingSystem.ts';
import type { ServiceDemandSnapshot } from './ServiceDemandSystem.ts';
import type { ServiceDispatchSystem, ServiceJob, ServiceJobType } from './ServiceDispatchSystem.ts';

export type IncidentKind = 'fire' | 'police' | 'medical';
export type IncidentStatus = 'active' | 'resolved';

export type ServiceIncident = Readonly<{
  id: string;
  kind: IncidentKind;
  targetBuildingId: string;
  createdTick: number;
  severity: number;
  intensity: number;
  damage: number;
  status: IncidentStatus;
  serviceJobId: string;
  spreadTriggered: boolean;
}>;

type MutableIncident = {
  id: string;
  kind: IncidentKind;
  targetBuildingId: string;
  createdTick: number;
  severity: number;
  intensity: number;
  damage: number;
  status: IncidentStatus;
  serviceJobId: string;
  spreadTriggered: boolean;
};

export type IncidentOutcome = Readonly<{ kind: IncidentKind; success: boolean; responseTicks: number }>;
const CARDINAL = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const JOB_BY_KIND: Readonly<Record<IncidentKind, ServiceJobType>> = Object.freeze({ fire: 'fire_response', police: 'police_response', medical: 'medical_response' });

export class IncidentSystem {
  private readonly random: SeededRandom;
  private readonly incidents = new Map<string, MutableIncident>();
  private readonly outcomes: IncidentOutcome[] = [];
  private nextIncidentId = 1;
  private _entityRevision = 0;

  constructor(seed: number) {
    this.random = new SeededRandom(seed ^ 0x4f2a9c17);
  }

  get entityRevision(): number { return this._entityRevision; }

  generateFromDemand(tick: number, buildings: readonly Building[], demand: ServiceDemandSnapshot, dispatch: ServiceDispatchSystem): void {
    for (const building of [...buildings].sort((a, b) => a.id.localeCompare(b.id))) {
      if (building.status !== 'occupied') continue;
      const load = demand.perBuilding[building.id];
      if (!load) continue;
      const exposures: Array<[IncidentKind, number]> = [['fire', load.fire], ['police', load.police], ['medical', load.healthcare]];
      for (const [kind, exposure] of exposures) {
        if (exposure <= 0 || this.hasActive(kind, building.id)) continue;
        const chance = Math.min(0.4, Math.max(0, exposure) * 0.02);
        if (this.random.next() < chance) this.createIncident(kind, building, Math.min(1, Math.max(0.15, exposure)), tick, dispatch);
      }
    }
  }

  createIncident(kind: IncidentKind, building: Building, severity: number, tick: number, dispatch: ServiceDispatchSystem): string {
    const normalized = Math.max(0, Math.min(1, Number.isFinite(severity) ? severity : 0));
    const id = `incident:${this.nextIncidentId++}`;
    const serviceJobId = dispatch.createJob(JOB_BY_KIND[kind], building.id, tick, normalized);
    this.incidents.set(id, {
      id, kind, targetBuildingId: building.id, createdTick: tick, severity: normalized,
      intensity: kind === 'fire' ? 0.35 + normalized * 0.25 : normalized,
      damage: 0, status: 'active', serviceJobId, spreadTriggered: false,
    });
    this._entityRevision++;
    return id;
  }

  advance(tick: number, jobs: readonly ServiceJob[], buildings: readonly Building[], dispatch?: ServiceDispatchSystem): void {
    const jobById = new Map(jobs.map((job) => [job.id, job]));
    const buildingById = new Map(buildings.map((building) => [building.id, building]));
    for (const incident of [...this.incidents.values()].filter((item) => item.status === 'active').sort((a, b) => a.id.localeCompare(b.id))) {
      const linked = jobById.get(incident.serviceJobId);
      if (incident.kind === 'fire') {
        const responderActive = linked?.status === 'servicing' || linked?.status === 'returning' || linked?.status === 'completed';
        if (responderActive) incident.intensity = Math.max(0, incident.intensity - 0.05 * (0.5 + incident.severity));
        else incident.intensity = Math.min(1.5, incident.intensity + 0.015 * (0.5 + incident.severity));
        incident.damage = Math.min(1.5, incident.damage + incident.intensity * 0.0015);

        if (incident.intensity >= 0.75 && !incident.spreadTriggered && dispatch) {
          incident.spreadTriggered = true;
          const source = buildingById.get(incident.targetBuildingId);
          if (source) {
            const adjacent = buildings.filter((building) => building.status === 'occupied'
              && CARDINAL.some(([dx, dy]) => building.x === source.x + dx && building.y === source.y + dy))
              .sort((a, b) => a.id.localeCompare(b.id));
            for (const building of adjacent) {
              if (!this.hasActive('fire', building.id)) this.createIncident('fire', building, Math.max(0.2, incident.severity * 0.5), tick, dispatch);
            }
          }
        }

        if (responderActive && incident.intensity <= 0.01) this.resolve(incident, linked, tick, true);
        else if (incident.damage >= 1) this.resolve(incident, linked, tick, false);
      } else if (linked?.status === 'completed') {
        this.resolve(incident, linked, tick, true);
      }
    }
  }

  getIncident(id: string): ServiceIncident | undefined {
    const incident = this.incidents.get(id);
    return incident ? { ...incident } : undefined;
  }

  listIncidents(): ServiceIncident[] {
    return [...this.incidents.values()].map((incident) => ({ ...incident })).sort((a, b) => a.id.localeCompare(b.id));
  }

  unresolvedLoad(kind: IncidentKind): number {
    return [...this.incidents.values()].filter((incident) => incident.kind === kind && incident.status === 'active').reduce((sum, incident) => sum + incident.severity, 0);
  }

  recentOutcomeScore(kind: IncidentKind): number {
    const relevant = this.outcomes.filter((outcome) => outcome.kind === kind);
    if (relevant.length === 0) return 0.5;
    return relevant.reduce((sum, outcome) => sum + (outcome.success ? Math.max(0.5, 1 - outcome.responseTicks / 300) : 0), 0) / relevant.length;
  }

  getRandomState(): number { return this.random.getState(); }
  getNextIncidentId(): number { return this.nextIncidentId; }

  restore(incidents: readonly ServiceIncident[], outcomes: readonly IncidentOutcome[], rngState: number, nextIncidentId: number): void {
    this.incidents.clear();
    for (const incident of incidents) this.incidents.set(incident.id, { ...incident });
    this.outcomes.length = 0;
    this.outcomes.push(...outcomes.map((outcome) => ({ ...outcome })));
    this.random.setState(rngState);
    this.nextIncidentId = Math.max(1, Math.floor(nextIncidentId));
    this._entityRevision++;
  }

  snapshotOutcomes(): IncidentOutcome[] { return this.outcomes.map((outcome) => ({ ...outcome })); }

  private hasActive(kind: IncidentKind, buildingId: string): boolean {
    return [...this.incidents.values()].some((incident) => incident.kind === kind && incident.targetBuildingId === buildingId && incident.status === 'active');
  }

  private resolve(incident: MutableIncident, job: ServiceJob | undefined, tick: number, success: boolean): void {
    if (incident.status === 'resolved') return;
    incident.status = 'resolved';
    this._entityRevision++;
    const responseTicks = Math.max(1, (job?.arrivalTick ?? job?.completionTick ?? tick) - incident.createdTick);
    this.outcomes.push({ kind: incident.kind, success, responseTicks });
    while (this.outcomes.length > 128) this.outcomes.shift();
  }
}