import { TRANSIT_MODE_DEFINITIONS, type TransitMode } from '../../data/transit.ts';
import type { TransportationEdge, TransportationGraph } from '../traffic/TransportationGraph.ts';
import type { PathfindingSystem } from '../traffic/PathfindingSystem.ts';
import type { PassengerQueueSystem, TransitPassengerCohort } from './PassengerQueueSystem.ts';
import type { TransitLine, TransitNetworkSystem } from './TransitNetworkSystem.ts';

export type TransitDirectionKey = 'forward' | 'reverse';
export type TransitVehicleState = 'dwell' | 'moving' | 'out_of_service';
export type TransitVehicle = Readonly<{
  id: string;
  lineId: string;
  mode: TransitMode;
  directionKey: TransitDirectionKey;
  stopIndex: number;
  state: TransitVehicleState;
  capacity: number;
  onboard: readonly TransitPassengerCohort[];
  dwellRemainingTicks: number;
  stopServiced: boolean;
  roadEdgeIds: readonly string[];
  currentRoadEdgeIndex: number;
  edgeProgressTicks: number;
  dedicatedRemainingTicks: number;
  delayTicks: number;
  inServiceTicks: number;
  runStartedTick: number;
  hasDepartedOrigin: boolean;
}>;

type MutableVehicle = {
  id: string; lineId: string; mode: TransitMode; directionKey: TransitDirectionKey; stopIndex: number;
  state: TransitVehicleState; capacity: number; onboard: TransitPassengerCohort[]; dwellRemainingTicks: number;
  stopServiced: boolean; roadEdgeIds: string[]; currentRoadEdgeIndex: number; edgeProgressTicks: number;
  dedicatedRemainingTicks: number; delayTicks: number; inServiceTicks: number; runStartedTick: number; hasDepartedOrigin: boolean;
};

export type TransitVehicleEvent = Readonly<{
  type: 'boarded' | 'passenger_completed' | 'run_completed' | 'run_failed';
  vehicleId: string;
  lineId: string;
  weight?: number;
  fareRevenue?: number;
  delayTicks?: number;
}>;

const CARDINAL = [[0,-1],[1,0],[0,1],[-1,0]] as const;
const SURFACE_LOAD: Readonly<Record<Exclude<TransitMode,'metro'>, number>> = Object.freeze({ bus: 2, brt: 3, tram: 4 });

export class TransitVehicleSystem {
  private readonly vehicles = new Map<string, MutableVehicle>();
  private nextVehicleId = 1;

  dispatchRun(line: TransitLine, tick: number): string | null {
    if (!line.enabled || line.stopIds.length < 2) return null;
    const definition = TRANSIT_MODE_DEFINITIONS[line.mode];
    const id = `transit-vehicle:${this.nextVehicleId++}`;
    this.vehicles.set(id, {
      id, lineId: line.id, mode: line.mode, directionKey: 'forward', stopIndex: 0, state: 'dwell',
      capacity: definition.vehicleCapacity, onboard: [], dwellRemainingTicks: 0, stopServiced: false,
      roadEdgeIds: [], currentRoadEdgeIndex: 0, edgeProgressTicks: 0, dedicatedRemainingTicks: 0,
      delayTicks: 0, inServiceTicks: 0, runStartedTick: tick, hasDepartedOrigin: false,
    });
    return id;
  }

  activeCount(lineId?: string): number {
    return [...this.vehicles.values()].filter((v) => v.state !== 'out_of_service' && (lineId === undefined || v.lineId === lineId)).length;
  }

  listVehicles(): TransitVehicle[] {
    return [...this.vehicles.values()].map((v) => this.copy(v)).sort((a,b)=>a.id.localeCompare(b.id));
  }

  getVehicle(id: string): TransitVehicle | undefined {
    const v = this.vehicles.get(id); return v ? this.copy(v) : undefined;
  }

