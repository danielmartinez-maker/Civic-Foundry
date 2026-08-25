import test from 'node:test';
import assert from 'node:assert/strict';
import { CadastralGraph } from '../src/world/cadastre/CadastralGraph.ts';
import { CadastralMutationSystem } from '../src/world/cadastre/CadastralMutationSystem.ts';
import type { CadastralSnapshot } from '../src/world/cadastre/CadastralTypes.ts';

test('split conserves area and retires the source parcel with lineage', () => {
  const graph = new CadastralGraph(graph40x20Fixture());
  const result = new CadastralMutationSystem(graph).splitParcel('p0', [
    { x: 20, y: 0 },
    { x: 20, y: 20 },
  ]);

  assert.equal(result.committed, true);
  assert.equal(result.resultingParcelIds.length, 2);
  const children = result.resultingParcelIds.map((id) => graph.getParcel(id)!);
  assert.equal(children.reduce((sum, parcel) => sum + parcel.areaM2, 0), 800);
  assert.equal(graph.getParcel('p0'), undefined);
  assert.deepEqual(result.retiredParcelIds, ['p0']);
  assert.ok(children.every((parcel) => parcel.historicalParentIds.includes('p0')));
  assert.ok(graph.snapshot().lineage.some((event) => event.kind === 'split'
    && event.sourceParcelIds.includes('p0')));
});

test('invalid split is atomic and leaves the entire cadastral snapshot byte-for-byte equivalent', () => {
  const graph = new CadastralGraph(graph40x20Fixture());
  const before = graph.snapshot();
  const result = new CadastralMutationSystem(graph).splitParcel('p0', [
    { x: 0, y: 0 },
    { x: 0.01, y: 0.01 },
  ]);

  assert.equal(result.committed, false);
  assert.equal(result.resultingParcelIds.length, 0);
  assert.deepEqual(graph.snapshot(), before);
});

test('assembly removes the internal boundary and preserves external area and lineage', () => {
  const graph = new CadastralGraph(twoAdjacentParcelFixture());
  const result = new CadastralMutationSystem(graph).assembleParcels(['p1', 'p0']);

  assert.equal(result.committed, true);
  assert.equal(result.resultingParcelIds.length, 1);
  const assembledId = result.resultingParcelIds[0]!;
  const assembled = graph.getParcel(assembledId)!;
  assert.equal(assembled.areaM2, 800);
  assert.deepEqual(result.retiredParcelIds, ['p0', 'p1']);
  assert.equal(graph.getParcel('p0'), undefined);
  assert.equal(graph.getParcel('p1'), undefined);
  assert.deepEqual(assembled.historicalParentIds, ['p0', 'p1']);
  assert.deepEqual(graph.adjacentParcelIds(assembledId), []);
  assert.ok(graph.snapshot().lineage.some((event) => event.kind === 'assembly'
    && event.resultingParcelIds.includes(assembledId)));
});

test('assembly rejects non-adjacent parcels atomically', () => {
  const snapshot = twoAdjacentParcelFixture();
  const isolated: CadastralSnapshot = {
    ...snapshot,
    nodes: [
      ...snapshot.nodes,
      { id: 'n6', point: { x: 60, y: 0 } },
      { id: 'n7', point: { x: 80, y: 0 } },
      { id: 'n8', point: { x: 80, y: 20 } },
      { id: 'n9', point: { x: 60, y: 20 } },
    ],
    edges: [
      ...snapshot.edges,
      { id: 'c0', fromNodeId: 'n6', toNodeId: 'n7', leftParcelId: 'p2', kind: 'street-frontage', roadRef: 'south-2' },
      { id: 'c1', fromNodeId: 'n7', toNodeId: 'n8', leftParcelId: 'p2', kind: 'property-boundary' },
      { id: 'c2', fromNodeId: 'n8', toNodeId: 'n9', leftParcelId: 'p2', kind: 'property-boundary' },
      { id: 'c3', fromNodeId: 'n9', toNodeId: 'n6', leftParcelId: 'p2', kind: 'property-boundary' },
    ],
    blocks: [
      snapshot.blocks[0]!,
      {
        id: 'block-2',
        boundary: [{ x: 60, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 20 }, { x: 60, y: 20 }],
        parcelIds: ['p2'],
        roadEdgeIds: ['c0'],
      },
    ],
    parcels: [
      ...snapshot.parcels,
      {
        id: 'p2', blockId: 'block-2', boundaryEdgeIds: ['c0', 'c1', 'c2', 'c3'], areaM2: 400,
        centroid: { x: 70, y: 10 }, frontageEdgeIds: ['c0'], accessEdgeIds: ['c0'], zoningDistrictId: 'R2', historicalParentIds: [],
      },
    ],
  };
  const graph = new CadastralGraph(isolated);
  const before = graph.snapshot();
  const result = new CadastralMutationSystem(graph).assembleParcels(['p0', 'p2']);

  assert.equal(result.committed, false);
  assert.deepEqual(graph.snapshot(), before);
});

