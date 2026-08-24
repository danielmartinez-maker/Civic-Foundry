import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { runKernelParityScenarios, canonicalStringify } from './kernelParity.ts';

const path = 'tests/fixtures/kernel-v7-parity/baseline.json';
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, `${canonicalStringify(runKernelParityScenarios())}\n`, 'utf8');
console.log(path);
