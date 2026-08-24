import test from 'node:test';
import assert from 'node:assert/strict';
import { EntityRegistry } from '../src/entities/EntityRegistry.ts';

const building = (token: string) => ({
  kind: 'building' as const,
  legacyId: 'building:lot:1,1',
  incarnationToken: token,
});

test('changed incarnation token advances generation and preserves history', () => {
  const registry = new EntityRegistry();
  registry.commitPrepared(registry.prepareProjection([building('start:10')]));
  const g1 = registry.require('building', 'building:lot:1,1');
  assert.equal(g1.generation, 1);

  registry.commitPrepared(registry.prepareProjection([building('start:20')]));
  const g2 = registry.require('building', 'building:lot:1,1');
  assert.equal(g2.generation, 2);
  assert.equal(registry.isKnown(g1), true);
  assert.equal(registry.isActive(g1), false);
  assert.equal(registry.isActive(g2), true);
});

test('same incarnation token preserves the current generation', () => {
  const registry = new EntityRegistry();
  registry.commitPrepared(registry.prepareProjection([building('start:10')]));
  const first = registry.require('building', 'building:lot:1,1');
  registry.commitPrepared(registry.prepareProjection([building('start:10')]));
  assert.deepEqual(registry.require('building', 'building:lot:1,1'), first);
});

test('disappearance makes an entity historical and reappearance advances generation', () => {
  const registry = new EntityRegistry();
  registry.commitPrepared(registry.prepareProjection([building('start:10')]));
  const first = registry.require('building', 'building:lot:1,1');
  registry.commitPrepared(registry.prepareProjection([]));
  assert.equal(registry.resolve('building', 'building:lot:1,1'), undefined);
  assert.equal(registry.isKnown(first), true);
  assert.equal(registry.isActive(first), false);

  registry.commitPrepared(registry.prepareProjection([building('start:10')]));
  assert.equal(registry.require('building', 'building:lot:1,1').generation, 2);
});

test('duplicate legacy identity and invalid tokens reject without mutating committed state', () => {
  const registry = new EntityRegistry();
  registry.commitPrepared(registry.prepareProjection([building('start:10')]));
  const before = registry.snapshot();
  assert.throws(() => registry.prepareProjection([building('a'), building('b')]), /duplicate/i);
  assert.throws(() => registry.prepareProjection([{ ...building(''), incarnationToken: '' }]), /token/i);
  assert.deepEqual(registry.snapshot(), before);
});

test('projection ordering does not affect deterministic registry snapshots', () => {
  const entities = [
    { kind: 'firm' as const, legacyId: 'firm:2', incarnationToken: '20|b2' },
    { kind: 'building' as const, legacyId: 'building:2', incarnationToken: 'start:20' },
    { kind: 'firm' as const, legacyId: 'firm:1', incarnationToken: '10|b1' },
    { kind: 'building' as const, legacyId: 'building:1', incarnationToken: 'start:10' },
  ];
  const a = new EntityRegistry();
  const b = new EntityRegistry();
  a.commitPrepared(a.prepareProjection(entities));
  b.commitPrepared(b.prepareProjection([...entities].reverse()));
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test('resolveKnownByToken returns an exact historical incarnation without retargeting', () => {
  const registry = new EntityRegistry();
  registry.commitPrepared(registry.prepareProjection([building('start:10')]));
  const first = registry.require('building', 'building:lot:1,1');
  registry.commitPrepared(registry.prepareProjection([building('start:20')]));
  assert.deepEqual(
    registry.resolveKnownByToken('building', 'building:lot:1,1', 'start:10'),
    first,
  );
  assert.equal(registry.resolveKnownByToken('building', 'building:lot:1,1', 'unknown'), undefined);
});

test('registry returns isolated snapshots and handle arrays', () => {
  const registry = new EntityRegistry();
  registry.commitPrepared(registry.prepareProjection([building('start:10')]));
  const active = registry.listActive();
  assert.equal(Object.isFrozen(active), true);
  assert.equal(Object.isFrozen(active[0]), true);
  const snapshot = registry.snapshot();
  assert.equal(Object.isFrozen(snapshot.active), true);
  assert.equal(Object.isFrozen(snapshot.known), true);
});
