import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  firstShadowDifference,
  ShadowHash64,
  type ShadowComparable,
} from "../src/native/parity/ShadowParity.ts";
import { BuildingLifecycleSystem } from "../src/simulation/buildings/BuildingLifecycleSystem.ts";
import type {
  BuildingLifecycleState,
  BuildingTypology,
  BuildingV2,
} from "../src/simulation/buildings/BuildingTypes.ts";
import { RandomStreamRegistry } from "../src/simulation/kernel/RandomStreamRegistry.ts";
import { CadastralGraph } from "../src/world/cadastre/CadastralGraph.ts";
import {
  polygonArea,
  polygonCentroid,
  type PolygonRing,
} from "../src/world/cadastre/Geometry.ts";
import type { CadastralSnapshot } from "../src/world/cadastre/CadastralTypes.ts";
import { WorldFoundation } from "../src/world/foundation/WorldFoundation.ts";
import { resolveWorldGenerationConfig } from "../src/world/generation/WorldGenerationConfig.ts";
import type { SoilClass } from "../src/world/terrain/TerrainTypes.ts";

type FixtureParcel = Readonly<{
  id: string;
  blockId: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  zoningDistrictId: string;
  ownerId: string;
}>;

type LifecycleInputFixture = Readonly<{
  maintenanceSpend: number;
  occupancyRatio: number;
  utilizationRatio: number;
  environmentalStress: number;
  serviceStress: number;
  cadenceTicks: number;
}>;

type Fixture = Readonly<{
  schemaVersion: number;
  world: Readonly<{
    seed: number;
    width: number;
    height: number;
    metersPerCell: number;
    preset:
      | "plain"
      | "river_valley"
      | "basin"
      | "rolling_uplands"
      | "ridge_edge"
      | "coastal_lowland";
  }>;
  cadastre: Readonly<{ parcels: readonly FixtureParcel[] }>;
  urban: Readonly<{
    typology: Readonly<{
      id: string;
      maintenanceCostPerM2: number;
      complexityFactor: number;
    }>;
    building: Readonly<{
      id: string;
      parcelId: string;
      grossFloorAreaM2: number;
      ageTicks: number;
      condition: number;
      structuralCondition: number;
      systemsCondition: number;
      exteriorCondition: number;
      maintenanceBacklog: number;
      deferredMaintenanceTicks: number;
      effectiveAge: number;
      vacancyDurationTicks: number;
      distressScore: number;
    }>;
    short: Readonly<{ ticks: number; input: LifecycleInputFixture }>;
    long: Readonly<{
      ticks: number;
      stepTicks: number;
      checkpoints: readonly number[];
      input: LifecycleInputFixture;
    }>;
  }>;
  expected: Readonly<{
    worldHash: string;
    cadastreHash: string;
    shortUrbanHashes: readonly string[];
    longUrbanHashes: readonly string[];
  }>;
}>;

const SOIL_INDEX: Readonly<Record<SoilClass, number>> = Object.freeze({
  rock: 0,
  gravel: 1,
  sand: 2,
  loam: 3,
  clay: 4,
  alluvium: 5,
  peat: 6,
  fill_disturbed: 7,
});

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/cpp-world-urban-shadow/baseline.json", import.meta.url),
    "utf8",
  ),
) as Fixture;

test("Stack 1 shadow parity runs shared world/cadastre/urban fixtures through TypeScript", () => {
  assert.equal(fixture.schemaVersion, 1);

  const actual = {
    worldHash: worldHash(),
    cadastreHash: cadastreHash(),
    shortUrbanHashes: shortUrbanHashes(),
    longUrbanHashes: longUrbanHashes(),
  };

  if (fixture.expected.worldHash === "RECORD") {
    assert.fail(`TASK18_RECORD_TS ${JSON.stringify(actual)}`);
  }

  assert.deepEqual(actual, fixture.expected);
});

test("Stack 1 shadow parity reports the first entity/field divergence", () => {
  const expected = {
    parcels: [
      { id: "parcel:a", zoning: "R2", owner: "owner:a" },
      { id: "parcel:b", zoning: "C1", owner: "owner:b" },
    ],
  } satisfies ShadowComparable;
  const actual = {
    parcels: [
      { id: "parcel:a", zoning: "R2", owner: "owner:a" },
      { id: "parcel:b", zoning: "C2", owner: "owner:b" },
    ],
  } satisfies ShadowComparable;

  const difference = firstShadowDifference(expected, actual);
  assert.deepEqual(difference, {
    path: "$.parcels[1].zoning",
    expected: "C1",
    actual: "C2",
  });
});

