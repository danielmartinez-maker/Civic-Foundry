import { readFile, writeFile } from 'node:fs/promises';

async function replaceExactly(path, replacements) {
  let source = await readFile(path, 'utf8');

  for (const [from, to] of replacements) {
    const occurrences = source.split(from).length - 1;
    if (occurrences !== 1) {
      throw new Error(`${path}: expected exactly one occurrence of ${JSON.stringify(from)}, found ${occurrences}`);
    }
    source = source.replace(from, to);
  }

  await writeFile(path, source, 'utf8');
}

await replaceExactly('src/simulation/core/LegacySimulationCore.ts', [
  ['export type SimulationCoreOptions = Readonly<{', 'export type LegacySimulationCoreOptions = Readonly<{'],
  ['export class SimulationCore {', 'export class LegacySimulationCore {'],
  ['constructor(options: SimulationCoreOptions = {})', 'constructor(options: LegacySimulationCoreOptions = {})'],
]);

await replaceExactly('src/simulation/core/SimulationCore.ts', [
  [
    "import { SimulationCore as LegacySimulationCore } from './LegacySimulationCore.ts';",
    "import { LegacySimulationCore } from './LegacySimulationCore.ts';",
  ],
]);

await replaceExactly('tests/support/kernelParity.ts', [
  [
    "import { SimulationCore as LegacySimulationCore } from '../../src/simulation/core/LegacySimulationCore.ts';",
    "import { LegacySimulationCore } from '../../src/simulation/core/LegacySimulationCore.ts';",
  ],
]);

await replaceExactly('src/app/GameApp.ts', [
  ['PHASE VI · FIRMS, PRODUCTION & FREIGHT', 'URBAN FABRIC 2.0 · DESKTOP GPU RUNTIME'],
  ['<option value="garbage">Garbage</option>', '<option value="garbage">Waste</option>'],
]);

await replaceExactly('src/ui/Inspector.ts', [
  ['Garbage backlog:', 'Waste backlog:'],
  ['Garbage access:', 'Waste access:'],
]);
