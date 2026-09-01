import test from "node:test";
import assert from "node:assert/strict";

import { hydrateCore, serializeCore } from "../src/save/save.ts";
import { SimulationCore } from "../src/simulation/core/SimulationCore.ts";

test("canonical Save V9 serialization and hydration publish runtime performance attribution", () => {
  const core = new SimulationCore({ width: 12, height: 10, seed: 811 });
  core.kernel.performance.reset();

  const save = serializeCore(core);
  assert.equal(save.saveVersion, 9);
  assert.equal(core.diagnostics.snapshot().performance["save.serialize"]?.calls, 1);

  const loaded = hydrateCore(save);
  assert.equal(
    loaded.diagnostics.snapshot().performance["save.hydrate"]?.calls,
    1,
  );
  assert.equal(loaded.diagnostics.snapshot().simulation.faulted, false);
});
