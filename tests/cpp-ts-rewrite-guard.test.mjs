import assert from "node:assert/strict";
import test from "node:test";

import { evaluateInventory } from "../scripts/cpp/check-ts-rewrite-monotonic.mjs";

test("unchanged baseline passes", () => {
  const result = evaluateInventory({
    baseline: ["a.ts", "b.ts", "c.d.ts"],
    current: ["a.ts", "b.ts", "c.d.ts"],
  });

  assert.equal(result.ok, true);
  assert.equal(result.currentCount, 3);
  assert.equal(result.removedCount, 0);
  assert.deepEqual(result.newPaths, []);
});

test("removing baseline TypeScript paths passes", () => {
  const result = evaluateInventory({
    baseline: ["a.ts", "b.ts", "c.d.ts"],
    current: ["a.ts"],
  });

  assert.equal(result.ok, true);
  assert.equal(result.currentCount, 1);
  assert.equal(result.removedCount, 2);
  assert.deepEqual(result.newPaths, []);
});

test("zero tracked TypeScript files is the valid final state", () => {
  const result = evaluateInventory({
    baseline: ["a.ts", "b.ts"],
    current: [],
  });

  assert.equal(result.ok, true);
  assert.equal(result.currentCount, 0);
  assert.equal(result.removedCount, 2);
});

test("count increase fails", () => {
  const result = evaluateInventory({
    baseline: ["a.ts"],
    current: ["a.ts", "b.ts"],
  });

  assert.equal(result.ok, false);
  assert.equal(result.countIncreased, true);
  assert.deepEqual(result.newPaths, ["b.ts"]);
});

test("same-count path substitution fails", () => {
  const result = evaluateInventory({
    baseline: ["a.ts", "b.ts"],
    current: ["a.ts", "replacement.ts"],
  });

  assert.equal(result.ok, false);
  assert.equal(result.countIncreased, false);
  assert.deepEqual(result.newPaths, ["replacement.ts"]);
});
