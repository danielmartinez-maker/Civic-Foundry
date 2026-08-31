import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { copyDirectory, prepareDist } from "../scripts/build.mjs";

test("prepareDist removes stale output and recreates an empty dist directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "civic-foundry-build-"));
  const dist = join(root, "dist");
  await writeFile(join(root, "stale.txt"), "outside dist");
  await prepareDist(root);
  await writeFile(join(dist, "stale.txt"), "stale build");

  await prepareDist(root);

  assert.deepEqual(await readdir(dist), []);
});

test("copyDirectory recursively copies a package tree", async () => {
  const root = await mkdtemp(join(tmpdir(), "civic-vendor-src-"));
  const source = join(root, "source");
  const target = join(root, "target");
  await mkdir(join(source, "sub"), { recursive: true });
  await writeFile(join(source, "index.js"), "root");
  await writeFile(join(source, "sub", "module.js"), "nested");

  await copyDirectory(source, target);

  assert.equal(await readFile(join(target, "index.js"), "utf8"), "root");
  assert.equal(
    await readFile(join(target, "sub", "module.js"), "utf8"),
    "nested",
  );
});

test("package scripts expose deterministic 3d asset gates", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageJson.scripts["assets:3d:check"],
    "node tools/3d/CivicAssetCompiler.mjs --check",
  );
  assert.equal(
    packageJson.scripts["assets:3d:build"],
    "node tools/3d/CivicAssetCompiler.mjs --build",
  );
  assert.equal(
    packageJson.scripts["assets:check"],
    "python tools/render_isometric_atlases.py --check && npm run assets:3d:check",
  );
  assert.equal(
    packageJson.scripts["assets:build"],
    "python tools/render_isometric_atlases.py && npm run assets:3d:build",
  );
});
