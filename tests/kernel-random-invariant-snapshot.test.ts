import assert from "node:assert/strict";
import test from "node:test";

import { CommandBus } from "../src/simulation/kernel/CommandBus.ts";
import { DomainEventJournal } from "../src/simulation/kernel/DomainEventJournal.ts";
import { InvariantRunner } from "../src/simulation/kernel/InvariantRunner.ts";
import type { KernelStepContext } from "../src/simulation/kernel/KernelTypes.ts";
import { RandomStreamRegistry } from "../src/simulation/kernel/RandomStreamRegistry.ts";
import { SnapshotRegistry } from "../src/simulation/kernel/SnapshotRegistry.ts";

const context = (tick: number): KernelStepContext => ({
  tick,
  commands: new CommandBus(),
  events: new DomainEventJournal(),
  random: new RandomStreamRegistry(1),
  snapshots: new SnapshotRegistry(),
});

test("named random streams are deterministic and isolated", () => {
  const a = new RandomStreamRegistry(42);
  const b = new RandomStreamRegistry(42);
  assert.equal(a.stream("traffic").next(), b.stream("traffic").next());
  assert.equal(
    a.stream("demographics").next(),
    b.stream("demographics").next(),
  );
  const demographicBefore = a.stream("demographics").getState();
  for (let i = 0; i < 100; i++) a.stream("traffic").next();
  assert.equal(a.stream("demographics").getState(), demographicBefore);
});

test("different names derive independent deterministic sequences", () => {
  const registry = new RandomStreamRegistry(99);
  const traffic = Array.from({ length: 4 }, () =>
    registry.stream("traffic").next(),
  );
  const housing = Array.from({ length: 4 }, () =>
    registry.stream("housing").next(),
  );
  assert.notDeepEqual(traffic, housing);
  const repeat = new RandomStreamRegistry(99);
  assert.deepEqual(
    traffic,
    Array.from({ length: 4 }, () => repeat.stream("traffic").next()),
  );
  assert.deepEqual(
    housing,
    Array.from({ length: 4 }, () => repeat.stream("housing").next()),
  );
});

test("random stream snapshot and restore reproduce continuation exactly", () => {
  const registry = new RandomStreamRegistry(7);
  registry.stream("traffic").next();
  registry.stream("housing").next();
  const snapshot = registry.snapshot();
  const expectedTraffic = registry.stream("traffic").next();
  const expectedHousing = registry.stream("housing").next();
  registry.stream("traffic").next();
  registry.restore(snapshot);
  assert.equal(registry.stream("traffic").next(), expectedTraffic);
  assert.equal(registry.stream("housing").next(), expectedHousing);
});

test("random stream listing and snapshot keys use ordinal deterministic order", () => {
  const registry = new RandomStreamRegistry(11);
  registry.stream("zeta");
  registry.stream("alpha");
  registry.stream("Beta");
  assert.deepEqual(registry.listNames(), ["Beta", "alpha", "zeta"]);
  assert.deepEqual(Object.keys(registry.snapshot()), ["Beta", "alpha", "zeta"]);
  assert.throws(
    () => registry.stream("   "),
    /random stream name must not be empty/,
  );
});

test("invariant runner honors cadence and deterministic registration order", () => {
  const runner = new InvariantRunner();
  const seen: string[] = [];
  runner.register({
    id: "zeta",
    cadence: { every: 2, offset: 0 },
    check: ({ tick }) => seen.push(`z:${tick}`),
  });
  runner.register({
    id: "alpha",
    cadence: { every: 1 },
    check: ({ tick }) => seen.push(`a:${tick}`),
  });
  runner.runDue(1, context(1));
  runner.runDue(2, context(2));
  assert.deepEqual(seen, ["a:1", "a:2", "z:2"]);
  assert.deepEqual(
    runner.list().map((item) => item.id),
    ["alpha", "zeta"],
  );
});

test("invariant runner rejects duplicates and invalid cadence", () => {
  const runner = new InvariantRunner();
  runner.register({ id: "x", cadence: { every: 1 }, check: () => {} });
  assert.throws(
    () =>
      runner.register({ id: "x", cadence: { every: 1 }, check: () => {} }),
    /duplicate invariant: x/,
  );
  assert.throws(
    () => runner.register({ id: "", cadence: { every: 1 }, check: () => {} }),
    /invariant id must not be empty/,
  );
  assert.throws(
    () =>
      runner.register({ id: "bad", cadence: { every: 0 }, check: () => {} }),
    /invalid cadence/,
  );
});

test("invariant failure includes invariant id tick and original detail", () => {
  const runner = new InvariantRunner();
  runner.register({
    id: "population-conservation",
    cadence: { every: 1 },
    check: () => {
      throw new Error("population mismatch");
    },
  });
  assert.throws(
    () => runner.runDue(10, context(10)),
    /invariant failed \[population-conservation\] at tick 10: population mismatch/,
  );
});

test("snapshot registry rejects duplicate ids and captures in ordinal id order", () => {
  const snapshots = new SnapshotRegistry();
  snapshots.register("zeta", () => ({ value: 3 }));
  snapshots.register("alpha", () => ({ value: 1 }));
  snapshots.register("Beta", () => ({ value: 2 }));
  assert.deepEqual(snapshots.listIds(), ["Beta", "alpha", "zeta"]);
  assert.deepEqual(Object.keys(snapshots.captureAll()), ["Beta", "alpha", "zeta"]);
  assert.deepEqual(snapshots.capture("alpha"), { value: 1 });
  assert.throws(
    () => snapshots.register("alpha", () => ({})),
    /duplicate snapshot provider: alpha/,
  );
  assert.throws(
    () => snapshots.register("", () => ({})),
    /snapshot provider id must not be empty/,
  );
  assert.throws(
    () => snapshots.capture("missing"),
    /unknown snapshot provider: missing/,
  );
});

test("snapshot capture returns isolated diagnostic values", () => {
  const snapshots = new SnapshotRegistry();
  const source = { nested: { value: 1 } };
  snapshots.register("state", () => source);
  const captured = snapshots.capture("state") as { nested: { value: number } };
  captured.nested.value = 8;
  assert.equal(source.nested.value, 1);
});
