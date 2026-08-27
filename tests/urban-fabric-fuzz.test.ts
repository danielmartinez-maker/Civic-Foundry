import test from 'node:test';
import assert from 'node:assert/strict';
import { CadastralGraph } from '../src/world/cadastre/CadastralGraph.ts';
import { CadastralMutationSystem } from '../src/world/cadastre/CadastralMutationSystem.ts';
import { polygonArea, type PolygonRing } from '../src/world/cadastre/Geometry.ts';
import type { CadastralSnapshot, Parcel } from '../src/world/cadastre/CadastralTypes.ts';
import { validateCadastralGraph } from '../src/world/cadastre/CadastralValidator.ts';

const FUZZ_SEEDS = [3, 7, 11, 19, 31, 47, 73, 101] as const;
const AREA_TOLERANCE_M2 = 0.05;
const EPSILON = 1e-7;

test('deterministic cadastral mutation fuzz preserves topology and controlled land area', () => {
  for (const seed of FUZZ_SEEDS) {
    const graph = new CadastralGraph(rowParcelFixture());
    const mutation = new CadastralMutationSystem(graph);
    const random = seededRandom(seed);
    const originalControlledArea = privateLandArea(graph);
    let dedicatedRightOfWayArea = 0;
    let committedMutations = 0;

    for (let step = 0; step < 80; step += 1) {
      const operation = step < 5 ? step : random() % 5;
      const result = runMutation(operation, graph, mutation, random);
      if (result.committed) {
        committedMutations += 1;
        dedicatedRightOfWayArea += result.dedicatedRightOfWayArea;
      }

      const validation = validateCadastralGraph(graph);
      assert.equal(
        validation.valid,
        true,
        `seed ${seed} step ${step}: ${validation.errors.map((error) => `${error.code}:${error.message}`).join(',')}`,
      );
      assert.deepEqual(new CadastralGraph(graph.snapshot()).snapshot(), graph.snapshot(), `seed ${seed} step ${step} round-trip`);
    }

    assert.ok(committedMutations >= 8, `seed ${seed} exercised only ${committedMutations} committed mutations`);
    const finalControlledArea = privateLandArea(graph) + dedicatedRightOfWayArea;
    assert.ok(
      Math.abs(finalControlledArea - originalControlledArea) <= AREA_TOLERANCE_M2,
      `seed ${seed} area drift: original=${originalControlledArea}, final=${finalControlledArea}`,
    );
  }
});

type MutationAttempt = Readonly<{
  committed: boolean;
  dedicatedRightOfWayArea: number;
}>;

function runMutation(
  operation: number,
  graph: CadastralGraph,
  mutation: CadastralMutationSystem,
  random: () => number,
): MutationAttempt {
  const attempts = [operation, (operation + 1) % 5, (operation + 2) % 5, (operation + 3) % 5, (operation + 4) % 5];
  for (const candidate of attempts) {
    const result = candidate === 0 ? trySplit(graph, mutation, random)
      : candidate === 1 ? tryCreateEasement(graph, mutation, random)
      : candidate === 2 ? tryRemoveEasement(graph, mutation, random)
      : candidate === 3 ? tryAssembly(graph, mutation, random)
      : tryRightOfWay(graph, mutation, random);
    if (result !== null) return result;
  }
  return Object.freeze({ committed: false, dedicatedRightOfWayArea: 0 });
}

function trySplit(
  graph: CadastralGraph,
  mutation: CadastralMutationSystem,
  random: () => number,
): MutationAttempt | null {
  const easementParcelIds = new Set(graph.listEasements().flatMap((easement) => easement.parcelIds));
  const candidates = graph.listParcels()
    .filter((parcel) => !easementParcelIds.has(parcel.id))
    .map((parcel) => ({ parcel, rectangle: rectangleOf(graph.parcelPolygon(parcel.id)) }))
    .filter((entry): entry is { parcel: Parcel; rectangle: Rectangle } => entry.rectangle !== null)
    .filter(({ rectangle }) => rectangle.width >= 4 || rectangle.height >= 4)
    .sort((left, right) => left.parcel.id.localeCompare(right.parcel.id));
  if (candidates.length === 0) return null;

  const selected = candidates[random() % candidates.length]!;
  const splitVertically = selected.rectangle.width >= 4
    && (selected.rectangle.height < 4 || random() % 2 === 0);
  const cut = splitVertically
    ? [
      { x: midpoint(selected.rectangle.minX, selected.rectangle.maxX), y: selected.rectangle.minY },
      { x: midpoint(selected.rectangle.minX, selected.rectangle.maxX), y: selected.rectangle.maxY },
    ]
    : [
      { x: selected.rectangle.minX, y: midpoint(selected.rectangle.minY, selected.rectangle.maxY) },
      { x: selected.rectangle.maxX, y: midpoint(selected.rectangle.minY, selected.rectangle.maxY) },
    ];
  const result = mutation.splitParcel(selected.parcel.id, cut);
  return Object.freeze({ committed: result.committed, dedicatedRightOfWayArea: 0 });
}

