import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkArchitectureImport,
  checkArchitectureSource,
} from '../scripts/check-architecture.mjs';

test('simulation cannot depend on UI', () => {
  assert.equal(
    checkArchitectureImport('src/simulation/A.ts', 'src/ui/B.ts')?.rule,
    'simulation-no-ui',
  );
});

test('world cannot depend on rendering', () => {
  assert.equal(
    checkArchitectureImport('src/world/A.ts', 'src/rendering/B.ts')?.rule,
    'world-no-rendering',
  );
});

test('rendering cannot depend on UI', () => {
  assert.equal(
    checkArchitectureImport('src/rendering/A.ts', 'src/ui/B.ts')?.rule,
    'rendering-no-ui',
  );
});

test('application layer may consume simulation', () => {
  assert.equal(
    checkArchitectureImport('src/app/A.ts', 'src/simulation/B.ts'),
    null,
  );
});

test('renderer cannot import authoritative transaction or mutation internals', () => {
  const violation = checkArchitectureImport(
    'src/rendering/gpu/DebugOverlay.ts',
    'src/simulation/transactions/TransactionCoordinator.ts',
  );
  assert.equal(violation?.rule, 'presentation-no-authoritative-mutation');
  assert.match(violation?.alternative ?? '', /read-only snapshot/i);
});

test('UI cannot import authoritative transaction or mutation internals', () => {
  assert.equal(
    checkArchitectureImport(
      'src/ui/DebugPanel.ts',
      'src/simulation/transactions/TransactionCoordinator.ts',
    )?.rule,
    'presentation-no-authoritative-mutation',
  );
});

test('authoritative TypeScript cannot use Math.random directly', () => {
  const violations = checkArchitectureSource(
    'src/simulation/example.ts',
    'export function bad() { return Math.random(); }',
  );
  assert.equal(violations[0]?.rule, 'authoritative-no-math-random');
  assert.match(violations[0]?.alternative ?? '', /named RandomStreamRegistry stream/);
});

test('presentation may use Math.random only outside authoritative code', () => {
  assert.deepEqual(
    checkArchitectureSource(
      'src/rendering/example.ts',
      'export function visualNoise() { return Math.random(); }',
    ),
    [],
  );
});
