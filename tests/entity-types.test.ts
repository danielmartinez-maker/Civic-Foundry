import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalHandleKey, canonicalLegacyKey } from '../src/entities/EntityTypes.ts';

test('canonical entity keys separate kind, id and generation unambiguously', () => {
  assert.notEqual(
    canonicalLegacyKey({ kind: 'building', legacyId: 'a|b' }),
    canonicalLegacyKey({ kind: 'building', legacyId: 'a' }),
  );
  assert.notEqual(
    canonicalHandleKey({ kind: 'building', legacyId: 'x', generation: 1 }),
    canonicalHandleKey({ kind: 'building', legacyId: 'x', generation: 2 }),
  );
});

test('canonical handle encoding rejects invalid generations and blank ids', () => {
  assert.throws(() => canonicalHandleKey({ kind: 'building', legacyId: '', generation: 1 }));
  assert.throws(() => canonicalHandleKey({ kind: 'building', legacyId: 'x', generation: 0 }));
  assert.throws(() => canonicalHandleKey({ kind: 'building', legacyId: 'x', generation: 1.5 }));
});
