import test from "node:test";
import assert from "node:assert/strict";

import { SimulationCore } from "../src/simulation/core/SimulationCore.ts";
import { captureAuthoritativeTransactionCheckpoint } from "../src/simulation/core/AuthoritativeTransactionCheckpoint.ts";
import { deterministicHash } from "../src/simulation/diagnostics/DeterministicDiagnostics.ts";

test("SimulationCore exposes renderer-independent read-only engine health diagnostics", () => {
  const core = new SimulationCore({ width: 12, height: 10, seed: 71 });
  const snapshot = core.diagnostics.snapshot();

  assert.equal(snapshot.simulation.tick, core.clock.tick);
  assert.deepEqual(
    snapshot.simulation.registeredSystems,
    core.kernel.schedulerManifest(),
  );
  assert.equal(snapshot.world.parcels, core.cadastre.listParcels().length);
  assert.equal(snapshot.world.blocks, core.cadastre.listBlocks().length);
  assert.equal(snapshot.buildings.canonical, core.buildings.listV2().length);
  assert.equal(
    snapshot.transport.segments,
    core.transportationGraph.edges.length,
  );
  assert.equal(
    snapshot.transport.activeVehicles,
    core.traffic.activeVehicles.length,
  );
  assert.equal(snapshot.economy.firms, core.economyDomain.firms.list().length);
  assert.deepEqual(snapshot.integrity, {
    invalidBuildingParcelReferences: 0,
    invalidPropertyParcelReferences: 0,
    totalInvalidReferences: 0,
  });
  assert.equal(
    snapshot.determinism.authorityHash,
    deterministicHash(captureAuthoritativeTransactionCheckpoint(core)),
  );
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.simulation), true);
  assert.equal(Object.isFrozen(snapshot.integrity), true);
});

test("diagnostic authority hashing is stable and changes only with authoritative state", () => {
  const core = new SimulationCore({ width: 12, height: 10, seed: 72 });
  const before = core.diagnostics.authorityHash();
  const again = core.diagnostics.authorityHash();
  assert.equal(before, again);

  const result = core.buildRoad(
    [
      { x: 2, y: 5 },
      { x: 3, y: 5 },
      { x: 4, y: 5 },
    ],
    "local",
  );
  assert.equal(result.ok, true);
  assert.notEqual(core.diagnostics.authorityHash(), before);
});

test("diagnostic trace is bounded observational state and does not alter authority hash", () => {
  const core = new SimulationCore({ width: 10, height: 8, seed: 73 });
  const before = core.diagnostics.authorityHash();
  core.diagnostics.trace.append({
    code: "test-observation",
    domain: "diagnostics",
    operation: "observe",
    tick: core.clock.tick,
  });
  assert.equal(core.diagnostics.authorityHash(), before);
  assert.equal(core.diagnostics.trace.list().at(-1)?.code, "test-observation");
});