  edgeLoads(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const v of this.vehicles.values()) {
      if (v.state !== 'moving' || v.mode === 'metro') continue;
      const edgeId = v.roadEdgeIds[v.currentRoadEdgeIndex];
      if (!edgeId) continue;
      const weight = SURFACE_LOAD[v.mode];
      result[edgeId] = (result[edgeId] ?? 0) + weight;
    }
    return result;
  }

  step(
    tick: number,
    network: TransitNetworkSystem,
    queues: PassengerQueueSystem,
    graph: TransportationGraph,
    pathfinding: PathfindingSystem,
    roadTravelTime: (edge: TransportationEdge) => number,
  ): TransitVehicleEvent[] {
    const events: TransitVehicleEvent[] = [];
    for (const v of [...this.vehicles.values()].sort((a,b)=>a.id.localeCompare(b.id))) {
      v.inServiceTicks++;
      const line = network.getLine(v.lineId);
      if (!line || !line.enabled || line.stopIds.length < 2) {
        this.fail(v, events); continue;
      }
      if (v.state === 'dwell') {
        if (!v.stopServiced) {
          const complete = this.serviceStop(v, line, queues, tick, events);
          if (complete) { this.vehicles.delete(v.id); continue; }
        }
        if (v.dwellRemainingTicks > 0) { v.dwellRemainingTicks--; continue; }
        if (!this.prepareNextSegment(v, line, network, graph, pathfinding, roadTravelTime)) {
          this.fail(v, events); continue;
        }
        continue;
      }
      if (v.state === 'moving') {
        if (v.mode === 'metro') {
          v.dedicatedRemainingTicks--;
          if (v.dedicatedRemainingTicks <= 0) this.arriveNextStop(v);
          continue;
        }
        const remaining = v.roadEdgeIds.slice(v.currentRoadEdgeIndex);
        if (remaining.some((id) => !graph.getEdge(id))) { this.fail(v, events); continue; }
        const edgeId = v.roadEdgeIds[v.currentRoadEdgeIndex];
        const edge = edgeId ? graph.getEdge(edgeId) : undefined;
        if (!edge) { this.arriveNextStop(v); continue; }
        const travel = this.effectiveSurfaceTicks(v.mode, edge, roadTravelTime);
        v.edgeProgressTicks++;
        if (v.edgeProgressTicks + 1e-9 < travel) continue;
        v.edgeProgressTicks = 0;
        v.currentRoadEdgeIndex++;
        if (v.currentRoadEdgeIndex >= v.roadEdgeIds.length) this.arriveNextStop(v);
      }
    }
    return events;
  }

  private serviceStop(v: MutableVehicle, line: TransitLine, queues: PassengerQueueSystem, tick: number, events: TransitVehicleEvent[]): boolean {
    const currentStopId = line.stopIds[v.stopIndex];
    if (!currentStopId) return true;
    const alight = queues.alight(v.onboard, currentStopId);
    v.onboard = alight.continuing;
    for (const cohort of alight.alighted) {
      if (!queues.enqueueNextTransfer(cohort, tick)) events.push({ type:'passenger_completed', vehicleId:v.id, lineId:v.lineId, weight:cohort.travelerWeight });
    }

    const atForwardTerminus = v.directionKey === 'forward' && v.stopIndex === line.stopIds.length - 1;
    const atReturnTerminus = v.directionKey === 'reverse' && v.stopIndex === 0 && v.hasDepartedOrigin;
    if (atReturnTerminus) {
      events.push({ type:'run_completed', vehicleId:v.id, lineId:v.lineId, delayTicks:v.delayTicks });
      return true;
    }
    if (atForwardTerminus) v.directionKey = 'reverse';

    const remainingCapacity = Math.max(0, v.capacity - v.onboard.reduce((sum,c)=>sum+c.travelerWeight,0));
    const boarded = queues.board(currentStopId, line.id, v.directionKey, remainingCapacity);
    v.onboard.push(...boarded.boarded);
    if (boarded.boardedWeight > 0) events.push({ type:'boarded', vehicleId:v.id, lineId:v.lineId, weight:boarded.boardedWeight, fareRevenue:boarded.boardedWeight * line.fare });
    v.stopServiced = true;
    v.dwellRemainingTicks = TRANSIT_MODE_DEFINITIONS[v.mode].dwellTicks;
    return false;
  }

  private prepareNextSegment(v: MutableVehicle, line: TransitLine, network: TransitNetworkSystem, graph: TransportationGraph, pathfinding: PathfindingSystem, roadTravelTime: (edge: TransportationEdge)=>number): boolean {
    const nextIndex = v.stopIndex + (v.directionKey === 'forward' ? 1 : -1);
    const fromId = line.stopIds[v.stopIndex], toId = line.stopIds[nextIndex];
    if (!fromId || !toId) return false;
    const from = network.getStop(fromId), to = network.getStop(toId);
    if (!from || !to) return false;
    v.stopServiced = false; v.dwellRemainingTicks = 0; v.currentRoadEdgeIndex = 0; v.edgeProgressTicks = 0;
    if (v.mode === 'metro') {
      v.roadEdgeIds = [];
      v.dedicatedRemainingTicks = Math.max(10, (Math.abs(from.x-to.x)+Math.abs(from.y-to.y))*5);
      v.state = 'moving'; v.hasDepartedOrigin = true; return true;
    }
    const surfaceMode: Exclude<TransitMode, 'metro'> = v.mode;
    const start = this.accessNode(from.x, from.y, graph), end = this.accessNode(to.x, to.y, graph);
    if (!start || !end) return false;
    const route = pathfinding.findRoute(graph, start, end, { edgeCost: roadTravelTime, costKey:`transit:${v.mode}` });
    if (!route || route.edgeIds.length === 0) return false;
    v.roadEdgeIds = [...route.edgeIds]; v.dedicatedRemainingTicks = 0; v.state = 'moving'; v.hasDepartedOrigin = true;
    const free = route.edgeIds.reduce((sum,id)=>sum+(graph.getEdge(id)?.freeFlowTicks??0),0);
    const actual = route.edgeIds.reduce((sum,id)=>{const edge=graph.getEdge(id);return sum+(edge?this.effectiveSurfaceTicks(surfaceMode,edge,roadTravelTime):0);},0);
    v.delayTicks += Math.max(0, actual-free);
    return true;
  }

  private effectiveSurfaceTicks(mode: Exclude<TransitMode,'metro'>, edge: TransportationEdge, roadTravelTime:(edge:TransportationEdge)=>number): number {
    const raw = Math.max(edge.freeFlowTicks, roadTravelTime(edge));
    if (mode === 'brt') return edge.freeFlowTicks + (raw-edge.freeFlowTicks)*0.35;
    return raw;
  }

  private accessNode(x:number,y:number,graph:TransportationGraph): string | null {
    return CARDINAL.map(([dx,dy])=>graph.findNodeAt(x+dx,y+dy)?.id).filter((id):id is string=>id!==undefined).sort()[0]??null;
  }

  private arriveNextStop(v: MutableVehicle): void {
    v.stopIndex += v.directionKey === 'forward' ? 1 : -1;
    v.state = 'dwell'; v.stopServiced = false; v.dwellRemainingTicks = 0;
    v.roadEdgeIds = []; v.currentRoadEdgeIndex = 0; v.edgeProgressTicks = 0; v.dedicatedRemainingTicks = 0;
  }

  private fail(v: MutableVehicle, events: TransitVehicleEvent[]): void {
    events.push({ type:'run_failed', vehicleId:v.id, lineId:v.lineId, delayTicks:v.delayTicks });
    this.vehicles.delete(v.id);
  }

  private copy(v: MutableVehicle): TransitVehicle { return { ...v, onboard:v.onboard.map(c=>({...c,transferLegs:c.transferLegs.map(l=>({...l}))})), roadEdgeIds:[...v.roadEdgeIds] }; }
}
