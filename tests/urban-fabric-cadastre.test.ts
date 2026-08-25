import test from 'node:test';
import assert from 'node:assert/strict';
import { CadastralGraph } from '../src/world/cadastre/CadastralGraph.ts';
import { validateCadastralGraph } from '../src/world/cadastre/CadastralValidator.ts';
import type { CadastralSnapshot } from '../src/world/cadastre/CadastralTypes.ts';

const snapshot: CadastralSnapshot = {
  nodes: [
    { id: 'n0', point: { x: 0, y: 0 } },
    { id: 'n1', point: { x: 20, y: 0 } },
    { id: 'n2', point: { x: 20, y: 20 } },
    { id: 'n3', point: { x: 0, y: 20 } },
  ],
  edges: [
    { id: 'e0', fromNodeId: 'n0', toNodeId: 'n1', leftParcelId: 'p0', kind: 'street-frontage', roadRef: '0,-1' },
    { id: 'e1', fromNodeId: 'n1', toNodeId: 'n2', leftParcelId: 'p0', kind: 'property-boundary' },
    { id: 'e2', fromNodeId: 'n2', toNodeId: 'n3', leftParcelId: 'p0', kind: 'property-boundary' },
    { id: 'e3', fromNodeId: 'n3', toNodeId: 'n0', leftParcelId: 'p0', kind: 'property-boundary' },
  ],
  blocks: [{
    id: 'b0',
    boundary: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }],
    parcelIds: ['p0'],
    roadEdgeIds: ['e0'],
  }],
  parcels: [{
    id: 'p0',
    blockId: 'b0',
    boundaryEdgeIds: ['e0', 'e1', 'e2', 'e3'],
    areaM2: 400,
    centroid: { x: 10, y: 10 },
    frontageEdgeIds: ['e0'],
    accessEdgeIds: ['e0'],
    zoningDistrictId: 'R2',
    historicalParentIds: [],
  }],
  easements: [],
  lineage: [],
};

test('cadastral graph round-trips a valid parcel', () => {
  const graph = new CadastralGraph(snapshot);
  assert.equal(graph.getParcel('p0')?.areaM2, 400);
  assert.deepEqual(graph.parcelPolygon('p0'), snapshot.blocks[0]!.boundary);
  assert.deepEqual(graph.adjacentParcelIds('p0'), []);
  assert.deepEqual(validateCadastralGraph(graph), { valid: true, errors: [] });
  assert.deepEqual(graph.snapshot(), snapshot);
});

test('replaceSnapshot rejects invalid area without mutating canonical state', () => {
  const graph = new CadastralGraph(snapshot);
  const before = graph.snapshot();
  const invalid: CadastralSnapshot = {
    ...snapshot,
    parcels: [{ ...snapshot.parcels[0]!, areaM2: 399 }],
  };
  assert.throws(() => graph.replaceSnapshot(invalid), /parcel-area-mismatch/);
  assert.deepEqual(graph.snapshot(), before);
});

test('constructor rejects missing nodes and orphaned topology', () => {
  const invalid: CadastralSnapshot = {
    ...snapshot,
    nodes: snapshot.nodes.slice(0, 3),
  };
  assert.throws(() => new CadastralGraph(invalid), /missing-node|orphan-node|parcel-boundary-invalid/);
});

test('shared edge produces symmetric deterministic adjacency', () => {
  const shared: CadastralSnapshot = {
    nodes: [
      { id: 'n0', point: { x: 0, y: 0 } },
      { id: 'n1', point: { x: 20, y: 0 } },
      { id: 'n2', point: { x: 40, y: 0 } },
      { id: 'n3', point: { x: 40, y: 20 } },
      { id: 'n4', point: { x: 20, y: 20 } },
      { id: 'n5', point: { x: 0, y: 20 } },
    ],
    edges: [
      { id: 'a0', fromNodeId: 'n0', toNodeId: 'n1', leftParcelId: 'pa', kind: 'street-frontage', roadRef: 'south' },
      { id: 'a1', fromNodeId: 'n1', toNodeId: 'n4', leftParcelId: 'pa', rightParcelId: 'pb', kind: 'property-boundary' },
      { id: 'a2', fromNodeId: 'n4', toNodeId: 'n5', leftParcelId: 'pa', kind: 'property-boundary' },
      { id: 'a3', fromNodeId: 'n5', toNodeId: 'n0', leftParcelId: 'pa', kind: 'property-boundary' },
      { id: 'b0', fromNodeId: 'n1', toNodeId: 'n2', leftParcelId: 'pb', kind: 'street-frontage', roadRef: 'south' },
      { id: 'b1', fromNodeId: 'n2', toNodeId: 'n3', leftParcelId: 'pb', kind: 'property-boundary' },
      { id: 'b2', fromNodeId: 'n3', toNodeId: 'n4', leftParcelId: 'pb', kind: 'property-boundary' },
    ],
    blocks: [{
      id: 'block',
      boundary: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }],
      parcelIds: ['pa', 'pb'],
      roadEdgeIds: ['a0', 'b0'],
    }],
    parcels: [
      {
        id: 'pa', blockId: 'block', boundaryEdgeIds: ['a0', 'a1', 'a2', 'a3'], areaM2: 400,
        centroid: { x: 10, y: 10 }, frontageEdgeIds: ['a0'], accessEdgeIds: ['a0'], zoningDistrictId: 'R2', historicalParentIds: [],
      },
      {
        id: 'pb', blockId: 'block', boundaryEdgeIds: ['b0', 'b1', 'b2', 'a1'], areaM2: 400,
        centroid: { x: 30, y: 10 }, frontageEdgeIds: ['b0'], accessEdgeIds: ['b0'], zoningDistrictId: 'R2', historicalParentIds: [],
      },
    ],
    easements: [],
    lineage: [],
  };
  const graph = new CadastralGraph(shared);
  assert.deepEqual(graph.adjacentParcelIds('pa'), ['pb']);
  assert.deepEqual(graph.adjacentParcelIds('pb'), ['pa']);
});
