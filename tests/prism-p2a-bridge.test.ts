import test from "node:test";
import assert from "node:assert/strict";

import { exportPrismP2AEnvelope } from "../src/prism/compat/P2AExporter.ts";
import { SimulationCore } from "../src/simulation/core/SimulationCore.ts";

test("P2A exporter emits only the versioned world/cadastre compatibility contract", () => {
  const core = new SimulationCore({ width: 8, height: 8, seed: 17 });
  const envelope = exportPrismP2AEnvelope(core);

  assert.equal(envelope.schemaVersion, 1);
  assert.equal(envelope.sourceSaveVersion, 9);
  assert.equal(envelope.sourceGameVersion, "0.9.0-urban-fabric");
  assert.deepEqual(envelope.world, core.world.snapshotAuthoritative());
  assert.deepEqual(envelope.cadastre, core.cadastre.snapshot());
  assert.deepEqual(Object.keys(envelope).sort(), [
    "cadastre",
    "schemaVersion",
    "sourceGameVersion",
    "sourceSaveVersion",
    "world",
  ]);
});

test("P2A export is a one-way snapshot and cannot mutate live authority", () => {
  const core = new SimulationCore({ width: 8, height: 8, seed: 23 });
  const beforeWorld = core.world.snapshotAuthoritative();
  const beforeCadastre = core.cadastre.snapshot();
  const clone = structuredClone(exportPrismP2AEnvelope(core)) as unknown as {
    world: { seed: number };
    cadastre: { parcels: Array<{ id: string }> };
  };

  clone.world.seed = 999999;
  if (clone.cadastre.parcels[0])
    clone.cadastre.parcels[0].id = "mutated-local-copy";

  assert.deepEqual(core.world.snapshotAuthoritative(), beforeWorld);
  assert.deepEqual(core.cadastre.snapshot(), beforeCadastre);
});
