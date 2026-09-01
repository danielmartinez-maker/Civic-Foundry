import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizePoint,
  normalizeRing,
  polygonDifference,
  polygonIntersection,
  polygonUnion,
  type PolygonRing,
  type WorldPoint,
} from "../src/world/cadastre/Geometry.ts";

type NormalizationCase =
  | Readonly<{
      name: string;
      kind: "point";
      input: WorldPoint;
      expected: WorldPoint;
    }>
  | Readonly<{
      name: string;
      kind: "ring";
      input: PolygonRing;
      expected: PolygonRing;
    }>;

type BooleanCase = Readonly<{
  name: string;
  operation: "intersection" | "union" | "difference";
  subject: PolygonRing;
  clip?: PolygonRing;
  expected: readonly PolygonRing[];
}>;

type GeometryFixture = Readonly<{
  normalization: readonly NormalizationCase[];
  booleans: readonly BooleanCase[];
}>;

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/prism-p2a/geometry-cases.json", import.meta.url),
    "utf8",
  ),
) as GeometryFixture;

test("P2A geometry fixtures freeze the TypeScript centimeter normalization oracle", () => {
  for (const entry of fixture.normalization) {
    if (entry.kind === "point") {
      assert.deepEqual(normalizePoint(entry.input), entry.expected, entry.name);
    } else {
      assert.deepEqual(normalizeRing(entry.input), entry.expected, entry.name);
    }
  }
});

test("P2A geometry fixtures freeze canonical TypeScript boolean outputs", () => {
  for (const entry of fixture.booleans) {
    const actual = (() => {
      switch (entry.operation) {
        case "intersection":
          assert.ok(entry.clip, `${entry.name} requires clip geometry`);
          return polygonIntersection(entry.subject, entry.clip);
        case "difference":
          assert.ok(entry.clip, `${entry.name} requires clip geometry`);
          return polygonDifference(entry.subject, entry.clip);
        case "union":
          return polygonUnion(entry.subject, entry.clip);
      }
    })();

    assert.deepEqual(actual, entry.expected, entry.name);
  }
});