function tryCreateEasement(
  graph: CadastralGraph,
  mutation: CadastralMutationSystem,
  random: () => number,
): MutationAttempt | null {
  const easementParcelIds = new Set(graph.listEasements().flatMap((easement) => easement.parcelIds));
  const candidates = graph.listParcels()
    .filter((parcel) => !easementParcelIds.has(parcel.id))
    .map((parcel) => ({ parcel, rectangle: rectangleOf(graph.parcelPolygon(parcel.id)) }))
    .filter((entry): entry is { parcel: Parcel; rectangle: Rectangle } => entry.rectangle !== null)
    .filter(({ rectangle }) => rectangle.width >= 1 && rectangle.height >= 1)
    .sort((left, right) => left.parcel.id.localeCompare(right.parcel.id));
  if (candidates.length === 0) return null;

  const selected = candidates[random() % candidates.length]!;
  const { minX, maxX, minY, maxY } = selected.rectangle;
  const x = midpoint(minX, maxX);
  const result = mutation.createEasement([selected.parcel.id], 'utility', [
    { x, y: minY + (maxY - minY) * 0.25 },
    { x, y: minY + (maxY - minY) * 0.75 },
  ]);
  return Object.freeze({ committed: result.committed, dedicatedRightOfWayArea: 0 });
}

function tryRemoveEasement(
  graph: CadastralGraph,
  mutation: CadastralMutationSystem,
  random: () => number,
): MutationAttempt | null {
  const easements = [...graph.listEasements()].sort((left, right) => left.id.localeCompare(right.id));
  if (easements.length === 0) return null;
  const result = mutation.removeEasement(easements[random() % easements.length]!.id);
  return Object.freeze({ committed: result.committed, dedicatedRightOfWayArea: 0 });
}

function tryAssembly(
  graph: CadastralGraph,
  mutation: CadastralMutationSystem,
  random: () => number,
): MutationAttempt | null {
  const easementParcelIds = new Set(graph.listEasements().flatMap((easement) => easement.parcelIds));
  const pairs: Array<readonly [string, string]> = [];
  for (const parcel of [...graph.listParcels()].sort((left, right) => left.id.localeCompare(right.id))) {
    if (easementParcelIds.has(parcel.id)) continue;
    for (const adjacentId of graph.adjacentParcelIds(parcel.id)) {
      if (parcel.id >= adjacentId || easementParcelIds.has(adjacentId)) continue;
      const adjacent = graph.getParcel(adjacentId);
      if (!adjacent || parcel.blockId !== adjacent.blockId || parcel.zoningDistrictId !== adjacent.zoningDistrictId || parcel.ownerId !== adjacent.ownerId) continue;
      if (!formsRectangle(graph.parcelPolygon(parcel.id), graph.parcelPolygon(adjacentId))) continue;
      pairs.push(Object.freeze([parcel.id, adjacentId]));
    }
  }
  if (pairs.length === 0) return null;
  pairs.sort((left, right) => `${left[0]}|${left[1]}`.localeCompare(`${right[0]}|${right[1]}`));
  const pair = pairs[random() % pairs.length]!;
  const result = mutation.assembleParcels(pair);
  return Object.freeze({ committed: result.committed, dedicatedRightOfWayArea: 0 });
}

function tryRightOfWay(
  graph: CadastralGraph,
  mutation: CadastralMutationSystem,
  random: () => number,
): MutationAttempt | null {
  const easementParcelIds = new Set(graph.listEasements().flatMap((easement) => easement.parcelIds));
  const candidates = graph.listParcels()
    .filter((parcel) => !easementParcelIds.has(parcel.id))
    .map((parcel) => ({ parcel, rectangle: rectangleOf(graph.parcelPolygon(parcel.id)) }))
    .filter((entry): entry is { parcel: Parcel; rectangle: Rectangle } => entry.rectangle !== null)
    .filter(({ rectangle }) => rectangle.minY === 0 && rectangle.height >= 4 && rectangle.width >= 1)
    .sort((left, right) => left.parcel.id.localeCompare(right.parcel.id));
  if (candidates.length === 0) return null;

  const selected = candidates[random() % candidates.length]!;
  const stripHeight = Math.min(1, selected.rectangle.height / 4);
  const dedication: PolygonRing = [
    { x: selected.rectangle.minX, y: selected.rectangle.minY },
    { x: selected.rectangle.maxX, y: selected.rectangle.minY },
    { x: selected.rectangle.maxX, y: selected.rectangle.minY + stripHeight },
    { x: selected.rectangle.minX, y: selected.rectangle.minY + stripHeight },
  ];
  const dedicatedArea = polygonArea(dedication);
  const result = mutation.dedicateRightOfWay(selected.parcel.id, dedication);
  return Object.freeze({
    committed: result.committed,
    dedicatedRightOfWayArea: result.committed ? dedicatedArea : 0,
  });
}

