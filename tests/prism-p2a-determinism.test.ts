import assert from "node:assert/strict";
import test from "node:test";

import { buildP2AParityFixtureManifest } from "../scripts/prism-p2a-fixtures.ts";
import { prismCanonicalHashV1 } from "../src/prism/compat/P2ACanonicalHash.ts";
import type { PrismP2AImportEnvelopeV1 } from "../src/prism/compat/P2AEnvelope.ts";
import { CadastralGraph } from "../src/world/cadastre/CadastralGraph.ts";
import { CadastralMutationSystem } from "../src/world/cadastre/CadastralMutationSystem.ts";

type Mutable<T> = T extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T;

function hashEnvelope(envelope: PrismP2AImportEnvelopeV1): string {
  return prismCanonicalHashV1({
    world: envelope.world,
    cadastre: envelope.cadastre,
  });
}

function reversedSetLikeArrays(
  envelope: PrismP2AImportEnvelopeV1,
): PrismP2AImportEnvelopeV1 {
  const copy = structuredClone(envelope) as Mutable<PrismP2AImportEnvelopeV1>;
  copy.world.geography.entities.reverse();
  copy.cadastre.nodes.reverse();
  copy.cadastre.edges.reverse();
  copy.cadastre.blocks.reverse();
  copy.cadastre.parcels.reverse();
  copy.cadastre.easements.reverse();
  copy.cadastre.lineage.reverse();
  return copy;
}

test("P2A canonical hash is invariant to top-level set-like array order", () => {
  const fixture = buildP2AParityFixtureManifest().staticCases.find(
    (entry) => entry.name === "easement-lineage",
  );
  assert.ok(fixture);
  assert.equal(
    hashEnvelope(reversedSetLikeArrays(fixture.envelope)),
    hashEnvelope(fixture.envelope),
  );
});

test("100 fresh TypeScript cadastral mirrors reproduce one canonical P2A hash", () => {
  const fixture = buildP2AParityFixtureManifest().staticCases.find(
    (entry) => entry.name === "shared-boundary-block",
  );
  assert.ok(fixture);
  const expected = hashEnvelope(fixture.envelope);

  for (let iteration = 0; iteration < 100; iteration += 1) {
    const graph: CadastralGraph = new CadastralGraph(
      structuredClone(fixture.envelope.cadastre),
    );
    assert.equal(
      prismCanonicalHashV1({
        world: fixture.envelope.world,
        cadastre: graph.snapshot(),
      }),
      expected,
      `fresh mirror hash diverged at iteration ${iteration}`,
    );
  }
});

test("rejected P2A candidate mutation preserves canonical hash exactly", () => {
  const fixture = buildP2AParityFixtureManifest().mutationCases.find(
    (entry) => entry.name === "split",
  );
  assert.ok(fixture);
  const graph = new CadastralGraph(structuredClone(fixture.envelope.cadastre));
  const mutations = new CadastralMutationSystem(graph);
  const before = prismCanonicalHashV1({
    world: fixture.envelope.world,
    cadastre: graph.snapshot(),
  });

  const result = mutations.splitParcel("p0", [
    { x: 0, y: 0 },
    { x: 0.01, y: 0.01 },
  ]);

  assert.equal(result.committed, false);
  assert.equal(
    prismCanonicalHashV1({
      world: fixture.envelope.world,
      cadastre: graph.snapshot(),
    }),
    before,
  );
});
