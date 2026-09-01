import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import type { PrismP2AImportEnvelopeV1 } from "../src/prism/compat/P2AEnvelope.ts";
import { exportPrismP2AEnvelope } from "../src/prism/compat/P2AExporter.ts";
import type { P2AMutationCommand } from "../src/prism/compat/P2AMutationCommands.ts";
import { SimulationCore } from "../src/simulation/core/SimulationCore.ts";
import { hydrateCoreV9, serializeCoreV9 } from "../src/save/saveV9.ts";
import type {
  CadastralSnapshot,
  Easement,
  Parcel,
  ParcelEdge,
  ParcelLineageEvent,
  ParcelNode,
  UrbanBlock,
} from "../src/world/cadastre/CadastralTypes.ts";
import type { WorldPoint } from "../src/world/cadastre/Geometry.ts";
import {
  TerrainGrid,
  type TerrainCell,
} from "../src/world/terrain/TerrainGrid.ts";

export type P2AParityStaticCase = Readonly<{
  name: string;
  envelope: PrismP2AImportEnvelopeV1;
}>;

export type P2AParityMutationCase = Readonly<{
  name: string;
  envelope: PrismP2AImportEnvelopeV1;
  commands: readonly P2AMutationCommand[];
}>;

export type P2AParityMalformedCase = Readonly<{
  name: string;
  envelope: unknown;
  expectedCategory: "schema" | "source-version" | "world" | "cadastre";
  expectedCode: string;
}>;

export type P2AParityFixtureManifest = Readonly<{
  formatVersion: 1;
  staticCases: readonly P2AParityStaticCase[];
  mutationCases: readonly P2AParityMutationCase[];
  malformedCases: readonly P2AParityMalformedCase[];
}>;

const OUTPUT_URL = new URL(
  "../tests/fixtures/prism-p2a/parity-cases.json",
  import.meta.url,
);
const HASH_VECTORS_URL = new URL(
  "../tests/fixtures/prism-p2a/hash-vectors.json",
  import.meta.url,
);

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value), null, 2);
}

export function buildP2AParityFixtureManifest(): P2AParityFixtureManifest {
  const generated = baseGeneratedEnvelope();
  const legacy = legacyFlatEnvelope();
  const shared = withCadastre(generated, adjacentParcelsCadastre());
  const easementLineage = withCadastre(generated, easementLineageCadastre());
  const saveRoundTrip = saveV9RoundTripEnvelope();
  const single = withCadastre(generated, singleParcelCadastre());

  const splitChild0 = "parcel:p0:split:1:0";
  const splitChild1 = "parcel:p0:split:1:1";
  const assembled = `parcel:assembly:2:${splitChild0}+${splitChild1}`;
  const sequenceEasement = `easement:utility:${assembled}`;

  const staticCases: readonly P2AParityStaticCase[] = Object.freeze([
    Object.freeze({ name: "legacy-flat-minimal", envelope: legacy }),
    Object.freeze({
      name: "generated-1r-geography-hydrology",
      envelope: generated,
    }),
    Object.freeze({ name: "shared-boundary-block", envelope: shared }),
    Object.freeze({ name: "easement-lineage", envelope: easementLineage }),
    Object.freeze({
      name: "save-v9-round-trip-envelope",
      envelope: saveRoundTrip,
    }),
  ]);

  const mutationCases: readonly P2AParityMutationCase[] = Object.freeze([
    Object.freeze({
      name: "split",
      envelope: single,
      commands: Object.freeze([
        Object.freeze({
          kind: "split",
          parcelId: "p0",
          cutLine: Object.freeze([p(20, 0), p(20, 20)]),
        }),
      ]),
    }),
    Object.freeze({
      name: "assembly",
      envelope: shared,
      commands: Object.freeze([
        Object.freeze({
          kind: "assemble",
          parcelIds: Object.freeze(["p1", "p0"]),
        }),
      ]),
    }),
    Object.freeze({
      name: "easement-create-remove",
      envelope: single,
      commands: Object.freeze([
        Object.freeze({
          kind: "create-easement",
          parcelIds: Object.freeze(["p0"]),
          easementKind: "utility",
          geometry: Object.freeze([p(5, 5), p(35, 5)]),
        }),
        Object.freeze({
          kind: "remove-easement",
          easementId: "easement:utility:p0",
        }),
      ]),
    }),
    Object.freeze({
      name: "right-of-way",
      envelope: single,
      commands: Object.freeze([
        Object.freeze({
          kind: "right-of-way",
          parcelId: "p0",
          geometry: Object.freeze([p(0, 0), p(5, 0), p(5, 20), p(0, 20)]),
        }),
      ]),
    }),
    Object.freeze({
      name: "mutation-sequence",
      envelope: single,
      commands: Object.freeze([
        Object.freeze({
          kind: "split",
          parcelId: "p0",
          cutLine: Object.freeze([p(20, 0), p(20, 20)]),
        }),
        Object.freeze({
          kind: "assemble",
          parcelIds: Object.freeze([splitChild1, splitChild0]),
        }),
        Object.freeze({
          kind: "create-easement",
          parcelIds: Object.freeze([assembled]),
          easementKind: "utility",
          geometry: Object.freeze([p(5, 5), p(35, 5)]),
        }),
        Object.freeze({
          kind: "remove-easement",
          easementId: sequenceEasement,
        }),
        Object.freeze({
          kind: "right-of-way",
          parcelId: assembled,
          geometry: Object.freeze([p(0, 0), p(5, 0), p(5, 20), p(0, 20)]),
        }),
      ]),
    }),
  ]);

  const malformedCases: readonly P2AParityMalformedCase[] = Object.freeze([
    Object.freeze({
      name: "unsupported-schema",
      envelope: { ...structuredClone(generated), schemaVersion: 2 },
      expectedCategory: "schema",
      expectedCode: "unsupported-schema",
    }),
    Object.freeze({
      name: "unsupported-source-save",
      envelope: { ...structuredClone(generated), sourceSaveVersion: 8 },
      expectedCategory: "source-version",
      expectedCode: "unsupported-source-version",
    }),
    Object.freeze({
      name: "terrain-length-mismatch",
      envelope: mutateEnvelope(generated, (copy) => {
        copy.world.terrain.samples.pop();
      }),
      expectedCategory: "world",
      expectedCode: "terrain-length-mismatch",
    }),
    Object.freeze({
      name: "parcel-area-mismatch",
      envelope: mutateEnvelope(generated, (copy) => {
        copy.cadastre.parcels[0]!.areaM2 -= 1;
      }),
      expectedCategory: "cadastre",
      expectedCode: "parcel-area-mismatch",
    }),
  ]);

  return Object.freeze({
    formatVersion: 1,
    staticCases,
    mutationCases,
    malformedCases,
  });
}

