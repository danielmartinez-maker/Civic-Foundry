import type { PrismP2AImportEnvelopeV1 } from './P2AEnvelope.ts';

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const U64_MASK = 0xffffffffffffffffn;
const textEncoder = new TextEncoder();

type HashPayload = Pick<PrismP2AImportEnvelopeV1, 'world' | 'cadastre'>;

const TAG = {
  World: 1,
  WorldConfig: 2,
  Terrain: 3,
  TerrainSample: 4,
  Hydrology: 5,
  Watershed: 6,
  Channel: 7,
  Geography: 8,
  GeographyEntity: 9,
  Polygon: 10,
  Point: 11,
  LegacyTerrain: 12,
  TerrainCell: 13,
  FloodResult: 14,
  Cadastre: 20,
  ParcelNode: 21,
  ParcelEdge: 22,
  UrbanBlock: 23,
  Parcel: 24,
  Easement: 25,
  Lineage: 26,
} as const;

type Tag = (typeof TAG)[keyof typeof TAG];

class CanonicalByteWriter {
  readonly #bytes: number[] = [];

  finish(): Uint8Array {
    return Uint8Array.from(this.#bytes);
  }

  tag(tag: Tag): void {
    this.u8(tag);
  }

  u8(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xff) {
      throw new Error(`PrismCanonicalHashV1 expected u8, found ${value}`);
    }
    this.#bytes.push(value);
  }

  u32(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
      throw new Error(`PrismCanonicalHashV1 expected u32, found ${value}`);
    }
    const buffer = new ArrayBuffer(4);
    new DataView(buffer).setUint32(0, value, true);
    this.#append(new Uint8Array(buffer));
  }

  i64(value: number): void {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`PrismCanonicalHashV1 expected safe integer i64, found ${value}`);
    }
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setBigInt64(0, BigInt(value), true);
    this.#append(new Uint8Array(buffer));
  }

  u64(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`PrismCanonicalHashV1 expected safe integer u64, found ${value}`);
    }
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setBigUint64(0, BigInt(value), true);
    this.#append(new Uint8Array(buffer));
  }

  f64(value: number): void {
    if (!Number.isFinite(value)) {
      throw new Error(`PrismCanonicalHashV1 requires finite f64 values, found ${value}`);
    }
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setFloat64(0, value === 0 ? 0 : value, true);
    this.#append(new Uint8Array(buffer));
  }

  bool(value: boolean): void {
    this.u8(value ? 1 : 0);
  }

  string(value: string): void {
    const bytes = textEncoder.encode(value);
    this.u32(bytes.byteLength);
    this.#append(bytes);
  }

  option<T>(value: T | null | undefined, write: (value: T) => void): void {
    if (value === null || value === undefined) {
      this.u8(0);
      return;
    }
    this.u8(1);
    write(value);
  }

  array<T>(values: readonly T[], write: (value: T) => void): void {
    this.u32(values.length);
    for (const value of values) write(value);
  }

  #append(bytes: Uint8Array): void {
    for (const byte of bytes) this.#bytes.push(byte);
  }
}

export function fnv1a64Hex(bytes: Uint8Array): string {
  let hash = FNV_OFFSET;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & U64_MASK;
  }
  return hash.toString(16).padStart(16, '0');
}

export function prismCanonicalHashV1(value: HashPayload): string {
  const writer = new CanonicalByteWriter();
  writeWorld(writer, value.world);
  writeCadastre(writer, value.cadastre);
  return fnv1a64Hex(writer.finish());
}

function compareUtf8Strings(left: string, right: string): number {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index] - rightBytes[index];
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

function sortedById<T extends { readonly id: string }>(values: readonly T[]): T[] {
  return [...values].sort((left, right) => compareUtf8Strings(left.id, right.id));
}

function sortedStrings(values: readonly string[]): string[] {
  return [...values].sort(compareUtf8Strings);
}

