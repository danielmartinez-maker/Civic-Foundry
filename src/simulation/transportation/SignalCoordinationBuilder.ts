import type {
  JunctionControlPlan,
  SignalCoordinationGroup,
} from './IntersectionControlTypes.ts';
import type {
  Junction,
  JunctionId,
  RoadSegment,
  TransportNetworkAuthority,
} from './TransportNetworkTypes.ts';

const SIMULATION_TICKS_PER_SECOND = 10;

type CorridorEdge = Readonly<{
  from: JunctionId;
  to: JunctionId;
  segment: RoadSegment;
}>;

function requireIntegerNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function freeFlowTravelTicks(segment: RoadSegment): number {
  if (!Number.isFinite(segment.lengthMeters) || segment.lengthMeters <= 0) {
    throw new Error(`segment ${segment.id} lengthMeters must be finite and greater than zero`);
  }
  if (!Number.isFinite(segment.speedLimitKph) || segment.speedLimitKph <= 0) {
    throw new Error(`segment ${segment.id} speedLimitKph must be finite and greater than zero`);
  }
  const exactTicks = (segment.lengthMeters / (segment.speedLimitKph / 3.6)) * SIMULATION_TICKS_PER_SECOND;
  return Math.max(1, Math.round(exactTicks));
}

function signalPlansByJunction(
  plans: readonly JunctionControlPlan[],
): ReadonlyMap<JunctionId, JunctionControlPlan> {
  const result = new Map<JunctionId, JunctionControlPlan>();
  for (const plan of [...plans].sort((a, b) => a.junctionId.localeCompare(b.junctionId))) {
    if (result.has(plan.junctionId)) throw new Error(`duplicate control plan for ${plan.junctionId}`);
    if (plan.controlType !== 'signal' || !plan.phasePlan) continue;
    if (!Number.isFinite(plan.phasePlan.cycleTicks)
      || plan.phasePlan.cycleTicks <= 0
      || !Number.isInteger(plan.phasePlan.cycleTicks)) {
      throw new Error(`signal plan ${plan.id} has invalid cycleTicks`);
    }
    result.set(plan.junctionId, plan);
  }
  return result;
}

function compareProgressionJunctions(a: Junction, b: Junction, horizontal: boolean): number {
  const primary = horizontal ? a.x - b.x : a.y - b.y;
  if (primary !== 0) return primary;
  const secondary = horizontal ? a.y - b.y : a.x - b.x;
  return secondary !== 0 ? secondary : a.id.localeCompare(b.id);
}

function chooseStart(
  endpointIds: readonly JunctionId[],
  junctionById: ReadonlyMap<JunctionId, Junction>,
  componentIds: readonly JunctionId[],
): JunctionId {
  const junctions = componentIds.map((id) => junctionById.get(id)).filter((value): value is Junction => value !== undefined);
  if (junctions.length !== componentIds.length) throw new Error('coordination component references unknown junction');
  const xs = junctions.map((junction) => junction.x);
  const ys = junctions.map((junction) => junction.y);
  const horizontal = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
  const endpoints = endpointIds
    .map((id) => junctionById.get(id))
    .filter((value): value is Junction => value !== undefined)
    .sort((a, b) => compareProgressionJunctions(a, b, horizontal));
  const start = endpoints[0];
  if (!start) throw new Error('coordination corridor has no endpoint');
  return start.id;
}

function edgeKey(a: JunctionId, b: JunctionId): string {
  return a.localeCompare(b) <= 0 ? `${a}|${b}` : `${b}|${a}`;
}

function canonicalEdge(existing: CorridorEdge | undefined, candidate: CorridorEdge): CorridorEdge {
  if (!existing) return candidate;
  const existingTicks = freeFlowTravelTicks(existing.segment);
  const candidateTicks = freeFlowTravelTicks(candidate.segment);
  if (candidateTicks < existingTicks) return candidate;
  if (candidateTicks > existingTicks) return existing;
  return candidate.segment.id.localeCompare(existing.segment.id) < 0 ? candidate : existing;
}