function baseGeneratedEnvelope(): PrismP2AImportEnvelopeV1 {
  const manifest = JSON.parse(
    readFileSync(HASH_VECTORS_URL, "utf8"),
  ) as Readonly<{
    vectors: readonly Readonly<{
      name: string;
      envelope: PrismP2AImportEnvelopeV1;
    }>[];
  }>;
  const vector =
    manifest.vectors.find((entry) => entry.name === "minimal-valid") ??
    manifest.vectors[0];
  if (!vector)
    throw new Error("P2A hash vectors must contain a valid base envelope");
  return structuredClone(vector.envelope);
}

function legacyFlatEnvelope(): PrismP2AImportEnvelopeV1 {
  const core = new SimulationCore({
    terrain: flatTerrain(4, 3),
    terrainMode: "legacy-flat",
    seed: 311,
    startingFunds: 100_000,
  });
  const envelope = exportPrismP2AEnvelope(core);
  if (envelope.world.mode !== "legacy-flat") {
    throw new Error(
      `legacy fixture expected legacy-flat world, found ${envelope.world.mode}`,
    );
  }
  return structuredClone(envelope);
}

function saveV9RoundTripEnvelope(): PrismP2AImportEnvelopeV1 {
  const core = new SimulationCore({
    terrain: flatTerrain(8, 6),
    seed: 313,
    startingFunds: 500_000,
  });
  if (
    !core.buildRoad(
      [
        { x: 2, y: 3 },
        { x: 3, y: 3 },
      ],
      "local",
    ).ok
  ) {
    throw new Error("Save V9 fixture road construction failed");
  }
  if (
    core.paintZone(
      [
        { x: 2, y: 2 },
        { x: 3, y: 2 },
      ],
      "residential",
    ).painted !== 2
  ) {
    throw new Error("Save V9 fixture zoning failed");
  }
  core.rebuildCadastreFromLegacyState();
  const restored = hydrateCoreV9(structuredClone(serializeCoreV9(core)));
  return structuredClone(exportPrismP2AEnvelope(restored));
}

function flatTerrain(width: number, height: number): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: "grass" as const,
  }));
  return new TerrainGrid(width, height, cells);
}

function withCadastre(
  envelope: PrismP2AImportEnvelopeV1,
  cadastre: CadastralSnapshot,
): PrismP2AImportEnvelopeV1 {
  return structuredClone({ ...envelope, cadastre });
}

function singleParcelCadastre(): CadastralSnapshot {
  return {
    nodes: [
      node("n0", 0, 0),
      node("n1", 40, 0),
      node("n2", 40, 20),
      node("n3", 0, 20),
    ],
    edges: [
      edge("e0", "n0", "n1", "p0", undefined, "street-frontage", "south"),
      edge("e1", "n1", "n2", "p0"),
      edge("e2", "n2", "n3", "p0"),
      edge("e3", "n3", "n0", "p0"),
    ],
    blocks: [block(["p0"], ["e0"], [p(0, 0), p(40, 0), p(40, 20), p(0, 20)])],
    parcels: [parcel("p0", ["e0", "e1", "e2", "e3"], 800, p(20, 10), ["e0"])],
    easements: [],
    lineage: [],
  };
}