function worldHash(): string {
  const config = resolveWorldGenerationConfig(fixture.world);
  const world = WorldFoundation.generate({
    seed: fixture.world.seed,
    config,
    randomRegistry: new RandomStreamRegistry(fixture.world.seed),
  });
  const snapshot = world.snapshotAuthoritative();
  const hash = new ShadowHash64();
  hash.mixU64(snapshot.seed);
  hash.mixU64(snapshot.config.width);
  hash.mixU64(snapshot.config.height);

  for (const sample of snapshot.terrain.samples) {
    hash.mixU64(Math.round(sample.elevationMeters * 1e6));
    hash.mixU64(SOIL_INDEX[sample.soilClass]);
    hash.mixU64(Math.round(sample.groundwaterDepthMeters * 1e5));
  }
  for (const entity of snapshot.geography.entities)
    mixRawAscii(hash, entity.id);
  for (const accumulation of snapshot.hydrology.flowAccumulation) {
    hash.mixU64(Math.round(accumulation * 1e6));
  }
  return hash.hex();
}

function cadastreHash(): string {
  const graph = new CadastralGraph(cadastralSnapshot());
  const hash = new ShadowHash64();
  for (const parcel of [...graph.listParcels()].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    hash.mixString(parcel.id);
    hash.mixString(parcel.blockId);
    for (const point of graph.parcelPolygon(parcel.id)) {
      hash.mixU64(Math.round(point.x * 100));
      hash.mixU64(Math.round(point.y * 100));
    }
    hash.mixString(parcel.zoningDistrictId);
    hash.mixString(parcel.ownerId ?? "");
  }
  return hash.hex();
}

function cadastralSnapshot(): CadastralSnapshot {
  const nodes: CadastralSnapshot["nodes"][number][] = [];
  const edges: CadastralSnapshot["edges"][number][] = [];
  const parcels: CadastralSnapshot["parcels"][number][] = [];

  for (const parcel of fixture.cadastre.parcels) {
    const ring = rectangle(parcel);
    const nodeIds = ring.map((_, index) => `${parcel.id}:node:${index}`);
    for (let index = 0; index < ring.length; index += 1) {
      nodes.push({ id: nodeIds[index]!, point: ring[index]! });
      edges.push({
        id: `${parcel.id}:edge:${index}`,
        fromNodeId: nodeIds[index]!,
        toNodeId: nodeIds[(index + 1) % nodeIds.length]!,
        leftParcelId: parcel.id,
        kind: "property-boundary",
      });
    }
    parcels.push({
      id: parcel.id,
      blockId: parcel.blockId,
      boundaryEdgeIds: edges.slice(-4).map((edge) => edge.id),
      areaM2: polygonArea(ring),
      centroid: polygonCentroid(ring),
      frontageEdgeIds: [],
      accessEdgeIds: [],
      zoningDistrictId: parcel.zoningDistrictId,
      ownerId: parcel.ownerId,
      historicalParentIds: [],
    });
  }

  const maxX = Math.max(
    ...fixture.cadastre.parcels.map((parcel) => parcel.maxX),
  );
  const maxY = Math.max(
    ...fixture.cadastre.parcels.map((parcel) => parcel.maxY),
  );
  return {
    nodes,
    edges,
    blocks: [
      {
        id: "block:0",
        boundary: [
          { x: 0, y: 0 },
          { x: maxX, y: 0 },
          { x: maxX, y: maxY },
          { x: 0, y: maxY },
        ],
        parcelIds: fixture.cadastre.parcels.map((parcel) => parcel.id),
        roadEdgeIds: [],
      },
    ],
    parcels,
    easements: [],
    lineage: [],
  };
}

function rectangle(parcel: FixtureParcel): PolygonRing {
  return [
    { x: parcel.minX, y: parcel.minY },
    { x: parcel.maxX, y: parcel.minY },
    { x: parcel.maxX, y: parcel.maxY },
    { x: parcel.minX, y: parcel.maxY },
  ];
}

function shortUrbanHashes(): string[] {
  let building = buildingFixture();
  const typology = typologyFixture();
  const lifecycle = new BuildingLifecycleSystem();
  const hashes: string[] = [];
  for (let tick = 1; tick <= fixture.urban.short.ticks; tick += 1) {
    const next = lifecycle.tick(building, typology, fixture.urban.short.input);
    building = Object.freeze({ ...building, lifecycle: next });
    hashes.push(hashLifecycle(building));
  }
  return hashes;
}

