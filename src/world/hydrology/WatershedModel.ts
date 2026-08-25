import type { WatershedId } from '../terrain/TerrainTypes.ts';
import type { ChannelSegment, WatershedRecord } from './HydrologyTypes.ts';
import { DrainageGraph } from './DrainageGraph.ts';

export type WatershedComputation = Readonly<{
  flowAccumulation: readonly number[];
  watershedIds: readonly WatershedId[];
  watersheds: readonly WatershedRecord[];
  channels: readonly ChannelSegment[];
}>;

function ordinal(index: number, width = 4): string { return index.toString().padStart(width, '0'); }

export function computeAccumulation(graph: DrainageGraph): readonly number[] {
  const count = graph.width * graph.height;
  const accumulation = new Float64Array(count);
  accumulation.fill(1);
  for (const index of graph.topologicalOrder()) {
    const receiver = graph.receiverIndex(index);
    if (receiver !== null) accumulation[receiver] = accumulation[receiver]! + accumulation[index]!;
  }
  return Object.freeze(Array.from(accumulation));
}

export function buildWatersheds(graph: DrainageGraph, metersPerCell: number): WatershedComputation {
  const count = graph.width * graph.height;
  const accumulation = computeAccumulation(graph);
  const outletByIndex = new Int32Array(count); outletByIndex.fill(-1);

  const resolveOutlet = (start: number): number => {
    if (outletByIndex[start]! >= 0) return outletByIndex[start]!;
    const path: number[] = [];
    let current = start;
    while (outletByIndex[current]! < 0) {
      path.push(current);
      const receiver = graph.receiverIndex(current);
      if (receiver === null) {
        outletByIndex[current] = current;
        break;
      }
      current = receiver;
    }
    const outlet = outletByIndex[current]!;
    for (const index of path) outletByIndex[index] = outlet;
    return outlet;
  };

  const outletSet = new Set<number>();
  for (let index = 0; index < count; index++) outletSet.add(resolveOutlet(index));
  const outlets = [...outletSet].sort((a, b) => a - b);
  const idByOutlet = new Map<number, WatershedId>();
  outlets.forEach((outlet, index) => idByOutlet.set(outlet, `watershed:${ordinal(index)}`));
  const watershedIds: WatershedId[] = Array.from({ length: count }, (_, index) => idByOutlet.get(outletByIndex[index]!)!);

  const channelThreshold = Math.max(12, Math.floor(count * 0.015));
  const cellAreaM2 = metersPerCell * metersPerCell;
  const channels: ChannelSegment[] = [];
  for (let index = 0; index < count; index++) {
    const receiver = graph.receiverIndex(index);
    if (receiver === null || accumulation[index]! < channelThreshold) continue;
    channels.push(Object.freeze({
      id: `channel:${ordinal(index, 6)}`,
      fromIndex: index,
      toIndex: receiver,
      accumulation: accumulation[index]!,
      capacityVolumeM3: Number((cellAreaM2 * 0.02 * Math.sqrt(accumulation[index]!)).toFixed(6)),
    }));
  }
  channels.sort((a, b) => a.fromIndex - b.fromIndex);

  const watersheds: WatershedRecord[] = outlets.map((outlet) => {
    const id = idByOutlet.get(outlet)!;
    let memberCount = 0;
    for (const item of watershedIds) if (item === id) memberCount++;
    const candidates = channels.filter((channel) => watershedIds[channel.fromIndex] === id)
      .sort((a, b) => b.accumulation - a.accumulation || a.id.localeCompare(b.id));
    return Object.freeze({
      id,
      outletIndex: outlet,
      memberCount,
      upstreamAreaCells: accumulation[outlet]!,
      primaryChannelId: candidates[0]?.id ?? null,
    });
  });

  return Object.freeze({
    flowAccumulation: Object.freeze(accumulation.slice()),
    watershedIds: Object.freeze(watershedIds.slice()),
    watersheds: Object.freeze(watersheds),
    channels: Object.freeze(channels),
  });
}
