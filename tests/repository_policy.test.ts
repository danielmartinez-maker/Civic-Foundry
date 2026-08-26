import assert from "node:assert/strict";
import test from "node:test";

import { inspectSourcePolicy } from "../scripts/repository-policy.mjs";

test("repository policy rejects eval", () => {
  const prohibitedSource = ["ev", "al", '("1 + 1")'].join("");
  const failures = inspectSourcePolicy("src/example.ts", prohibitedSource);

  assert.ok(
    failures.some((failure: string) => failure.includes("eval is prohibited")),
  );
});

test("repository policy rejects Function constructor", () => {
  const prohibitedSource = [
    "const fn = new",
    " Function",
    '("return 1")',
  ].join("");
  const failures = inspectSourcePolicy("src/example.ts", prohibitedSource);

  assert.ok(
    failures.some((failure: string) =>
      failure.includes("Function constructor is prohibited"),
    ),
  );
});

test("repository policy preserves GameApp interpolation guard", () => {
  const failures = inspectSourcePolicy(
    "src/app/GameApp.ts",
    "const html = `<h1>${line.name}</h1>`;",
  );

  assert.ok(
    failures.some((failure: string) =>
      failure.includes("user-controlled text must be escaped"),
    ),
  );
});
