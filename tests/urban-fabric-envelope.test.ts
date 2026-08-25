import test from 'node:test';
import assert from 'node:assert/strict';
import { CadastralGraph } from '../src/world/cadastre/CadastralGraph.ts';
import type { CadastralSnapshot } from '../src/world/cadastre/CadastralTypes.ts';
import { BuildableEnvelopeSystem } from '../src/simulation/zoning/BuildableEnvelopeSystem.ts';
import { ZoningComplianceSystem } from '../src/simulation/zoning/ZoningComplianceSystem.ts';
import { ZONING_DISTRICTS } from '../src/simulation/zoning/ZoningDistrictCatalog.ts';
import type { ParcelDevelopmentEnvelope, ZoningCandidate, ZoningOverlay } from '../src/simulation/zoning/ZoningTypes.ts';

function graph20x20Fixture(): CadastralGraph {
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
    blocks: [{ id: 'b0', boundary: square(0, 0, 20, 20), parcelIds: ['p0'], roadEdgeIds: ['e0'] }],
    parcels: [{
      id: 'p0', blockId: 'b0', boundaryEdgeIds: ['e0', 'e1', 'e2', 'e3'], areaM2: 400,
      centroid: { x: 10, y: 10 }, frontageEdgeIds: ['e0'], accessEdgeIds: ['e0'], zoningDistrictId: 'MU4', historicalParentIds: [],
    }],
    easements: [],
    lineage: [],
  };
  return new CadastralGraph(snapshot);
}

function skewedParcelFixture(): CadastralGraph {
  const boundary = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 100, y: 1 },
    { x: 20, y: 20 },
    { x: 0, y: 20 },
  ] as const;
  return new CadastralGraph({
    nodes: boundary.map((point, index) => ({ id: `s${index}`, point })),
    edges: boundary.map((_, index) => ({
      id: `se${index}`,
      fromNodeId: `s${index}`,
      toNodeId: `s${(index + 1) % boundary.length}`,
      leftParcelId: 'skew',
      kind: index === 0 ? 'street-frontage' as const : 'property-boundary' as const,
      ...(index === 0 ? { roadRef: 'road:front' } : {}),
    })),
    blocks: [{ id: 'sb0', boundary, parcelIds: ['skew'], roadEdgeIds: ['se0'] }],
    parcels: [{
      id: 'skew',
      blockId: 'sb0',
      boundaryEdgeIds: ['se0', 'se1', 'se2', 'se3', 'se4'],
      areaM2: 1200,
      centroid: { x: 34.44444444444444, y: 8 },
      frontageEdgeIds: ['se0'],
      accessEdgeIds: ['se0'],
      zoningDistrictId: 'MU4',
      historicalParentIds: [],
    }],
    easements: [],
    lineage: [],
  });
}

test('setbacks coverage height and FAR constrain a parcel envelope', () => {
  const system = new BuildableEnvelopeSystem();
  const envelope = system.evaluate('p0', graph20x20Fixture(), {
    ...ZONING_DISTRICTS.MU4,
    maxFAR: 2,
    maxHeightMeters: 18,
    maxCoverageRatio: 0.5,
    frontSetbackMeters: 2,
    rearSetbackMeters: 2,
    sideSetbackMeters: 2,
  }, []);
  assert.equal(envelope.parcelAreaM2, 400);
  assert.equal(envelope.frontageMeters, 20);
  assert.equal(Math.round(envelope.maxFootprintAreaM2), 200);
  assert.equal(envelope.maxGrossFloorAreaM2, 800);
  assert.equal(envelope.maxHeightMeters, 18);
  assert.equal(envelope.maxStories, 5);
  assert.equal(envelope.effectiveFAR, 2);
});

test('rear setback uses perpendicular distance from the longest frontage', () => {
  const envelope = new BuildableEnvelopeSystem().evaluate('skew', skewedParcelFixture(), {
    ...ZONING_DISTRICTS.MU4,
    maxFAR: 20,
    maxHeightMeters: 200,
    maxCoverageRatio: 1,
    frontSetbackMeters: 0,
    rearSetbackMeters: 5,
    sideSetbackMeters: 0,
    minParcelAreaM2: 0,
    minFrontageMeters: 0,
  }, []);
  assert.ok(envelope.buildableFootprint.length >= 3);
  assert.ok(Math.max(...envelope.buildableFootprint.map((point) => point.y)) <= 15.01);
});

