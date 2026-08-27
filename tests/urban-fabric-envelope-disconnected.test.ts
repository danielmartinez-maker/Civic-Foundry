import test from 'node:test';
import assert from 'node:assert/strict';
import { CadastralGraph } from '../src/world/cadastre/CadastralGraph.ts';
import { BuildableEnvelopeSystem } from '../src/simulation/zoning/BuildableEnvelopeSystem.ts';
import { ZONING_DISTRICTS } from '../src/simulation/zoning/ZoningDistrictCatalog.ts';

const boundary = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 4 },
  { x: 20, y: 4 },
  { x: 20, y: 0 },
  { x: 30, y: 0 },
  { x: 30, y: 10 },
  { x: 20, y: 10 },
  { x: 20, y: 6 },
  { x: 10, y: 6 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
] as const;

function dumbbellParcel(): CadastralGraph {
  return new CadastralGraph({
    nodes: boundary.map((point, index) => ({ id: `n${index}`, point })),
    edges: boundary.map((_, index) => ({
      id: `e${index}`,
      fromNodeId: `n${index}`,
      toNodeId: `n${(index + 1) % boundary.length}`,
      leftParcelId: 'p0',
      kind: index === 0 ? 'street-frontage' as const : 'property-boundary' as const,
      ...(index === 0 ? { roadRef: 'road:front' } : {}),
    })),
    blocks: [{ id: 'b0', boundary, parcelIds: ['p0'], roadEdgeIds: ['e0'] }],
    parcels: [{
      id: 'p0',
      blockId: 'b0',
      boundaryEdgeIds: boundary.map((_, index) => `e${index}`),
      areaM2: 220,
      centroid: { x: 15, y: 5 },
      frontageEdgeIds: ['e0'],
      accessEdgeIds: ['e0'],
      zoningDistrictId: 'MU4',
      historicalParentIds: [],
    }],
    easements: [],
    lineage: [],
  });
}

test('setbacks that sever a narrow parcel neck keep the largest piece and explain the disconnection', () => {
  const envelope = new BuildableEnvelopeSystem().evaluate('p0', dumbbellParcel(), {
    ...ZONING_DISTRICTS.MU4,
    maxFAR: 20,
    maxHeightMeters: 200,
    maxCoverageRatio: 1,
    frontSetbackMeters: 1.1,
    rearSetbackMeters: 1.1,
    sideSetbackMeters: 1.1,
    minParcelAreaM2: 0,
    minFrontageMeters: 0,
  }, []);

  assert.ok(envelope.buildableFootprint.length >= 3);
  assert.ok(envelope.maxFootprintAreaM2 > 0);
  assert.ok(envelope.limitingConstraints.some((constraint) => constraint.code === 'disconnected-envelope'));
});
