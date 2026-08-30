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
  assert.equal(await readFile(join(target, "sub", "module.js"), "utf8"), "nested");
});