test('overlays compose height FAR setbacks and use rules deterministically', () => {
  const overlays: readonly ZoningOverlay[] = [
    {
      id: 'airport:p0', kind: 'airport-height', parcelIds: ['p0'], maxHeightMeters: 20,
      additionalFrontSetbackMeters: 1, prohibitedUses: ['hospitality'],
    },
    {
      id: 'tod:p0', kind: 'transit-oriented', parcelIds: ['p0'], maxFARMultiplier: 1.25,
      permittedUseAdditions: ['civic'],
    },
  ];
  const envelope = new BuildableEnvelopeSystem().evaluate('p0', graph20x20Fixture(), ZONING_DISTRICTS.MU4, overlays);
  assert.equal(envelope.maxHeightMeters, 20);
  assert.equal(envelope.allowedFAR, 5);
  assert.ok(envelope.permittedUses.includes('civic'));
  assert.equal(envelope.permittedUses.includes('hospitality'), false);
  assert.deepEqual(
    envelope.limitingConstraints.filter((value) => value.code === 'overlay').map((value) => value.sourceId),
    ['airport:p0', 'tod:p0'],
  );
});

test('minimum parcel dimensions can eliminate new-build capacity without deleting the parcel', () => {
  const envelope = new BuildableEnvelopeSystem().evaluate('p0', graph20x20Fixture(), {
    ...ZONING_DISTRICTS.MU4,
    minParcelAreaM2: 500,
  }, []);
  assert.equal(envelope.maxFootprintAreaM2, 0);
  assert.equal(envelope.maxGrossFloorAreaM2, 0);
  assert.ok(envelope.limitingConstraints.some((constraint) => constraint.code === 'minimum-area'));
});

test('compliance reports exact dimensional violations', () => {
  const result = new ZoningComplianceSystem().evaluate(
    candidateFixture({ realizedFAR: 4.2, heightMeters: 35 }),
    envelopeFixture({ effectiveFAR: 4, maxHeightMeters: 30 }),
  );
  assert.equal(result.legal, false);
  assert.deepEqual(result.violations.map((violation) => violation.code).sort(), ['far', 'height']);
});

test('compliance rejects footprint and use violations independently', () => {
  const result = new ZoningComplianceSystem().evaluate(
    candidateFixture({
      footprint: square(0, 0, 19, 19),
      uses: ['residential', 'heavy-industrial'],
    }),
    envelopeFixture({ buildableFootprint: square(2, 2, 18, 18), permittedUses: ['residential'] }),
  );
  assert.equal(result.legal, false);
  assert.deepEqual(result.violations.map((violation) => violation.code).sort(), ['footprint', 'use']);
});

function candidateFixture(overrides: Partial<ZoningCandidate> = {}): ZoningCandidate {
  return {
    footprint: square(2, 2, 10, 10),
    realizedFAR: 2,
    coverageRatio: 0.2,
    heightMeters: 18,
    stories: 5,
    uses: ['residential'],
    ...overrides,
  };
}

function envelopeFixture(overrides: Partial<ParcelDevelopmentEnvelope> = {}): ParcelDevelopmentEnvelope {
  return {
    parcelId: 'p0',
    districtId: 'MU4',
    buildableFootprint: square(0, 0, 20, 20),
    parcelAreaM2: 400,
    frontageMeters: 20,
    maxFootprintAreaM2: 300,
    maxGrossFloorAreaM2: 1600,
    maxHeightMeters: 30,
    maxStories: 8,
    allowedFAR: 4,
    effectiveFAR: 4,
    effectiveCoverageRatio: 0.75,
    permittedUses: ['residential', 'retail', 'office', 'hospitality'],
    limitingConstraints: [],
    ...overrides,
  };
}

function square(minX: number, minY: number, maxX: number, maxY: number) {
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ] as const;
}
