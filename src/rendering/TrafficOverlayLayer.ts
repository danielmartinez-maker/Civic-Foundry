import type { TrafficAnalyticsSnapshot } from '../simulation/traffic/TrafficAnalytics.ts';
import type { EdgeTrafficMetric } from '../simulation/traffic/TrafficSystem.ts';
import type { TransportationGraph } from '../simulation/traffic/TransportationGraph.ts';

export type TrafficOverlayMode = 'none' | 'congestion' | 'speed' | 'volume' | 'bottlenecks';
export type TrafficOverlayEdge = Readonly<{ edgeId: string; from: string; to: string; value: number; label: string }>;
export type TrafficOverlaySnapshot = Readonly<{ mode: TrafficOverlayMode; edges: readonly TrafficOverlayEdge[]; legend: string }>;

export function mapTrafficOverlay(
  graph: TransportationGraph,
  metrics: readonly EdgeTrafficMetric[],
  analytics: TrafficAnalyticsSnapshot,
  mode: TrafficOverlayMode,
): TrafficOverlaySnapshot {
  const byId = new Map(metrics.map((metric) => [metric.edgeId, metric]));
  const bottlenecks = new Set(analytics.worstBottlenecks);
  const edges = graph.edges.map((edge): TrafficOverlayEdge => {
    const metric = byId.get(edge.id);
    const value = mode === 'congestion' ? (metric?.congestion ?? 0)
      : mode === 'speed' ? (metric?.averageSpeedCellsPerSecond ?? edge.freeFlowSpeedCellsPerSecond)
      : mode === 'volume' ? (metric?.weightedVehicles ?? 0)
      : mode === 'bottlenecks' ? (bottlenecks.has(edge.id) ? 1 : 0)
      : 0;
    const label = mode === 'congestion' ? `${Math.round(value * 100)}% congestion`
      : mode === 'speed' ? `${value.toFixed(2)} cells/s`
      : mode === 'volume' ? `${value.toFixed(1)} weighted vehicles`
      : mode === 'bottlenecks' ? (value > 0 ? 'Bottleneck' : 'Normal')
      : 'Traffic overlay off';
    return { edgeId: edge.id, from: edge.from, to: edge.to, value, label };
  });
  const legend = mode === 'congestion' ? 'Congestion: 0% free-flow → 100% severe'
    : mode === 'speed' ? 'Speed: lower values indicate slower traffic'
    : mode === 'volume' ? 'Volume: weighted vehicles currently using each directed road edge'
    : mode === 'bottlenecks' ? 'Bottlenecks: highest congestion × volume edges'
    : 'Traffic overlay off';
  return { mode, edges, legend };
}
