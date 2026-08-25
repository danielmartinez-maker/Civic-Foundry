import test from 'node:test';
import assert from 'node:assert/strict';
import { CadastralGraph } from '../src/world/cadastre/CadastralGraph.ts';
import type { CadastralSnapshot } from '../src/world/cadastre/CadastralTypes.ts';
import { PropertyMarketSystem } from '../src/simulation/development/PropertyMarketSystem.ts';
import {
  SiteAssemblySystem,
  type SiteAssemblyEnvelopeResolver,
} from '../src/simulation/development/SiteAssemblySystem.ts';
import {
  RedevelopmentExecutionSystem,
  type RedevelopmentProjectExecution,
} from '../src/simulation/development/RedevelopmentExecutionSystem.ts';

test('assembly is offered only when geometry uplift beats acquisition friction', () => {
  const graph = new CadastralGraph(threeParcelFixture());
  const market = new PropertyMarketSystem([
    { parcelId: 'p0', ownerId: 'owner:a', reservationValue: 100 },
    { parcelId: 'p1', ownerId: 'owner:b', reservationValue: 105 },
    { parcelId: 'p2', ownerId: 'owner:c', reservationValue: 180 },
  ]);
  const resolver: SiteAssemblyEnvelopeResolver = (parcelIds) => {
    const key = [...parcelIds].sort().join('+');
    const values: Record<string, number> = {
      p0: 100,
      p1: 100,
      p2: 100,
      'p0+p1': 270,
      'p0+p1+p2': 390,
    };
    return {
      bestFeasibleHbuValue: values[key] ?? 0,
      expectedReturn: key === 'p0+p1' ? 0.18 : 0.11,
      developerHurdleRate: 0.12,
      incrementalDemolitionCost: key === 'p0+p1' ? 10 : 20,
    };
  };

  const candidates = new SiteAssemblySystem().candidates('p0', graph, market, resolver);

  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0]!.parcelIds, ['p0', 'p1']);
  assert.ok(candidates.every((candidate) => candidate.incrementalDevelopmentValue > candidate.incrementalAssemblyCost));
  assert.ok(candidates.every((candidate) => candidate.expectedReturn >= candidate.developerHurdleRate));
});

test('site assembly candidate enumeration is deterministic and never exceeds four parcels', () => {
  const graph = new CadastralGraph(threeParcelFixture());
  const market = new PropertyMarketSystem([
    { parcelId: 'p0', ownerId: 'owner:a', reservationValue: 100 },
    { parcelId: 'p1', ownerId: 'owner:b', reservationValue: 100 },
    { parcelId: 'p2', ownerId: 'owner:c', reservationValue: 100 },
  ]);
  const resolver: SiteAssemblyEnvelopeResolver = (parcelIds) => ({
    bestFeasibleHbuValue: parcelIds.length === 1 ? 100 : parcelIds.length * 100 + 100,
    expectedReturn: 0.20,
    developerHurdleRate: 0.10,
    incrementalDemolitionCost: 0,
  });

  const system = new SiteAssemblySystem();
  const first = system.candidates('p0', graph, market, resolver);
  const second = system.candidates('p0', graph, market, resolver);
  assert.deepEqual(first, second);
  assert.ok(first.every((candidate) => candidate.parcelIds.length >= 2 && candidate.parcelIds.length <= 4));
  assert.ok(first.every((candidate) => candidate.parcelIds[0] === 'p0'));
});

test('redevelopment cannot enter demolition while households remain unresolved', () => {
  const execution = redevelopmentFixture({ state: 'relocating', displacedHouseholdIds: ['hh1', 'hh2'] });
  const system = new RedevelopmentExecutionSystem();

  const next = system.tick(execution, { relocatedHouseholdIds: ['hh1'] });

  assert.equal(next.state, 'relocating');
  assert.deepEqual(execution.displacedHouseholdIds, ['hh1', 'hh2']);
});

test('redevelopment advances to demolition after displacement clears', () => {
  const execution = redevelopmentFixture({ state: 'relocating', displacedHouseholdIds: ['hh1'] });
  const system = new RedevelopmentExecutionSystem();

  const next = system.tick(execution, { relocatedHouseholdIds: ['hh1'] });

  assert.equal(next.state, 'demolition');
});