type Rectangle = Readonly<{
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}>;

function rectangleOf(polygon: PolygonRing): Rectangle | null {
  const xs = polygon.map((point) => point.x);
  const ys = polygon.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX;
  const height = maxY - minY;
  if (width <= EPSILON || height <= EPSILON) return null;
  if (Math.abs(polygonArea(polygon) - width * height) > AREA_TOLERANCE_M2) return null;
  return Object.freeze({ minX, maxX, minY, maxY, width, height });
}

function formsRectangle(left: PolygonRing, right: PolygonRing): boolean {
  const points = [...left, ...right];
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const boundingArea = (maxX - minX) * (maxY - minY);
  return Math.abs(polygonArea(left) + polygonArea(right) - boundingArea) <= AREA_TOLERANCE_M2;
}

function privateLandArea(graph: CadastralGraph): number {
  return graph.listParcels().reduce((sum, parcel) => sum + parcel.areaM2, 0);
}

function midpoint(left: number, right: number): number {
  return Math.round(((left + right) / 2) * 100) / 100;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

function rowParcelFixture(): CadastralSnapshot {
  const parcelCount = 4;
  const cellWidth = 20;
  const height = 20;
  const nodes = [] as Array<{ id: string; point: { x: number; y: number } }>;
  for (let index = 0; index <= parcelCount; index += 1) {
    nodes.push({ id: `south:${index}`, point: { x: index * cellWidth, y: 0 } });
    nodes.push({ id: `north:${index}`, point: { x: index * cellWidth, y: height } });
  }

  const edges = [] as Array<{
    id: string;
    fromNodeId: string;
    toNodeId: string;
    leftParcelId?: string;
    rightParcelId?: string;
    kind: 'street-frontage' | 'property-boundary';
    roadRef?: string;
  }>;
  for (let index = 0; index < parcelCount; index += 1) {
    edges.push({
      id: `front:${index}`,
      fromNodeId: `south:${index}`,
      toNodeId: `south:${index + 1}`,
      leftParcelId: `p${index}`,
      kind: 'street-frontage',
      roadRef: `south-road:${index}`,
    });
    edges.push({
      id: `top:${index}`,
      fromNodeId: `north:${index + 1}`,
      toNodeId: `north:${index}`,
      leftParcelId: `p${index}`,
      kind: 'property-boundary',
    });
  }
  edges.push({
    id: 'west',
    fromNodeId: 'north:0',
    toNodeId: 'south:0',
    leftParcelId: 'p0',
    kind: 'property-boundary',
  });
  edges.push({
    id: 'east',
    fromNodeId: `south:${parcelCount}`,
    toNodeId: `north:${parcelCount}`,
    leftParcelId: `p${parcelCount - 1}`,
    kind: 'property-boundary',
  });
  for (let index = 1; index < parcelCount; index += 1) {
    edges.push({
      id: `shared:${index}`,
      fromNodeId: `south:${index}`,
      toNodeId: `north:${index}`,
      leftParcelId: `p${index - 1}`,
      rightParcelId: `p${index}`,
      kind: 'property-boundary',
    });
  }

  const parcels = Array.from({ length: parcelCount }, (_, index) => ({
    id: `p${index}`,
    blockId: 'block',
    boundaryEdgeIds: [
      `front:${index}`,
      index === parcelCount - 1 ? 'east' : `shared:${index + 1}`,
      `top:${index}`,
      index === 0 ? 'west' : `shared:${index}`,
    ],
    areaM2: cellWidth * height,
    centroid: { x: index * cellWidth + cellWidth / 2, y: height / 2 },
    frontageEdgeIds: [`front:${index}`],
    accessEdgeIds: [`front:${index}`],
    zoningDistrictId: 'R2',
    ownerId: 'owner:fuzz',
    historicalParentIds: [],
  }));

  return {
    nodes,
    edges,
    blocks: [{
      id: 'block',
      boundary: [{ x: 0, y: 0 }, { x: parcelCount * cellWidth, y: 0 }, { x: parcelCount * cellWidth, y: height }, { x: 0, y: height }],
      parcelIds: parcels.map((parcel) => parcel.id),
      roadEdgeIds: parcels.map((_, index) => `front:${index}`),
    }],
    parcels,
    easements: [],
    lineage: [],
  };
}
