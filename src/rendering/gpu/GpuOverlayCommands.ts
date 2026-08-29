import type { SimulationCore } from '../../simulation/core/SimulationCore.ts';
import { mapCadastralOverlay } from '../CadastralOverlayLayer.ts';
import { mapEconomyOverlay, type EconomyOverlayMode } from '../EconomyOverlayLayer.ts';
import { mapServiceOverlay, type ServiceOverlayMode } from '../ServiceOverlayLayer.ts';
import { mapTrafficOverlay, type TrafficOverlayMode } from '../TrafficOverlayLayer.ts';
import { mapTransitOverlay, type TransitOverlayMode } from '../TransitOverlayLayer.ts';
import { mapZoningEnvelope } from '../ZoningEnvelopeLayer.ts';
import type { GpuOverlayCommand, GpuOverlayPoint } from './GpuOverlayTypes.ts';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export function buildTrafficOverlayCommands(
  core: SimulationCore,
  mode: TrafficOverlayMode,
): readonly GpuOverlayCommand[] {
  if (mode === 'none') return [];

  const snapshot = mapTrafficOverlay(
    core.transportationGraph,
    core.traffic.edgeMetrics,
    core.trafficSnapshot,
    mode,
  );
  const maxSpeed = Math.max(
    1,
    ...core.transportationGraph.edges.map((edge) => edge.freeFlowSpeedCellsPerSecond),
  );
  const maxVolume = Math.max(1, ...core.traffic.edgeMetrics.map((metric) => metric.weightedVehicles));
  const commands: GpuOverlayCommand[] = [];

  for (const item of snapshot.edges) {
    if (mode === 'bottlenecks' && item.value <= 0) continue;
    const edge = core.transportationGraph.getEdge(item.edgeId);
    const from = edge ? core.transportationGraph.getNode(edge.from) : undefined;
    const to = edge ? core.transportationGraph.getNode(edge.to) : undefined;
    if (!edge || !from || !to) continue;

    const normalized =
      mode === 'congestion'
        ? item.value
        : mode === 'speed'
          ? 1 - Math.min(1, item.value / maxSpeed)
          : mode === 'volume'
            ? Math.min(1, item.value / maxVolume)
            : item.value;
    const hue = Math.round(120 - 120 * clamp01(normalized));
    commands.push({
      kind: 'segment',
      key: `traffic:${mode}:${item.edgeId}`,
      from: { x: from.x, y: from.y },
      to: { x: to.x, y: to.y },
      color: mode === 'bottlenecks' ? '#ff5b5b' : `hsla(${hue},85%,58%,.82)`,
      widthFactor: mode === 'bottlenecks' ? 0.11 : 0.075,
    });
  }

  return commands;
}

export function buildServiceOverlayCommands(
  core: SimulationCore,
  mode: ServiceOverlayMode,
): readonly GpuOverlayCommand[] {
  if (mode === 'none') return [];

  const snapshot = mapServiceOverlay(core, mode);
  const commands: GpuOverlayCommand[] = [];
  for (const item of snapshot.cells) {
    const hue = Math.round(120 * clamp01(item.value));
    commands.push({
      kind: 'cell',
      key: `service:${mode}:${item.buildingId}`,
      x: item.x,
      y: item.y,
      fill: `hsl(${hue},82%,52%)`,
      alpha: 0.42,
      label: item.label,
    });
    commands.push({
      kind: 'label',
      key: `service:${mode}:${item.buildingId}:label`,
      x: item.x,
      y: item.y,
      text: item.label,
      minTileWidth: 40,
    });
  }
  return commands;
}

const transitDash = (mode: string): readonly number[] =>
  mode === 'brt'
    ? [9, 4]
    : mode === 'tram'
      ? [3, 4]
      : mode === 'metro'
        ? [12, 4, 3, 4]
        : [];

const transitColor = (mode: string): string =>
  mode === 'metro'
    ? '#bb8cff'
    : mode === 'tram'
      ? '#ffb65f'
      : mode === 'brt'
        ? '#59d8c4'
        : '#68a8ff';

export function buildTransitOverlayCommands(
  core: SimulationCore,
  mode: TransitOverlayMode,
): readonly GpuOverlayCommand[] {
  if (mode === 'none') return [];

  const snapshot = mapTransitOverlay(core, mode);
  const routeMax = Math.max(1, ...snapshot.routes.map((route) => route.value));
  const commands: GpuOverlayCommand[] = [];

  for (const route of snapshot.routes) {
    const normalized =
      mode === 'ridership'
        ? Math.max(0.12, route.value / routeMax)
        : mode === 'crowding' || mode === 'reliability'
          ? Math.max(0.12, route.value)
          : 0.55;
    const stops = route.stopIds
      .map((stopId) => core.transit.getStop(stopId))
      .filter((stop) => stop !== undefined);
    for (let index = 1; index < stops.length; index += 1) {
      const from = stops[index - 1]!;
      const to = stops[index]!;
      commands.push({
        kind: 'segment',
        key: `transit:${route.lineId}:segment:${index - 1}`,
        from: { x: from.x, y: from.y },
        to: { x: to.x, y: to.y },
        color: transitColor(route.mode),
        widthFactor: 0.04 + normalized * 0.04,
        dash: transitDash(route.mode),
      });
    }
  }

  for (const item of snapshot.stops) {
    const stop = core.transit.getStop(item.stopId);
    if (!stop) continue;
    const metro = stop.type === 'metro_station';
    commands.push({
      kind: 'marker',
      key: `transit:stop:${item.stopId}`,
      x: item.x,
      y: item.y,
      marker: metro ? 'metro-station' : 'stop',
      color: metro ? '#c8a6ff' : '#dcebf2',
    });
    if (mode === 'wait') {
      commands.push({
        kind: 'label',
        key: `transit:stop:${item.stopId}:wait-label`,
        x: item.x,
        y: item.y,
        text: item.label,
        minTileWidth: 40,
      });
    }
  }

  return commands;
}

