import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalStringify, runKernelParityScenarios } from './support/kernelParity.ts';

test('emit pre-kernel V7 parity fixture', () => {
  const fixture = runKernelParityScenarios();
  assert.equal(fixture.version, 1);
  assert.equal(Object.keys(fixture.scenarios).length, 7);
  console.log(`KERNEL_PARITY_BASELINE=${canonicalStringify(fixture)}`);
});