test('redevelopment progresses through explicit acquisition demolition construction and lease-up gates', () => {
  const system = new RedevelopmentExecutionSystem();
  const underContract = redevelopmentFixture({ state: 'under-contract', displacedHouseholdIds: [] });
  const acquired = system.tick(underContract, { relocatedHouseholdIds: [], acquisitionCompleted: true });
  assert.equal(acquired.state, 'acquired');
  const demolition = system.tick(acquired, { relocatedHouseholdIds: [] });
  assert.equal(demolition.state, 'demolition');
  const construction = system.tick(demolition, { relocatedHouseholdIds: [], demolitionCompleted: true });
  assert.equal(construction.state, 'construction');
  const leaseUp = system.tick(construction, { relocatedHouseholdIds: [], constructionCompleted: true });
  assert.equal(leaseUp.state, 'lease-up');
  const stabilized = system.tick(leaseUp, { relocatedHouseholdIds: [], leaseUpCompleted: true });
  assert.equal(stabilized.state, 'stabilized');
});

function redevelopmentFixture(
  overrides: Partial<RedevelopmentProjectExecution> = {},
): RedevelopmentProjectExecution {
  return {
    id: 'redevelopment:p0',
    parcelIds: ['p0'],
    buildingIds: ['building:p0'],
    state: 'under-contract',
    displacedHouseholdIds: [],
    ...overrides,
  };
}

function threeParcelFixture(): CadastralSnapshot {
  return {
    nodes: [
      { id: 'n0', point: { x: 0, y: 0 } },
      { id: 'n1', point: { x: 20, y: 0 } },
      { id: 'n2', point: { x: 40, y: 0 } },
      { id: 'n3', point: { x: 60, y: 0 } },
      { id: 'n4', point: { x: 60, y: 20 } },
      { id: 'n5', point: { x: 40, y: 20 } },
      { id: 'n6', point: { x: 20, y: 20 } },
      { id: 'n7', point: { x: 0, y: 20 } },
    ],
    edges: [
      { id: 'a0', fromNodeId: 'n0', toNodeId: 'n1', leftParcelId: 'p0', kind: 'street-frontage', roadRef: 'south' },
      { id: 's01', fromNodeId: 'n1', toNodeId: 'n6', leftParcelId: 'p0', rightParcelId: 'p1', kind: 'property-boundary' },
      { id: 'a2', fromNodeId: 'n6', toNodeId: 'n7', leftParcelId: 'p0', kind: 'property-boundary' },
      { id: 'a3', fromNodeId: 'n7', toNodeId: 'n0', leftParcelId: 'p0', kind: 'property-boundary' },
      { id: 'b0', fromNodeId: 'n1', toNodeId: 'n2', leftParcelId: 'p1', kind: 'street-frontage', roadRef: 'south' },
      { id: 's12', fromNodeId: 'n2', toNodeId: 'n5', leftParcelId: 'p1', rightParcelId: 'p2', kind: 'property-boundary' },
      { id: 'b2', fromNodeId: 'n5', toNodeId: 'n6', leftParcelId: 'p1', kind: 'property-boundary' },
      { id: 'c0', fromNodeId: 'n2', toNodeId: 'n3', leftParcelId: 'p2', kind: 'street-frontage', roadRef: 'south' },
      { id: 'c1', fromNodeId: 'n3', toNodeId: 'n4', leftParcelId: 'p2', kind: 'property-boundary' },
      { id: 'c2', fromNodeId: 'n4', toNodeId: 'n5', leftParcelId: 'p2', kind: 'property-boundary' },
    ],
    blocks: [{
      id: 'block',
      boundary: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 20 }, { x: 0, y: 20 }],
      parcelIds: ['p0', 'p1', 'p2'],
      roadEdgeIds: ['a0', 'b0', 'c0'],
    }],
    parcels: [
      {
        id: 'p0', blockId: 'block', boundaryEdgeIds: ['a0', 's01', 'a2', 'a3'], areaM2: 400,
        centroid: { x: 10, y: 10 }, frontageEdgeIds: ['a0'], accessEdgeIds: ['a0'], zoningDistrictId: 'R2',
        ownerId: 'owner:a', historicalParentIds: [],
      },
      {
        id: 'p1', blockId: 'block', boundaryEdgeIds: ['b0', 's12', 'b2', 's01'], areaM2: 400,
        centroid: { x: 30, y: 10 }, frontageEdgeIds: ['b0'], accessEdgeIds: ['b0'], zoningDistrictId: 'R2',
        ownerId: 'owner:b', historicalParentIds: [],
      },
      {
        id: 'p2', blockId: 'block', boundaryEdgeIds: ['c0', 'c1', 'c2', 's12'], areaM2: 400,
        centroid: { x: 50, y: 10 }, frontageEdgeIds: ['c0'], accessEdgeIds: ['c0'], zoningDistrictId: 'R2',
        ownerId: 'owner:c', historicalParentIds: [],
      },
    ],
    easements: [],
    lineage: [],
  };
}