export function buildEconomyOverlayCommands(
  core: SimulationCore,
  mode: EconomyOverlayMode,
): readonly GpuOverlayCommand[] {
  const snapshot = mapEconomyOverlay(core, mode);
  const routeMax = Math.max(1, ...snapshot.routes.map((route) => route.value));
  const commands: GpuOverlayCommand[] = [];

  for (const item of snapshot.cells) {
    commands.push({
      kind: 'cell',
      key: `economy:${mode}:${item.firmId}`,
      x: item.x,
      y: item.y,
      fill: '#eeb149',
      alpha: 0.18 + clamp01(item.value) * 0.5,
      label: item.label,
    });
    commands.push({
      kind: 'label',
      key: `economy:${mode}:${item.firmId}:label`,
      x: item.x,
      y: item.y,
      text: item.label,
      minTileWidth: 40,
    });
  }

  for (const route of snapshot.routes) {
    for (const edgeId of route.edgeIds) {
      const edge = core.transportationGraph.getEdge(edgeId);
      const from = edge ? core.transportationGraph.getNode(edge.from) : undefined;
      const to = edge ? core.transportationGraph.getNode(edge.to) : undefined;
      if (!edge || !from || !to) continue;
      commands.push({
        kind: 'segment',
        key: `economy:${mode}:${route.vehicleId}:${edgeId}`,
        from: { x: from.x, y: from.y },
        to: { x: to.x, y: to.y },
        color: '#d9a64a',
        widthFactor: 0.03 + 0.04 * clamp01(route.value / routeMax),
        dash: mode === 'freight-routes' ? [7, 4] : [],
      });
    }
  }

  for (const gateway of snapshot.gateways) {
    commands.push({
      kind: 'marker',
      key: `economy:${mode}:${gateway.gatewayId}`,
      x: gateway.x,
      y: gateway.y,
      marker: 'gateway',
      color: '#f1c36e',
    });
  }

  return commands;
}

export function buildCadastralOverlayCommands(
  core: SimulationCore,
  selectedParcelId: string | null,
): readonly GpuOverlayCommand[] {
  const snapshot = mapCadastralOverlay(core);
  const commands: GpuOverlayCommand[] = [];

  for (const block of snapshot.blocks) {
    commands.push({
      kind: 'ring',
      key: `cadastre:block:${block.blockId}`,
      points: copyPoints(block.boundary),
      stroke: '#7d8990',
      strokeWidth: 1.2,
    });
  }

  for (const parcel of snapshot.parcels) {
    commands.push({
      kind: 'ring',
      key: `cadastre:parcel:${parcel.parcelId}`,
      points: copyPoints(parcel.boundary),
      stroke: parcel.parcelId === selectedParcelId ? '#ffffff' : '#c5d0d5',
      strokeWidth: 1.6,
    });
    for (const segment of parcel.frontage) {
      commands.push({
        kind: 'segment',
        key: `cadastre:frontage:${parcel.parcelId}:${segment.edgeId}`,
        from: { ...segment.from },
        to: { ...segment.to },
        color: '#59d8c4',
        widthFactor: 3,
      });
    }
    for (const segment of parcel.access) {
      commands.push({
        kind: 'segment',
        key: `cadastre:access:${parcel.parcelId}:${segment.edgeId}`,
        from: { ...segment.from },
        to: { ...segment.to },
        color: '#f1c36e',
        widthFactor: 2,
        dash: [5, 3],
      });
    }
  }

  return commands;
}

export function buildZoningEnvelopeCommands(
  core: SimulationCore,
  selectedParcelId: string | null,
): readonly GpuOverlayCommand[] {
  if (!selectedParcelId) return [];

  const snapshot = mapZoningEnvelope(core, selectedParcelId);
  const center = ringCenter(snapshot.buildableFootprint);
  return [
    {
      kind: 'ring',
      key: `zoning-envelope:parcel:${snapshot.parcelId}`,
      points: copyPoints(snapshot.parcelBoundary),
      fill: '#df5c5c',
      fillAlpha: 0.22,
      stroke: '#f08b8b',
      strokeWidth: 1.6,
    },
    {
      kind: 'ring',
      key: `zoning-envelope:buildable:${snapshot.parcelId}`,
      points: copyPoints(snapshot.buildableFootprint),
      fill: '#59d8c4',
      fillAlpha: 0.32,
      stroke: '#59d8c4',
      strokeWidth: 2.2,
    },
    {
      kind: 'label',
      key: `zoning-envelope:height:${snapshot.parcelId}`,
      x: center.x,
      y: center.y,
      text: `${Math.round(snapshot.maxHeightMeters)}m`,
      minTileWidth: 0,
    },
  ];
}

function copyPoints(points: readonly GpuOverlayPoint[]): readonly GpuOverlayPoint[] {
  return points.map((point) => ({ x: point.x, y: point.y }));
}

function ringCenter(points: readonly GpuOverlayPoint[]): GpuOverlayPoint {
  if (points.length === 0) return { x: 0, y: 0 };
  const total = points.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 },
  );
  return { x: total.x / points.length, y: total.y / points.length };
}
