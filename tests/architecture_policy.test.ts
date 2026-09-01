import assert from "node:assert/strict";
import test from "node:test";

import { checkArchitectureImport } from "../scripts/check-architecture.mjs";

test("simulation cannot depend on UI", () => {
  assert.equal(
    checkArchitectureImport("src/simulation/A.ts", "src/ui/B.ts")?.rule,
    "simulation-no-ui",
  );
});

test("world cannot depend on rendering", () => {
  assert.equal(
    checkArchitectureImport("src/world/A.ts", "src/rendering/B.ts")?.rule,
    "world-no-rendering",
  );
});

test("save cannot depend on 3d rendering", () => {
  assert.equal(
    checkArchitectureImport("src/save/A.ts", "src/rendering/3d/B.ts")?.rule,
    "save-no-rendering",
  );
});

test("rendering cannot depend on UI", () => {
  assert.equal(
    checkArchitectureImport("src/rendering/A.ts", "src/ui/B.ts")?.rule,
    "rendering-no-ui",
  );
});

test("application layer may consume simulation", () => {
  assert.equal(
    checkArchitectureImport("src/app/A.ts", "src/simulation/B.ts"),
    null,
  );
});

test("authoritative simulation, world, and save layers cannot import Babylon", () => {
  assert.equal(
    checkArchitectureImport("src/simulation/A.ts", "@babylonjs/core/scene.js")
      ?.rule,
    "authoritative-no-babylon",
  );
  assert.equal(
    checkArchitectureImport("src/world/A.ts", "@babylonjs/core/Meshes/mesh.js")
      ?.rule,
    "authoritative-no-babylon",
  );
  assert.equal(
    checkArchitectureImport("src/save/A.ts", "@babylonjs/loaders/glTF/index.js")
      ?.rule,
    "authoritative-no-babylon",
  );
});

test("authoritative layers cannot import glTF Transform tooling", () => {
  assert.equal(
    checkArchitectureImport("src/simulation/A.ts", "@gltf-transform/core")
      ?.rule,
    "authoritative-no-gltf-transform",
  );
});

test("3d presentation layer may import Babylon", () => {
  assert.equal(
    checkArchitectureImport(
      "src/rendering/3d/A.ts",
      "@babylonjs/core/scene.js",
    ),
    null,
  );
});