function adjacentParcelsCadastre(): CadastralSnapshot {
  return {
    nodes: [
      node("n0", 0, 0),
      node("n1", 20, 0),
      node("n2", 40, 0),
      node("n3", 40, 20),
      node("n4", 20, 20),
      node("n5", 0, 20),
    ],
    edges: [
      edge("e0", "n0", "n1", "p0", undefined, "street-frontage", "south:p0"),
      edge("e1", "n1", "n2", "p1", undefined, "street-frontage", "south:p1"),
      edge("e2", "n1", "n4", "p0", "p1"),
      edge("e3", "n4", "n5", "p0"),
      edge("e4", "n5", "n0", "p0"),
      edge("e5", "n2", "n3", "p1"),
      edge("e6", "n3", "n4", "p1"),
    ],
    blocks: [
      block(
        ["p0", "p1"],
        ["e0", "e1"],
        [p(0, 0), p(40, 0), p(40, 20), p(0, 20)],
      ),
    ],
    parcels: [
      parcel("p0", ["e0", "e2", "e3", "e4"], 400, p(10, 10), ["e0"]),
      parcel("p1", ["e1", "e5", "e6", "e2"], 400, p(30, 10), ["e1"]),
    ],
    easements: [],
    lineage: [],
  };
}

function easementLineageCadastre(): CadastralSnapshot {
  const cadastre = singleParcelCadastre();
  const easement: Easement = {
    id: "easement:utility:p0",
    parcelIds: ["p0"],
    kind: "utility",
    geometry: [p(5, 5), p(35, 5)],
  };
  const lineage: ParcelLineageEvent = {
    id: "lineage:0:easement",
    tick: 0,
    kind: "easement",
    sourceParcelIds: ["legacy:p0"],
    resultingParcelIds: ["p0"],
  };
  return { ...cadastre, easements: [easement], lineage: [lineage] };
}

function mutateEnvelope(
  envelope: PrismP2AImportEnvelopeV1,
  mutate: (copy: any) => void,
): PrismP2AImportEnvelopeV1 {
  const copy = structuredClone(envelope) as any;
  mutate(copy);
  return copy as PrismP2AImportEnvelopeV1;
}

function node(id: string, x: number, y: number): ParcelNode {
  return { id, point: p(x, y) };
}

function edge(
  id: string,
  fromNodeId: string,
  toNodeId: string,
  leftParcelId: string,
  rightParcelId?: string,
  kind: ParcelEdge["kind"] = "property-boundary",
  roadRef?: string,
): ParcelEdge {
  return {
    id,
    fromNodeId,
    toNodeId,
    leftParcelId,
    ...(rightParcelId === undefined ? {} : { rightParcelId }),
    kind,
    ...(roadRef === undefined ? {} : { roadRef }),
  };
}

function block(
  parcelIds: string[],
  roadEdgeIds: string[],
  boundary: WorldPoint[],
): UrbanBlock {
  return { id: "b0", parcelIds, roadEdgeIds, boundary };
}

function parcel(
  id: string,
  boundaryEdgeIds: string[],
  areaM2: number,
  centroid: WorldPoint,
  frontageEdgeIds: string[],
): Parcel {
  return {
    id,
    blockId: "b0",
    boundaryEdgeIds,
    areaM2,
    centroid,
    frontageEdgeIds,
    accessEdgeIds: [...frontageEdgeIds],
    zoningDistrictId: "R2",
    historicalParentIds: [],
  };
}

function p(x: number, y: number): WorldPoint {
  return { x, y };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => stableValue(entry));
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      result[key] = stableValue((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  return value;
}

function main(): void {
  const expected = `${stableStringify(buildP2AParityFixtureManifest())}\n`;
  const check = process.argv.includes("--check");
  const write = process.argv.includes("--write");
  if (check === write) {
    throw new Error(
      "P2A fixture tool requires exactly one of --write or --check",
    );
  }
  if (write) {
    writeFileSync(OUTPUT_URL, expected, "utf8");
    return;
  }
  if (!existsSync(OUTPUT_URL)) {
    throw new Error(
      "P2A parity fixture file is missing; run npm run prism:p2a:fixtures",
    );
  }
  const actual = readFileSync(OUTPUT_URL, "utf8");
  if (actual !== expected) {
    throw new Error(
      "P2A parity fixtures are stale; run npm run prism:p2a:fixtures",
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}

export const parityFixtureFileExists = (): boolean => existsSync(OUTPUT_URL);
