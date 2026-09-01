import assert from "node:assert/strict";
import test from "node:test";

import { inspectSourcePolicy } from "../scripts/repository-policy.mjs";

test("repository policy rejects eval", () => {
  const prohibitedSource = ["ev", "al", "(1)"].join("");
  const failures = inspectSourcePolicy("src/example.ts", prohibitedSource);

  assert.ok(
    failures.some((failure: string) => failure.includes("eval is prohibited")),
  );
});

test("repository policy rejects Function constructor", () => {
  const prohibitedSource = ["const fn = new", " Function", "(1)"].join("");
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

test("repository policy rejects generated and temporary repository paths", async () => {
  const policy = (await import("../scripts/repository-policy.mjs")) as Record<
    string,
    unknown
  >;
  const inspect = policy.inspectRepositoryPathPolicy;

  assert.equal(typeof inspect, "function");
  if (typeof inspect !== "function") return;

  assert.deepEqual(inspect("dist/app.js"), [
    "dist/app.js: generated/build output must not be tracked",
  ]);
  assert.deepEqual(inspect("target/debug/prism"), [
    "target/debug/prism: generated/build output must not be tracked",
  ]);
  assert.deepEqual(inspect("src/cache.ts"), []);
});

test("repository policy rejects oversized tracked binary files", async () => {
  const policy = (await import("../scripts/repository-policy.mjs")) as Record<
    string,
    unknown
  >;
  const inspect = policy.inspectRepositoryFilePolicy;

  assert.equal(typeof inspect, "function");
  if (typeof inspect !== "function") return;

  assert.deepEqual(inspect("tmp/capture.png", 6 * 1024 * 1024), [
    "tmp/capture.png: binary file exceeds 5 MiB repository limit",
  ]);
  assert.deepEqual(inspect("assets/source/house.glb", 6 * 1024 * 1024), [
    "assets/source/house.glb: binary file exceeds 5 MiB repository limit",
  ]);
  assert.deepEqual(inspect("docs/diagram.png", 256 * 1024), []);
});

test("formatting contract covers supported repository text types", async () => {
  const formatter = (await import("../scripts/format-changed.mjs")) as Record<
    string,
    unknown
  >;
  const managed = formatter.isFormattingManagedPath;

  assert.equal(typeof managed, "function");
  if (typeof managed !== "function") return;

  for (const path of [
    "src/example.ts",
    "scripts/tool.mjs",
    "package.json",
    "docs/guide.md",
    ".github/workflows/ci.yml",
    ".github/workflows/ci.yaml",
  ]) {
    assert.equal(managed(path), true, path);
  }

  for (const path of [
    "tools/check.py",
    "assets/source/sheet.svg",
    ".gitignore",
  ]) {
    assert.equal(managed(path), false, path);
  }
});

test("markdown formatting normalizes line endings without table reflow", async () => {
  const formatter = (await import("../scripts/format-changed.mjs")) as Record<
    string,
    unknown
  >;
  const normalize = formatter.normalizeMarkdown;

  assert.equal(typeof normalize, "function");
  if (typeof normalize !== "function") return;

  const source = "| A | B |  \r\n| --- | --- |\r\n| 1 | 2 |\r\n\r\n";
  assert.equal(
    normalize(source),
    "| A | B |  \n| --- | --- |\n| 1 | 2 |\n",
  );
});
