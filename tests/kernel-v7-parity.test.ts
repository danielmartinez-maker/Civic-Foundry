import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalStringify, runKernelParityScenarios, type KernelParityFixture } from './support/kernelParity.ts';

const baseline = JSON.parse(readFileSync('tests/fixtures/kernel-v7-parity/baseline.json', 'utf8')) as KernelParityFixture;

test('current V7 runtime matches the committed Phase 0A pre-kernel baseline', () => {
  const current = runKernelParityScenarios();
  assert.equal(canonicalStringify(current), canonicalStringify(baseline));
});
