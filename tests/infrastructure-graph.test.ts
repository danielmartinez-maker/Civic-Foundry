import test from 'node:test';
import assert from 'node:assert/strict';
import { InfrastructureGraph } from '../src/simulation/infrastructure/InfrastructureGraph.ts';

test('max flow respects the bottleneck and reports residual capacity', () => {
  const graph = new InfrastructureGraph(
    [{ id: 's' }, { id: 'a' }, { id: 't' }],
    [
      { id: 'e1', from: 's', to: 'a', capacity: 10 },
      { id: 'e2', from: 'a', to: 't', capacity: 4 },
    ],
  );
  const result = graph.solveMaxFlow('s', 't');
  assert.equal(result.totalFlow, 4);
  assert.equal(result.edgeFlow.e1, 4);
  assert.equal(result.edgeFlow.e2, 4);
  assert.equal(result.residualCapacity.e1, 6);
  assert.equal(result.edgeUtilization.e2, 1);
});

test('max flow is independent of input ordering', () => {
  const nodes = [{ id: 's' }, { id: 'a' }, { id: 'b' }, { id: 't' }];
  const edges = [
    { id: 'sa', from: 's', to: 'a', capacity: 5 },
    { id: 'sb', from: 's', to: 'b', capacity: 5 },
    { id: 'at', from: 'a', to: 't', capacity: 5 },
    { id: 'bt', from: 'b', to: 't', capacity: 5 },
  ];
  const first = new InfrastructureGraph(nodes, edges).solveMaxFlow('s', 't');
  const second = new InfrastructureGraph([...nodes].reverse(), [...edges].reverse()).solveMaxFlow('s', 't');
  assert.deepEqual(first, second);
});

test('non-operational edges carry zero flow', () => {
  const graph = new InfrastructureGraph(
    [{ id: 's' }, { id: 't' }],
    [{ id: 'e', from: 's', to: 't', capacity: 10, operational: false }],
  );
  assert.equal(graph.solveMaxFlow('s', 't').totalFlow, 0);
  assert.equal(graph.solveMaxFlow('s', 't').edgeFlow.e, 0);
});

test('graph rejects duplicate ids, invalid endpoints, and invalid capacity', () => {
  assert.throws(() => new InfrastructureGraph([{ id: 'a' }, { id: 'a' }], []), /duplicate node id/);
  assert.throws(() => new InfrastructureGraph([{ id: 'a' }], [{ id: 'e', from: 'a', to: 'b', capacity: 1 }]), /unknown edge endpoint/);
  assert.throws(() => new InfrastructureGraph([{ id: 'a' }, { id: 'b' }], [{ id: 'e', from: 'a', to: 'b', capacity: -1 }]), /capacity/);
});
