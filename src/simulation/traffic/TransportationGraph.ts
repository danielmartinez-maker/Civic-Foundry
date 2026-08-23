import type { RoadType } from '../../data/roads.ts';
import { ROAD_DEFINITIONS } from '../../data/roads.ts';
import type { RoadSystem } from '../../world/roads/RoadSystem.ts';

export type TransportationNode = Readonly<{
  id: string;
  x: number;
  y: number;
  roadType: RoadType;
}>;

export type TransportationEdge = Readonly<{
  id: string;
  from: string;
  to: string;
  roadType: RoadType;
  lengthCells: number;
  freeFlowSpeedCellsPerSecond: number;
  freeFlowTicks: number;
  capacityPerMinute: number;
  intersectionServiceRate: number;
}>;

const CARDINAL = [[0,-1],[1,0],[0,1],[-1,0]] as const;
const nodeId = (x: number, y: number): string => `n:${x},${y}`;

export class TransportationGraph {
  nodes: TransportationNode[] = [];
  edges: TransportationEdge[] = [];
  revision = 0;
  sourceRoadRevision = -1;
  private nodeById = new Map<string, TransportationNode>();
  private edgeById = new Map<string, TransportationEdge>();
  private outgoing = new Map<string, TransportationEdge[]>();

  rebuildIfNeeded(roads: RoadSystem): boolean {
    if (roads.revision === this.sourceRoadRevision) return false;
    const roadList = roads.list();
    const roadByCoord = new Map(roadList.map((road) => [`${road.x},${road.y}`, road] as const));
    const nodes = roadList.map((road) => ({ id: nodeId(road.x, road.y), x: road.x, y: road.y, roadType: road.type }));
    const edges: TransportationEdge[] = [];
    for (const road of roadList) {
      for (const [dx, dy] of CARDINAL) {
        const neighbor = roadByCoord.get(`${road.x + dx},${road.y + dy}`);
        if (!neighbor) continue;
        const definition = ROAD_DEFINITIONS[road.type];
        const from = nodeId(road.x, road.y);
        const to = nodeId(neighbor.x, neighbor.y);
        edges.push({
          id: `e:${from}>${to}`,
          from,
          to,
          roadType: road.type,
          lengthCells: 1,
          freeFlowSpeedCellsPerSecond: definition.freeFlowSpeedCellsPerSecond,
          freeFlowTicks: 10 / definition.freeFlowSpeedCellsPerSecond,
          capacityPerMinute: definition.weightedVehicleCapacityPerMinute,
          intersectionServiceRate: definition.intersectionServiceRate,
        });
      }
    }
    nodes.sort((a, b) => a.y - b.y || a.x - b.x);
    edges.sort((a, b) => a.id.localeCompare(b.id));
    this.nodes = nodes;
    this.edges = edges;
    this.nodeById = new Map(nodes.map((node) => [node.id, node]));
    this.edgeById = new Map(edges.map((edge) => [edge.id, edge]));
    this.outgoing = new Map();
    for (const edge of edges) {
      const list = this.outgoing.get(edge.from) ?? [];
      list.push(edge);
      this.outgoing.set(edge.from, list);
    }
    this.sourceRoadRevision = roads.revision;
    this.revision++;
    return true;
  }

  findNodeAt(x: number, y: number): TransportationNode | undefined {
    return this.nodeById.get(nodeId(x, y));
  }

  getNode(id: string): TransportationNode | undefined {
    return this.nodeById.get(id);
  }

  getEdge(id: string): TransportationEdge | undefined {
    return this.edgeById.get(id);
  }

  outgoingEdges(node: string): readonly TransportationEdge[] {
    return this.outgoing.get(node) ?? [];
  }
}
