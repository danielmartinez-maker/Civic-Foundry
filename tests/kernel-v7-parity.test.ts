import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalStringify, runKernelParityScenarios, type KernelParityFixture } from './support/kernelParity.ts';

const baseline = JSON.parse(readFileSync('tests/fixtures/kernel-v7-parity/baseline.json', 'utf8')) as KernelParityFixture;

test('legacy V7 compatibility engine matches the committed Phase 0A pre-kernel baseline', () => {
  const legacy = runKernelParityScenarios();
  assert.equal(canonicalStringify(legacy), canonicalStringify(baseline));
});
