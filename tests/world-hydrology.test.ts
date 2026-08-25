import test from 'node:test';
import assert from 'node:assert/strict';
import { D8_CLOCKWISE } from '../src/world/hydrology/HydrologyTypes.ts';
import { resolveDepressions } from '../src/world/hydrology/DepressionResolver.ts';
import { DrainageGraph } from '../src/world/hydrology/DrainageGraph.ts';

function traceToOutlet(graph: DrainageGraph, start: number, limit: number): number {
  const seen = new Set<number>();
  let current = start;
  for (let step = 0; step < limit; step++) {
    if (seen.has(current)) throw new Error(`receiver cycle at ${current}`);
    seen.add(current);
    const next = graph.receiverIndex(current);
    if (next === null) return current;
    current = next;
  }
  throw new Error('receiver path did not reach outlet');
}

test('D8 clockwise precedence is locked and equal downhill gradients choose north first', () => {
  assert.deepEqual(D8_CLOCKWISE, [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]]);
  const elevation = new Float64Array([9,4,9, 4,5,4, 9,4,9]);
  const graph = DrainageGraph.build(3,3,elevation,new Uint8Array(9));
  assert.equal(graph.receiverIndex(4), 1);
});

test('priority flood fills an enclosed pit to its lowest spill elevation without mutating inputs', () => {
  const raw = new Float64Array([
    10,10,10,10,10,
    10, 8, 8, 8,10,
    10, 8, 1, 8, 7,
    10, 8, 8, 8,10,
    10,10,10,10,10,
  ]);
  const water = new Uint8Array(25);
  const rawBefore = new Float64Array(raw);
  const waterBefore = new Uint8Array(water);
  const first = resolveDepressions(5,5,raw,water);
  const second = resolveDepressions(5,5,raw,water);
  assert.deepEqual(raw, rawBefore);
  assert.deepEqual(water, waterBefore);
  assert.deepEqual(first, second);
  assert.equal(first[12], 8);
  assert.equal(first[14], 7);
});

test('permanent water and all boundary cells are explicit outlets', () => {
  const elevation = new Float64Array([
    9,8,7,6,
    8,7,6,5,
    7,6,5,4,
    6,5,4,3,
  ]);
  const water = new Uint8Array(16);
  water[5] = 1;
  const graph = DrainageGraph.build(4,4,elevation,water);
  const outlets = new Set(graph.listOutlets());
  for (let y=0;y<4;y++) for (let x=0;x<4;x++) {
    const index=y*4+x;
    if (x===0 || y===0 || x===3 || y===3) assert.ok(outlets.has(index), `boundary ${index}`);
  }
  assert.ok(outlets.has(5));
  assert.equal(graph.receiverIndex(5), null);
});

test('conditioned receiver graph never climbs and every cell reaches an outlet without cycles', () => {
  const raw = new Float64Array([
    12,12,12,12,12,
    12, 9, 9, 9,12,
    12, 9, 2, 9, 8,
    12, 9, 9, 9,12,
    12,12,12,12,12,
  ]);
  const water = new Uint8Array(25);
  const conditioned = resolveDepressions(5,5,raw,water);
  const graph = DrainageGraph.build(5,5,conditioned,water);
  for (let index=0; index<conditioned.length; index++) {
    const receiver = graph.receiverIndex(index);
    if (receiver !== null) assert.ok(conditioned[receiver]! <= conditioned[index]! + 1e-9, `${index} -> ${receiver}`);
    const outlet = traceToOutlet(graph,index,conditioned.length+1);
    assert.ok(graph.listOutlets().includes(outlet));
  }
  assert.equal(graph.topologicalOrder().length, conditioned.length);
  assert.equal(new Set(graph.topologicalOrder()).size, conditioned.length);
});

test('flat routing is deterministic and drains toward a lower exit instead of forming cycles', () => {
  const elevation = new Float64Array([
    6,6,6,6,6,
    6,5,5,5,4,
    6,5,5,5,4,
    6,5,5,5,4,
    6,6,6,6,6,
  ]);
  const water = new Uint8Array(25);
  const a = DrainageGraph.build(5,5,elevation,water);
  const b = DrainageGraph.build(5,5,elevation,water);
  assert.deepEqual(a.snapshotReceivers(), b.snapshotReceivers());
  for (const index of [6,7,8,11,12,13,16,17,18]) traceToOutlet(a,index,26);
  assert.notEqual(a.receiverIndex(12), null);
});