function writeWorld(writer: CanonicalByteWriter, world: HashPayload['world']): void {
  writer.tag(TAG.World);
  writer.string(world.mode);
  writer.i64(world.seed);

  writer.tag(TAG.WorldConfig);
  writer.u32(world.config.width);
  writer.u32(world.config.height);
  writer.f64(world.config.metersPerCell);
  writer.string(world.config.preset);

  writer.option(world.scenarioId, (scenarioId) => writer.string(scenarioId));

  writer.tag(TAG.Terrain);
  writer.u32(world.terrain.width);
  writer.u32(world.terrain.height);
  writer.f64(world.terrain.metersPerCell);
  writer.array(world.terrain.samples, (sample) => {
    writer.tag(TAG.TerrainSample);
    writer.f64(sample.elevationMeters);
    writer.f64(sample.slope);
    writer.f64(sample.aspectRadians);
    writer.string(sample.soilClass);
    writer.f64(sample.soilDepthMeters);
    writer.f64(sample.bearingCapacityKpa);
    writer.f64(sample.bedrockDepthMeters);
    writer.f64(sample.groundwaterDepthMeters);
    writer.string(sample.vegetationClass);
    writer.f64(sample.contaminationIndex);
    writer.f64(sample.landPreparationMultiplier);
    writer.string(sample.surfaceWater);
    writer.bool(sample.buildable);
  });

  writer.tag(TAG.Hydrology);
  writer.u32(world.hydrology.width);
  writer.u32(world.hydrology.height);
  writer.array(world.hydrology.conditionedElevationMeters, (item) => writer.f64(item));
  writer.array(world.hydrology.receiver, (item) => writer.option(item, (index) => writer.u32(index)));
  writer.array(sortedById(world.hydrology.watersheds), (watershed) => {
    writer.tag(TAG.Watershed);
    writer.string(watershed.id);
    writer.u32(watershed.outletIndex);
    writer.u32(watershed.memberCount);
    writer.u32(watershed.upstreamAreaCells);
    writer.option(watershed.primaryChannelId, (channelId) => writer.string(channelId));
  });
  writer.array(sortedById(world.hydrology.channels), (channel) => {
    writer.tag(TAG.Channel);
    writer.string(channel.id);
    writer.u32(channel.fromIndex);
    writer.u32(channel.toIndex);
    writer.f64(channel.accumulation);
    writer.f64(channel.capacityVolumeM3);
  });
  writer.array(world.hydrology.flowAccumulation, (item) => writer.f64(item));
  writer.array(world.hydrology.watershedIds, (item) => writer.string(item));
  writer.array(world.hydrology.floodSusceptibility, (item) => writer.f64(item));

  writer.tag(TAG.Geography);
  const geography = [...world.geography.entities].sort((left, right) => {
    const sortKey = compareUtf8Strings(left.sortKey, right.sortKey);
    return sortKey !== 0 ? sortKey : compareUtf8Strings(left.id, right.id);
  });
  writer.array(geography, (entity) => {
    writer.tag(TAG.GeographyEntity);
    writer.string(entity.id);
    writer.string(entity.kind);
    writer.option(entity.parentId, (parentId) => writer.string(parentId));
    writer.tag(TAG.Polygon);
    writer.array(entity.boundary.points, (point) => writePoint(writer, point));
    writer.option(entity.name, (name) => writer.string(name));
    writer.string(entity.sortKey);
  });

  writer.option(world.legacyCompatibility, (legacy) => {
    writer.tag(TAG.LegacyTerrain);
    writer.u32(legacy.width);
    writer.u32(legacy.height);
    writer.array(legacy.cells, (cell) => {
      writer.tag(TAG.TerrainCell);
      writer.f64(cell.elevation);
      writer.bool(cell.water);
      writer.bool(cell.buildable);
      writer.string(cell.biome);
    });
  });

  writer.option(world.lastFloodResult, (flood) => {
    writer.tag(TAG.FloodResult);
    writer.string(flood.eventId);
    writer.array(flood.depthMeters, (depth) => writer.f64(depth));
    writer.f64(flood.rainfallVolume);
    writer.f64(flood.infiltrationVolume);
    writer.f64(flood.retainedChannelSurfaceVolume);
    writer.f64(flood.overbankFloodVolume);
    writer.f64(flood.exportedVolume);
    writer.f64(flood.balanceError);
  });
}

function writeCadastre(writer: CanonicalByteWriter, cadastre: HashPayload['cadastre']): void {
  writer.tag(TAG.Cadastre);

  writer.array(sortedById(cadastre.nodes), (node) => {
    writer.tag(TAG.ParcelNode);
    writer.string(node.id);
    writePoint(writer, node.point);
  });

  writer.array(sortedById(cadastre.edges), (edge) => {
    writer.tag(TAG.ParcelEdge);
    writer.string(edge.id);
    writer.string(edge.fromNodeId);
    writer.string(edge.toNodeId);
    writer.option(edge.leftParcelId, (parcelId) => writer.string(parcelId));
    writer.option(edge.rightParcelId, (parcelId) => writer.string(parcelId));
    writer.string(edge.kind);
    writer.option(edge.roadRef, (roadRef) => writer.string(roadRef));
  });

  writer.array(sortedById(cadastre.blocks), (block) => {
    writer.tag(TAG.UrbanBlock);
    writer.string(block.id);
    writer.array(block.boundary, (point) => writePoint(writer, point));
    writer.array(sortedStrings(block.parcelIds), (parcelId) => writer.string(parcelId));
    writer.array(sortedStrings(block.roadEdgeIds), (edgeId) => writer.string(edgeId));
  });

  writer.array(sortedById(cadastre.parcels), (parcel) => {
    writer.tag(TAG.Parcel);
    writer.string(parcel.id);
    writer.string(parcel.blockId);
    writer.array(parcel.boundaryEdgeIds, (edgeId) => writer.string(edgeId));
    writer.f64(parcel.areaM2);
    writePoint(writer, parcel.centroid);
    writer.array(sortedStrings(parcel.frontageEdgeIds), (edgeId) => writer.string(edgeId));
    writer.array(sortedStrings(parcel.accessEdgeIds), (edgeId) => writer.string(edgeId));
    writer.string(parcel.zoningDistrictId);
    writer.option(parcel.ownerId, (ownerId) => writer.string(ownerId));
    writer.array(sortedStrings(parcel.historicalParentIds), (parcelId) => writer.string(parcelId));
  });

  writer.array(sortedById(cadastre.easements), (easement) => {
    writer.tag(TAG.Easement);
    writer.string(easement.id);
    writer.array(sortedStrings(easement.parcelIds), (parcelId) => writer.string(parcelId));
    writer.string(easement.kind);
    writer.array(easement.geometry, (point) => writePoint(writer, point));
  });

  const lineage = [...cadastre.lineage].sort((left, right) => {
    if (left.tick !== right.tick) return left.tick - right.tick;
    return compareUtf8Strings(left.id, right.id);
  });
  writer.array(lineage, (event) => {
    writer.tag(TAG.Lineage);
    writer.string(event.id);
    writer.u64(event.tick);
    writer.string(event.kind);
    writer.array(sortedStrings(event.sourceParcelIds), (parcelId) => writer.string(parcelId));
    writer.array(sortedStrings(event.resultingParcelIds), (parcelId) => writer.string(parcelId));
  });
}

function writePoint(writer: CanonicalByteWriter, point: { readonly x: number; readonly y: number }): void {
  writer.tag(TAG.Point);
  writer.f64(point.x);
  writer.f64(point.y);
}