test('easement creation persists legal geometry without retiring the parcel', () => {
  const graph = new CadastralGraph(graph40x20Fixture());
  const mutation = new CadastralMutationSystem(graph);
  const result = mutation.createEasement(['p0'], 'utility', [
    { x: 8, y: 0 },
    { x: 8, y: 20 },
  ]);

  assert.equal(result.committed, true);
  assert.deepEqual(result.retiredParcelIds, []);
  assert.equal(graph.getParcel('p0')?.areaM2, 800);
  const easement = graph.listEasements()[0]!;
  assert.equal(easement.kind, 'utility');
  assert.deepEqual(easement.parcelIds, ['p0']);
  assert.deepEqual(easement.geometry, [{ x: 8, y: 0 }, { x: 8, y: 20 }]);
});

test('easement removal is deterministic and invalid easement geometry is atomic', () => {
  const graph = new CadastralGraph(graph40x20Fixture());
  const mutation = new CadastralMutationSystem(graph);
  assert.equal(mutation.createEasement(['p0'], 'access', [
    { x: 2, y: 0 },
    { x: 2, y: 20 },
  ]).committed, true);
  const easementId = graph.listEasements()[0]!.id;
  assert.equal(mutation.removeEasement(easementId).committed, true);
  assert.deepEqual(graph.listEasements(), []);

  const before = graph.snapshot();
  const invalid = mutation.createEasement(['p0'], 'utility', [
    { x: 50, y: 0 },
    { x: 50, y: 20 },
  ]);
  assert.equal(invalid.committed, false);
  assert.deepEqual(graph.snapshot(), before);
});

test('right-of-way dedication retires the source, conserves residual area, and creates an access boundary', () => {
  const graph = new CadastralGraph(graph40x20Fixture());
  const result = new CadastralMutationSystem(graph).dedicateRightOfWay('p0', [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 4 },
    { x: 0, y: 4 },
  ]);

  assert.equal(result.committed, true);
  assert.deepEqual(result.retiredParcelIds, ['p0']);
  assert.equal(graph.getParcel('p0'), undefined);
  const residualId = result.resultingParcelIds[0]!;
  const residual = graph.getParcel(residualId)!;
  assert.equal(residual.areaM2, 640);
  assert.deepEqual(residual.historicalParentIds, ['p0']);
  const rightOfWayEdges = residual.boundaryEdgeIds
    .map((edgeId) => graph.getEdge(edgeId)!)
    .filter((edge) => edge.kind === 'right-of-way');
  assert.equal(rightOfWayEdges.length, 1);
  assert.ok(residual.accessEdgeIds.includes(rightOfWayEdges[0]!.id));
  assert.ok(graph.listLineage().some((event) => event.kind === 'right-of-way'
    && event.sourceParcelIds.includes('p0')
    && event.resultingParcelIds.includes(residualId)));
});

test('right-of-way dedication outside the parcel fails atomically', () => {
  const graph = new CadastralGraph(graph40x20Fixture());
  const before = graph.snapshot();
  const result = new CadastralMutationSystem(graph).dedicateRightOfWay('p0', [
    { x: 50, y: 0 },
    { x: 60, y: 0 },
    { x: 60, y: 4 },
    { x: 50, y: 4 },
  ]);

  assert.equal(result.committed, false);
  assert.deepEqual(graph.snapshot(), before);
});

