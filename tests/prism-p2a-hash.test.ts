import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fnv1a64Hex,
  prismCanonicalHashV1,
} from '../src/prism/compat/P2ACanonicalHash.ts';
import { exportPrismP2AEnvelope } from '../src/prism/compat/P2AExporter.ts';
import type { PrismP2AImportEnvelopeV1 } from '../src/prism/compat/P2AEnvelope.ts';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';

type Mutable<T> = T extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T;

function mutableClone<T>(value: T): Mutable<T> {
  return structuredClone(value) as Mutable<T>;
}

function envelope(seed = 17): PrismP2AImportEnvelopeV1 {
  return exportPrismP2AEnvelope(new SimulationCore({ width: 8, height: 8, seed }));
}

test('Prism FNV-1a64 locks the mandated byte vectors', () => {
  assert.equal(fnv1a64Hex(new Uint8Array()), 'cbf29ce484222325');
  assert.equal(fnv1a64Hex(new TextEncoder().encode('a')), 'af63dc4c8601ec8c');
});

test('PrismCanonicalHashV1 is deterministic and has a fixed lowercase 64-bit form', () => {
  const value = envelope();
  const first = prismCanonicalHashV1(value);
  const second = prismCanonicalHashV1(structuredClone(value));

  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{16}$/);
});

test('PrismCanonicalHashV1 ignores envelope metadata and hashes only world plus cadastre', () => {
  const value = envelope();

  assert.equal(
    prismCanonicalHashV1(value),
    prismCanonicalHashV1({ world: value.world, cadastre: value.cadastre }),
  );
});

test('PrismCanonicalHashV1 canonicalizes set-like collection order', () => {
  const original = mutableClone(envelope(23));
  const shuffled = mutableClone(original);

  shuffled.world.hydrology.watersheds.reverse();
  shuffled.world.hydrology.channels.reverse();
  shuffled.world.geography.entities.reverse();
  shuffled.cadastre.nodes.reverse();
  shuffled.cadastre.edges.reverse();
  shuffled.cadastre.blocks.reverse();
  shuffled.cadastre.parcels.reverse();
  shuffled.cadastre.easements.reverse();
  shuffled.cadastre.lineage.reverse();
  for (const block of shuffled.cadastre.blocks) {
    block.parcelIds.reverse();
    block.roadEdgeIds.reverse();
  }
  for (const parcel of shuffled.cadastre.parcels) {
    parcel.frontageEdgeIds.reverse();
    parcel.accessEdgeIds.reverse();
    parcel.historicalParentIds.reverse();
  }
  for (const easement of shuffled.cadastre.easements) easement.parcelIds.reverse();
  for (const event of shuffled.cadastre.lineage) {
    event.sourceParcelIds.reverse();
    event.resultingParcelIds.reverse();
  }

  assert.equal(prismCanonicalHashV1(shuffled), prismCanonicalHashV1(original));
});

test('PrismCanonicalHashV1 preserves semantic terrain array order', () => {
  const ordered = mutableClone(envelope(29));
  assert.ok(ordered.world.terrain.samples.length >= 2);
  ordered.world.terrain.samples[0].elevationMeters = 101.25;
  ordered.world.terrain.samples[1].elevationMeters = -37.5;
  const swapped = mutableClone(ordered);
  [swapped.world.terrain.samples[0], swapped.world.terrain.samples[1]] = [
    swapped.world.terrain.samples[1],
    swapped.world.terrain.samples[0],
  ];

  assert.notEqual(prismCanonicalHashV1(swapped), prismCanonicalHashV1(ordered));
});

test('PrismCanonicalHashV1 normalizes negative zero and rejects non-finite numbers', () => {
  const positiveZero = mutableClone(envelope(31));
  const negativeZero = mutableClone(positiveZero);
  positiveZero.world.terrain.samples[0].slope = 0;
  negativeZero.world.terrain.samples[0].slope = -0;

  assert.equal(prismCanonicalHashV1(negativeZero), prismCanonicalHashV1(positiveZero));

  const invalid = mutableClone(positiveZero);
  invalid.world.terrain.samples[0].slope = Number.POSITIVE_INFINITY;
  assert.throws(() => prismCanonicalHashV1(invalid), /finite/i);
});

test('PrismCanonicalHashV1 encodes optional-value presence explicitly', () => {
  const absent = mutableClone(envelope(37));
  const present = mutableClone(absent);
  absent.world.scenarioId = null;
  present.world.scenarioId = 'hash-vector-scenario';

  assert.notEqual(prismCanonicalHashV1(absent), prismCanonicalHashV1(present));
});