function longUrbanHashes(): string[] {
  let building = buildingFixture();
  const typology = typologyFixture();
  const lifecycle = new BuildingLifecycleSystem();
  const hashes: string[] = [];
  const checkpoints = new Set(fixture.urban.long.checkpoints);
  for (
    let tick = fixture.urban.long.stepTicks;
    tick <= fixture.urban.long.ticks;
    tick += fixture.urban.long.stepTicks
  ) {
    const next = lifecycle.tick(building, typology, fixture.urban.long.input);
    building = Object.freeze({ ...building, lifecycle: next });
    if (checkpoints.has(tick)) hashes.push(hashLifecycle(building));
  }
  return hashes;
}

function buildingFixture(): BuildingV2 {
  const source = fixture.urban.building;
  const lifecycle: BuildingLifecycleState = {
    ageTicks: source.ageTicks,
    condition: source.condition,
    structuralCondition: source.structuralCondition,
    systemsCondition: source.systemsCondition,
    exteriorCondition: source.exteriorCondition,
    maintenanceBacklog: source.maintenanceBacklog,
    deferredMaintenanceTicks: source.deferredMaintenanceTicks,
    effectiveAge: source.effectiveAge,
    vacancyDurationTicks: source.vacancyDurationTicks,
    distressScore: source.distressScore,
  };
  return {
    id: source.id,
    parcelIds: [source.parcelId],
    typologyId: fixture.urban.typology.id,
    footprint: [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ],
    grossFloorAreaM2: source.grossFloorAreaM2,
    usableFloorAreaM2: 3200,
    heightMeters: 16,
    stories: 5,
    realizedFAR: 4,
    coverageRatio: 0.4,
    floors: [],
    status: "occupied",
    yearBuilt: 2000,
    projectCost: 2_500_000,
    entitlement: {
      approvalTick: 0,
      zoningDistrictId: "R2",
      approvedFAR: 4,
      approvedHeightMeters: 16,
      approvedUses: ["residential", "retail"],
    },
    lifecycle,
  };
}

function typologyFixture(): BuildingTypology {
  const source = fixture.urban.typology;
  return {
    id: source.id,
    name: "Main Street Mixed Use",
    primaryUse: "residential",
    allowedUses: ["residential", "retail", "office"],
    defaultUseMix: { residential: 0.75, retail: 0.25 },
    preferredStories: 5,
    minStories: 3,
    maxStories: 8,
    floorToFloorHeightMeters: 3.2,
    efficiencyRatio: 0.8,
    costPerM2: 625,
    maintenanceCostPerM2: source.maintenanceCostPerM2,
    constructionTicksPer1000M2: 40,
    averageResidentialUnitAreaM2: 80,
    jobsPer1000M2ByUse: { retail: 20, office: 25 },
    powerDemandPer1000M2: 1,
    waterDemandPer1000M2: 1,
    garbagePer1000M2: 1,
    taxBasePerM2: 1,
    baseRentPerM2ByUse: { residential: 300, retail: 400, office: 350 },
    operatingExpenseRatio: 0.3,
    baseVacancy: 0.1,
    baseCapRate: 0.06,
    minimumAccess: 0,
    minimumUtilityRatio: 0,
    minimumServiceQuality: 0,
    complexityFactor: source.complexityFactor,
    riskWeight: 0.2,
    conversionSuitability: 0.82,
  };
}

function hashLifecycle(building: BuildingV2): string {
  const state = building.lifecycle;
  const hash = new ShadowHash64();
  hash.mixString(building.id);
  hash.mixString(building.typologyId);
  hash.mixU64(state.ageTicks);
  hash.mixU64(Math.round(state.condition * 1e9));
  hash.mixU64(Math.round(state.structuralCondition * 1e9));
  hash.mixU64(Math.round(state.systemsCondition * 1e9));
  hash.mixU64(Math.round(state.exteriorCondition * 1e9));
  hash.mixU64(Math.round(state.maintenanceBacklog * 1e6));
  hash.mixU64(state.deferredMaintenanceTicks);
  hash.mixU64(Math.round(state.effectiveAge * 1e9));
  hash.mixU64(Math.round(state.vacancyDurationTicks * 1e6));
  hash.mixU64(Math.round(state.distressScore * 1e9));
  return hash.hex();
}

function mixRawAscii(hash: ShadowHash64, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    hash.mixRawByte(value.charCodeAt(index));
  }
}
