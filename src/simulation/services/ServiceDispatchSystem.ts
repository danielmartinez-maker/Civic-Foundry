import { SERVICE_DEFINITIONS, type ServiceDepartment } from '../../data/services.ts';
import type { Building } from '../buildings/BuildingSystem.ts';
import type { ServiceFacilitySystem } from './ServiceFacilitySystem.ts';
import type { ServiceVehicleEvent, ServiceVehicleSystem } from './ServiceVehicleSystem.ts';
import type { PathfindingSystem, RouteResult } from '../traffic/PathfindingSystem.ts';
import type { TransportationEdge, TransportationGraph } from '../traffic/TransportationGraph.ts';

export type ServiceJobType = 'fire_response' | 'police_response' | 'medical_response' | 'garbage_collection';
export type ServiceJobStatus = 'waiting' | 'assigned' | 'responding' | 'servicing' | 'returning' | 'completed' | 'failed';
export type ServiceJob = {
  id: string;
  type: ServiceJobType;
  department: ServiceDepartment;
  targetBuildingId: string;
  createdTick: number;
  severity: number;
  status: ServiceJobStatus;
  assignedFacilityId?: string;
  assignedVehicleId?: string;
  responseStartTick?: number;
  arrivalTick?: number;
  completionTick?: number;
  accumulatedDelayTicks: number;
};

type MutableJob = ServiceJob;
const CARDINAL = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const DEPARTMENT_BY_JOB: Readonly<Record<ServiceJobType, ServiceDepartment>> = Object.freeze({ fire_response: 'fire', police_response: 'police', medical_response: 'healthcare', garbage_collection: 'garbage' });

export class ServiceDispatchSystem {
  private readonly jobs = new Map<string, MutableJob>();
  private nextJobId = 1;

  createJob(type: ServiceJobType, targetBuildingId: string, tick: number, severity: number): string {
    const id = `service-job:${this.nextJobId++}`;
    this.jobs.set(id, { id, type, department: DEPARTMENT_BY_JOB[type], targetBuildingId, createdTick: tick, severity: Math.max(0, Math.min(1, Number.isFinite(severity) ? severity : 0)), status: 'waiting', accumulatedDelayTicks: 0 });
    return id;
  }

  getJob(id: string): ServiceJob | undefined { const job = this.jobs.get(id); return job ? { ...job } : undefined; }
  listJobs(): ServiceJob[] { return [...this.jobs.values()].map((job) => ({ ...job })).sort((a, b) => a.id.localeCompare(b.id)); }

  assignWaiting(buildings: readonly Building[], facilities: ServiceFacilitySystem, vehicles: ServiceVehicleSystem, graph: TransportationGraph, pathfinding: PathfindingSystem, edgeCost: (edge: TransportationEdge) => number, tick: number): void {
    const byBuilding = new Map(buildings.map((building) => [building.id, building]));
    for (const job of [...this.jobs.values()].filter((candidate) => candidate.status === 'waiting').sort((a, b) => a.id.localeCompare(b.id))) {
      const target = byBuilding.get(job.targetBuildingId);
      if (!target) continue;
      const targetNode = this.accessNode(graph, target.x, target.y);
      if (!targetNode) continue;
      let best: { facilityId: string; vehicleId: string; outbound: RouteResult; back: RouteResult; homeNode: string; cost: number } | null = null;
      for (const facility of facilities.listFacilities().filter((candidate) => candidate.department === job.department)) {
        const available = vehicles.availableVehicleIds(facility.id);
        if (available.length === 0) continue;
        const homeNode = this.accessNode(graph, facility.x, facility.y);
        if (!homeNode) continue;
        const definition = SERVICE_DEFINITIONS[facility.type];
        const routeCost = (edge: TransportationEdge) => this.responseEdgeCost(job.department, edge, edgeCost);
        const costKey = `service-dispatch:${job.department}`;
        const outbound = pathfinding.findRoute(graph, homeNode, targetNode, { edgeCost: routeCost, costKey });
        const back = pathfinding.findRoute(graph, targetNode, homeNode, { edgeCost: routeCost, costKey });
        if (!outbound || !back || outbound.edgeIds.length === 0 || back.edgeIds.length === 0) continue;
        const cost = outbound.totalCost + definition.dispatchTurnaroundTicks / facilities.fundingEffectiveness(job.department);
        const candidate = { facilityId: facility.id, vehicleId: available[0]!, outbound, back, homeNode, cost };
        if (!best || candidate.cost < best.cost - 1e-9 || (Math.abs(candidate.cost - best.cost) <= 1e-9 && candidate.facilityId.localeCompare(best.facilityId) < 0)) best = candidate;
      }
      if (!best) continue;
      job.status = 'assigned';
      job.assignedFacilityId = best.facilityId;
      job.assignedVehicleId = best.vehicleId;
      job.responseStartTick = tick;
      if (vehicles.dispatchVehicle(best.vehicleId, job.id, best.outbound, best.back, best.homeNode, targetNode)) job.status = 'responding';
      else { job.status = 'waiting'; delete job.assignedFacilityId; delete job.assignedVehicleId; delete job.responseStartTick; }
    }
  }

  applyVehicleEvents(events: readonly ServiceVehicleEvent[], tick: number): void {
    for (const event of events) {
      const job = this.jobs.get(event.jobId);
      if (!job) continue;
      job.accumulatedDelayTicks = Math.max(job.accumulatedDelayTicks, tick - job.createdTick);
      if (event.type === 'arrived') { job.status = 'servicing'; job.arrivalTick = tick; }
      else if (event.type === 'returning') job.status = 'returning';
      else if (event.type === 'completed') { job.status = 'completed'; job.completionTick = tick; }
      else if (event.type === 'failed') { job.status = 'waiting'; delete job.assignedFacilityId; delete job.assignedVehicleId; delete job.responseStartTick; delete job.arrivalTick; }
    }
  }

  private responseEdgeCost(department: ServiceDepartment, edge: TransportationEdge, edgeCost: (edge: TransportationEdge) => number): number {
    const raw = Math.max(edge.freeFlowTicks, edgeCost(edge));
    if (department === 'garbage' || department === 'education') return raw;
    return edge.freeFlowTicks + (raw - edge.freeFlowTicks) * 0.55;
  }

  private accessNode(graph: TransportationGraph, x: number, y: number): string | undefined {
    return CARDINAL.map(([dx, dy]) => graph.findNodeAt(x + dx, y + dy)).filter((node): node is NonNullable<typeof node> => node !== undefined).sort((a, b) => a.id.localeCompare(b.id))[0]?.id;
  }
}