export function buildSignalCoordinationGroups(
  authority: TransportNetworkAuthority,
  plans: readonly JunctionControlPlan[],
  planRevision: number,
): readonly SignalCoordinationGroup[] {
  requireIntegerNonNegative(planRevision, 'planRevision');
  const planByJunction = signalPlansByJunction(plans);
  const junctionById = new Map(authority.junctions.map((junction) => [junction.id, junction]));
  const adjacency = new Map<JunctionId, Set<JunctionId>>();
  const edgeByPair = new Map<string, CorridorEdge>();

  for (const segment of [...authority.segments].sort((a, b) => a.id.localeCompare(b.id))) {
    if (segment.roadClass !== 'arterial') continue;
    const startPlan = planByJunction.get(segment.startJunctionId);
    const endPlan = planByJunction.get(segment.endJunctionId);
    if (!startPlan?.phasePlan || !endPlan?.phasePlan) continue;
    if (startPlan.phasePlan.cycleTicks !== endPlan.phasePlan.cycleTicks) continue;
    if (!junctionById.has(segment.startJunctionId) || !junctionById.has(segment.endJunctionId)) {
      throw new Error(`segment ${segment.id} references unknown junction`);
    }

    const candidate: CorridorEdge = {
      from: segment.startJunctionId,
      to: segment.endJunctionId,
      segment,
    };
    const key = edgeKey(candidate.from, candidate.to);
    edgeByPair.set(key, canonicalEdge(edgeByPair.get(key), candidate));

    const startNeighbors = adjacency.get(candidate.from) ?? new Set<JunctionId>();
    startNeighbors.add(candidate.to);
    adjacency.set(candidate.from, startNeighbors);
    const endNeighbors = adjacency.get(candidate.to) ?? new Set<JunctionId>();
    endNeighbors.add(candidate.from);
    adjacency.set(candidate.to, endNeighbors);
  }

  const groups: SignalCoordinationGroup[] = [];
  const visited = new Set<JunctionId>();
  const seeds = [...adjacency.keys()].sort((a, b) => a.localeCompare(b));

  for (const seed of seeds) {
    if (visited.has(seed)) continue;
    const stack = [seed];
    const component: JunctionId[] = [];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || visited.has(current)) continue;
      visited.add(current);
      component.push(current);
      for (const neighbor of [...(adjacency.get(current) ?? [])].sort((a, b) => b.localeCompare(a))) {
        if (!visited.has(neighbor)) stack.push(neighbor);
      }
    }
    component.sort((a, b) => a.localeCompare(b));
    if (component.length < 2) continue;

    const degrees = component.map((id) => adjacency.get(id)?.size ?? 0);
    if (degrees.some((degree) => degree > 2)) continue;
    const endpointIds = component.filter((id) => (adjacency.get(id)?.size ?? 0) === 1);
    if (endpointIds.length !== 2) continue;

    const start = chooseStart(endpointIds, junctionById, component);
    const ordered: JunctionId[] = [];
    let previous: JunctionId | undefined;
    let current: JunctionId | undefined = start;
    while (current !== undefined) {
      ordered.push(current);
      const nextCandidates = [...(adjacency.get(current) ?? [])]
        .filter((id) => id !== previous)
        .sort((a, b) => a.localeCompare(b));
      if (nextCandidates.length === 0) break;
      previous = current;
      current = nextCandidates[0];
    }
    if (ordered.length !== component.length) continue;

    const firstPlan = planByJunction.get(ordered[0] ?? '');
    const cycleTicks = firstPlan?.phasePlan?.cycleTicks;
    if (cycleTicks === undefined) continue;
    const offsetsByJunction: Record<JunctionId, number> = {};
    let cumulativeTravelTicks = 0;
    for (let index = 0; index < ordered.length; index += 1) {
      const junctionId = ordered[index];
      if (!junctionId) continue;
      offsetsByJunction[junctionId] = cumulativeTravelTicks % cycleTicks;
      const nextJunctionId = ordered[index + 1];
      if (!nextJunctionId) continue;
      const edge = edgeByPair.get(edgeKey(junctionId, nextJunctionId));
      if (!edge) throw new Error(`missing corridor segment between ${junctionId} and ${nextJunctionId}`);
      cumulativeTravelTicks += freeFlowTravelTicks(edge.segment);
    }

    const from = ordered[0];
    const to = ordered[ordered.length - 1];
    if (!from || !to) continue;
    groups.push(Object.freeze({
      id: `scg:${ordered.join('>')}`,
      junctionIds: Object.freeze([...ordered]),
      cycleTicks,
      offsetsByJunction: Object.freeze(offsetsByJunction),
      progressionFromJunctionId: from,
      progressionToJunctionId: to,
      planRevision,
    }));
  }

  return Object.freeze(groups.sort((a, b) => a.id.localeCompare(b.id)));
}
