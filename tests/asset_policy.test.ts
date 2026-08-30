import assert from "node:assert/strict";
import test from "node:test";

import { isForbiddenAssetPath } from "../scripts/check-assets.mjs";

test("deterministic SVG source contracts remain allowed", () => {
  assert.equal(isForbiddenAssetPath("assets/source/terrain.svg"), false);
});

test("tracked JSON 3D recipes are allowed while tracked GLB remains forbidden", () => {
  assert.equal(
    isForbiddenAssetPath("assets/source/3d/buildings/house.asset.json"),
    false,
  );
  assert.equal(
    isForbiddenAssetPath("assets/source/3d/buildings/house.glb"),
    true,
  );
});

test("raw raster assets under assets are rejected", () => {
  assert.equal(isForbiddenAssetPath("assets/raw/terrain.png"), true);
});

test("raw audio assets under assets are rejected", () => {
  assert.equal(isForbiddenAssetPath("assets/raw/music.wav"), true);
});

test("test fixtures are allowed", () => {
  assert.equal(isForbiddenAssetPath("tests/fixtures/sample.png"), false);
});