function graph40x20Fixture(): CadastralSnapshot {
  return {
    nodes: [
      { id: 'n0', point: { x: 0, y: 0 } },
      { id: 'n1', point: { x: 40, y: 0 } },
      { id: 'n2', point: { x: 40, y: 20 } },
      { id: 'n3', point: { x: 0, y: 20 } },
    ],
    edges: [
      { id: 'e0', fromNodeId: 'n0', toNodeId: 'n1', leftParcelId: 'p0', kind: 'street-frontage', roadRef: 'south' },
      { id: 'e1', fromNodeId: 'n1', toNodeId: 'n2', leftParcelId: 'p0', kind: 'property-boundary' },
      { id: 'e2', fromNodeId: 'n2', toNodeId: 'n3', leftParcelId: 'p0', kind: 'property-boundary' },
      { id: 'e3', fromNodeId: 'n3', toNodeId: 'n0', leftParcelId: 'p0', kind: 'property-boundary' },
    ],
    blocks: [{
      id: 'block',
      boundary: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }],
      parcelIds: ['p0'],
      roadEdgeIds: ['e0'],
    }],
    parcels: [{
      id: 'p0', blockId: 'block', boundaryEdgeIds: ['e0', 'e1', 'e2', 'e3'], areaM2: 800,
      centroid: { x: 20, y: 10 }, frontageEdgeIds: ['e0'], accessEdgeIds: ['e0'], zoningDistrictId: 'R2',
      ownerId: 'owner:a', historicalParentIds: [],
    }],
    easements: [],
    lineage: [],
  };
}

function twoAdjacentParcelFixture(): CadastralSnapshot {
  return {
    nodes: [
      { id: 'n0', point: { x: 0, y: 0 } },
      { id: 'n1', point: { x: 20, y: 0 } },
      { id: 'n2', point: { x: 40, y: 0 } },
      { id: 'n3', point: { x: 40, y: 20 } },
      { id: 'n4', point: { x: 20, y: 20 } },
      { id: 'n5', point: { x: 0, y: 20 } },
    ],
    edges: [
      { id: 'a0', fromNodeId: 'n0', toNodeId: 'n1', leftParcelId: 'p0', kind: 'street-frontage', roadRef: 'south' },
      { id: 'shared', fromNodeId: 'n1', toNodeId: 'n4', leftParcelId: 'p0', rightParcelId: 'p1', kind: 'property-boundary' },
      { id: 'a2', fromNodeId: 'n4', toNodeId: 'n5', leftParcelId: 'p0', kind: 'property-boundary' },
      { id: 'a3', fromNodeId: 'n5', toNodeId: 'n0', leftParcelId: 'p0', kind: 'property-boundary' },
      { id: 'b0', fromNodeId: 'n1', toNodeId: 'n2', leftParcelId: 'p1', kind: 'street-frontage', roadRef: 'south' },
      { id: 'b1', fromNodeId: 'n2', toNodeId: 'n3', leftParcelId: 'p1', kind: 'property-boundary' },
      { id: 'b2', fromNodeId: 'n3', toNodeId: 'n4', leftParcelId: 'p1', kind: 'property-boundary' },
    ],
    blocks: [{
      id: 'block',
      boundary: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }],
      parcelIds: ['p0', 'p1'],
      roadEdgeIds: ['a0', 'b0'],
    }],
    parcels: [
      {
        id: 'p0', blockId: 'block', boundaryEdgeIds: ['a0', 'shared', 'a2', 'a3'], areaM2: 400,
        centroid: { x: 10, y: 10 }, frontageEdgeIds: ['a0'], accessEdgeIds: ['a0'], zoningDistrictId: 'R2',
        ownerId: 'owner:a', historicalParentIds: [],
      },
      {
        id: 'p1', blockId: 'block', boundaryEdgeIds: ['b0', 'b1', 'b2', 'shared'], areaM2: 400,
        centroid: { x: 30, y: 10 }, frontageEdgeIds: ['b0'], accessEdgeIds: ['b0'], zoningDistrictId: 'R2',
        ownerId: 'owner:a', historicalParentIds: [],
      },
    ],
    easements: [],
    lineage: [],
  };
}
