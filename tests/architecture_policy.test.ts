import assert from 'node:assert/strict';
import test from 'node:test';

import { checkArchitectureImport } from '../scripts/check-architecture.mjs';

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
  assert.equal(checkArchitectureImport('src/app/A.ts', 'src/simulation/B.ts'), null);
});
