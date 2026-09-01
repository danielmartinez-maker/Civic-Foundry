import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  buildP2AParityFixtureManifest,
  stableStringify,
  type P2AParityMutationCase,
} from '../scripts/prism-p2a-fixtures.ts';
import { prismCanonicalHashV1 } from '../src/prism/compat/P2ACanonicalHash.ts';
import type { P2AMutationCommand } from '../src/prism/compat/P2AMutationCommands.ts';
import { CadastralGraph } from '../src/world/cadastre/CadastralGraph.ts';
import { CadastralMutationSystem } from '../src/world/cadastre/CadastralMutationSystem.ts';
import { validateCadastralSnapshot } from '../src/world/cadastre/CadastralValidator.ts';
import type { CadastralMutationResult } from '../src/world/cadastre/CadastralTypes.ts';

const REQUIRED_STATIC_CASES = [
  'legacy-flat-minimal',
  'generated-1r-geography-hydrology',
  'shared-boundary-block',
  'easement-lineage',
  'save-v9-round-trip-envelope',
] as const;
const REQUIRED_MUTATION_CASES = [
  'split',
  'assembly',
  'easement-create-remove',
  'right-of-way',
  'mutation-sequence',
] as const;

test('P2A fixture manifest covers the approved deterministic corpus', () => {
  const manifest = buildP2AParityFixtureManifest();
  const staticNames = new Set(manifest.staticCases.map((entry) => entry.name));
  const mutationNames = new Set(manifest.mutationCases.map((entry) => entry.name));

  for (const name of REQUIRED_STATIC_CASES) assert.ok(staticNames.has(name), `missing static P2A fixture ${name}`);
  for (const name of REQUIRED_MUTATION_CASES) assert.ok(mutationNames.has(name), `missing mutation P2A fixture ${name}`);
  assert.ok(manifest.malformedCases.length >= 4, 'malformed validation corpus must cover at least four failures');

  const once = stableStringify(manifest);
  const twice = stableStringify(buildP2AParityFixtureManifest());
  assert.equal(once, twice);
});

test('TypeScript authority and native candidate produce identical P2A mutation reports', () => {
  const manifest = buildP2AParityFixtureManifest();
  const directory = mkdtempSync(join(tmpdir(), 'civic-foundry-p2a-'));
  try {
    for (const fixture of manifest.mutationCases) {
      const expected = runTypeScriptCase(fixture);
      const fixturePath = join(directory, `${fixture.name}.json`);
      writeFileSync(fixturePath, `${stableStringify(fixture)}\n`, 'utf8');
      const native = spawnSync(
        'cargo',
        [
          'run',
          '--manifest-path',
          'engine/prism/Cargo.toml',
          '-p',
          'prism-domain',
          '--bin',
          'prism-p2a-parity',
          '--locked',
          '--quiet',
          '--',
          fixturePath,
        ],
        { encoding: 'utf8' },
      );
      assert.equal(native.status, 0, `native parity CLI failed for ${fixture.name}: ${native.stderr}`);
      const actual = JSON.parse(native.stdout) as { readonly name: string; readonly steps: readonly ParityStep[] };
      assert.equal(actual.name, fixture.name);
      assert.equal(actual.steps.length, expected.length);
      for (let index = 0; index < expected.length; index += 1) {
        assert.deepEqual(
          actual.steps[index],
          expected[index],
          `P2A parity mismatch case=${fixture.name} step=${index}`,
        );
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

type ValidationPair = Readonly<{ code: string; entityId: string | null }>;
type LineageView = Readonly<{
  id: string;
  tick: number;
  kind: string;
  sourceParcelIds: readonly string[];
  resultingParcelIds: readonly string[];
}>;
type ParityStep = Readonly<{
  index: number;
  committed: boolean;
  resultingParcelIds: readonly string[];
  retiredParcelIds: readonly string[];
  parcelReferenceRewrites: Readonly<Record<string, string>>;
  rejectionReasons: readonly string[];
  canonicalHash: string;
  totalParcelAreaM2: number;
  lineage: readonly LineageView[];
  validation: readonly ValidationPair[];
}>;

function runTypeScriptCase(fixture: P2AParityMutationCase): readonly ParityStep[] {
  const graph = new CadastralGraph(structuredClone(fixture.envelope.cadastre));
  const mutations = new CadastralMutationSystem(graph);
  const steps: ParityStep[] = [];

  for (const [index, command] of fixture.commands.entries()) {
    const result = applyCommand(mutations, command);
    const snapshot = graph.snapshot();
    const validation = validateCadastralSnapshot(snapshot).errors
      .map((error) => ({ code: error.code, entityId: error.entityId ?? null }))
      .sort((left, right) => left.code.localeCompare(right.code) || (left.entityId ?? '').localeCompare(right.entityId ?? ''));
    const lineage = [...snapshot.lineage]
      .sort((left, right) => left.tick - right.tick || left.id.localeCompare(right.id))
      .map((event) => ({
        id: event.id,
        tick: event.tick,
        kind: event.kind,
        sourceParcelIds: [...event.sourceParcelIds].sort(),
        resultingParcelIds: [...event.resultingParcelIds].sort(),
      }));
    steps.push({
      index,
      committed: result.committed,
      resultingParcelIds: [...result.resultingParcelIds],
      retiredParcelIds: [...result.retiredParcelIds],
      parcelReferenceRewrites: Object.fromEntries(
        Object.entries(result.parcelReferenceRewrites).sort(([left], [right]) => left.localeCompare(right)),
      ),
      rejectionReasons: [...result.rejectionReasons],
      canonicalHash: prismCanonicalHashV1({ world: fixture.envelope.world, cadastre: snapshot }),
      totalParcelAreaM2: snapshot.parcels.reduce((total, parcel) => total + parcel.areaM2, 0),
      lineage,
      validation,
    });
  }

  return steps;
}

function applyCommand(system: CadastralMutationSystem, command: P2AMutationCommand): CadastralMutationResult {
  switch (command.kind) {
    case 'split':
      return system.splitParcel(command.parcelId, command.cutLine);
    case 'assemble':
      return system.assembleParcels(command.parcelIds);
    case 'create-easement':
      return system.createEasement(command.parcelIds, command.easementKind, command.geometry);
    case 'remove-easement':
      return system.removeEasement(command.easementId);
    case 'right-of-way':
      return system.dedicateRightOfWay(command.parcelId, command.geometry);
  }
}
