import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('IntersectionControlSystem unsignalized hot path never scans the full junction authority', () => {
  const source = readFileSync(
    new URL('../src/simulation/transportation/IntersectionControlSystem.ts', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('private eligibleEntries(');
  const end = source.indexOf('private validatePersistedPlan(', start);
  assert.ok(start >= 0 && end > start, 'eligibleEntries method must exist');
  const hotPath = source.slice(start, end);

  assert.doesNotMatch(hotPath, /authority\?\.junctions\.find\(/);
  assert.doesNotMatch(hotPath, /authority\.junctions\.find\(/);
});
