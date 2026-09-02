import assert from "node:assert/strict";
import test from "node:test";

import type {
  NativeUrbanCommand,
  NativeUrbanCommandResponse,
  NativeUrbanLegacyRequest,
  NativeUrbanSnapshot,
  NativeUrbanState,
} from "../src/native/NativeEngineTypes.ts";
import {
  withNativeUrbanAuthorityOverride,
  type NativeUrbanBridge,
} from "../src/native/urban/NativeUrbanAuthority.ts";
import { BuildingSystem } from "../src/simulation/buildings/BuildingSystem.ts";
import {
  NEW_BUILDING_LIFECYCLE,
  type BuildingV2,
} from "../src/simulation/buildings/BuildingTypes.ts";
import { SimulationCore } from "../src/simulation/core/SimulationCore.ts";
import type { Lot } from "../src/world/lots/LotSystem.ts";
import { TerrainGrid } from "../src/world/terrain/TerrainGrid.ts";

const EMPTY_URBAN_SNAPSHOT: NativeUrbanSnapshot = Object.freeze({
  urbanFabric: Object.freeze({
    nodes: Object.freeze([]),
    edges: Object.freeze([]),
    blocks: Object.freeze([]),
    parcels: Object.freeze([]),
    easements: Object.freeze([]),
    lineage: Object.freeze([]),
  }),
  zoningV2: Object.freeze({ parcelAssignments: Object.freeze([]) }),
  buildingsV2: Object.freeze([]),
  propertyMarket: Object.freeze({
    holdings: Object.freeze([]),
    transactions: Object.freeze([]),
    nextTransactionId: 1,
  }),
  legacyLots: Object.freeze([]),
  compatibilityDiagnostics: Object.freeze([]),
});

class FakeNativeUrbanBridge implements NativeUrbanBridge {
  rebuildCalls: NativeUrbanLegacyRequest[] = [];
  restoreCalls: NativeUrbanState[] = [];
  commandCalls: NativeUrbanCommand[] = [];
  stepCalls: number[] = [];
  private snapshotValue = EMPTY_URBAN_SNAPSHOT;

  rebuildUrbanLegacy(request: NativeUrbanLegacyRequest): NativeUrbanSnapshot {
    this.rebuildCalls.push(structuredClone(request));
    return this.snapshotValue;
  }

  restoreUrbanState(snapshot: NativeUrbanState): NativeUrbanSnapshot {
    this.restoreCalls.push(structuredClone(snapshot));
    this.snapshotValue = Object.freeze({
      ...structuredClone(snapshot),
      legacyLots: Object.freeze([]),
      compatibilityDiagnostics: Object.freeze([]),
    });
    return this.snapshotValue;
  }

  applyUrbanCommand(command: NativeUrbanCommand): NativeUrbanCommandResponse {
    this.commandCalls.push(structuredClone(command));
    if (command.type === "buildings.reconcile") {
      this.snapshotValue = Object.freeze({
        ...this.snapshotValue,
        buildingsV2: Object.freeze(structuredClone(command.buildingsV2)),
      });
    }
    return Object.freeze({
      result: Object.freeze({
        committed: true,
        resultingParcelIds: Object.freeze([]),
        retiredParcelIds: Object.freeze([]),
        rejectionReasons: Object.freeze([]),
        parcelReferenceRewrites: Object.freeze({}),
      }),
      snapshot: this.snapshotValue,
    });
  }

  step(ticks = 1): void {
    this.stepCalls.push(ticks);
  }

  urbanSnapshot(): NativeUrbanSnapshot {
    return this.snapshotValue;
  }

  loadV9(): void {}

  saveV9<T = unknown>(): T {
    return {} as T;
  }
}

function buildableTerrain(): TerrainGrid {
  return TerrainGrid.fromCells(
    2,
    1,
    Object.freeze([
      Object.freeze({
        elevation: 0.5,
        water: false,
        buildable: true,
        biome: "grass" as const,
      }),
      Object.freeze({
        elevation: 0.5,
        water: false,
        buildable: true,
        biome: "grass" as const,
      }),
    ]),
  );
}

function canonicalBuilding(): BuildingV2 {
  return Object.freeze({
    id: "building:parcel:test",
    parcelIds: Object.freeze(["parcel:test"]),
    typologyId: "typology:residential_rowhouse",
    footprint: Object.freeze([
      Object.freeze({ x: 0, y: 0 }),
      Object.freeze({ x: 10, y: 0 }),
      Object.freeze({ x: 10, y: 10 }),
      Object.freeze({ x: 0, y: 10 }),
    ]),
    grossFloorAreaM2: 180,
    usableFloorAreaM2: 150,
    heightMeters: 9.6,
    stories: 3,
    realizedFAR: 0.45,
    coverageRatio: 0.25,
    floors: Object.freeze([]),
    status: "occupied",
    yearBuilt: 12,
    projectCost: 250_000,
    entitlement: Object.freeze({
      approvalTick: 12,
      zoningDistrictId: "residential",
      approvedFAR: 1,
      approvedHeightMeters: 12,
      approvedUses: Object.freeze(["residential" as const]),
    }),
    lifecycle: NEW_BUILDING_LIFECYCLE,
  });
}

test("Task 20 keeps BuildingV2 native-first after construction override scope ends", () => {
  const bridge = new FakeNativeUrbanBridge();
  const core = withNativeUrbanAuthorityOverride(
    { enabled: true, bridge },
    () =>
      new SimulationCore({
        seed: 19,
        terrain: buildableTerrain(),
        terrainMode: "legacy-explicit",
      }),
  );

  const rebuildsAfterConstruction = bridge.rebuildCalls.length;
  const restoresAfterConstruction = bridge.restoreCalls.length;
  const commandsAfterConstruction = bridge.commandCalls.length;
  assert.ok(rebuildsAfterConstruction > 0);

  core.step(1);

  assert.equal(bridge.restoreCalls.length, restoresAfterConstruction);
  assert.deepEqual(bridge.stepCalls, [1]);
  const reconcileCalls = bridge.commandCalls
    .slice(commandsAfterConstruction)
    .filter(
      (
        command,
      ): command is Extract<
        NativeUrbanCommand,
        Readonly<{ type: "buildings.reconcile" }>
      > => command.type === "buildings.reconcile",
    );
  assert.equal(reconcileCalls.length, 2);
  assert.equal(reconcileCalls[0]?.requireHbuForNewBuildings, false);
  assert.equal(reconcileCalls[1]?.requireHbuForNewBuildings, true);

  const painted = core.paintZone([{ x: 0, y: 0 }], "residential");
  assert.equal(painted.painted, 1);
  assert.equal(bridge.rebuildCalls.length, rebuildsAfterConstruction + 1);
});

test("Task 20 legacy BuildingSystem is rebuilt from native BuildingV2 and cannot retain deleted buildings", () => {
  const buildings = new BuildingSystem();
  const lots: readonly Lot[] = Object.freeze([
    Object.freeze({
      id: "lot:0,0",
      x: 0,
      y: 0,
      zone: "residential",
      frontageRoadKey: "0,-1",
    }),
  ]);
  const compatibility = Object.freeze([
    Object.freeze({
      parcelId: "parcel:test",
      x: 0,
      y: 0,
      faithful: true,
    }),
  ]);

  buildings.restoreLegacyProjectionFromV2(
    Object.freeze([canonicalBuilding()]),
    lots,
    compatibility,
  );
  assert.deepEqual(
    buildings.list().map((building) => building.id),
    ["building:lot:0,0"],
  );
  assert.equal(buildings.list()[0]?.definitionId, "residential_rowhouse");
  assert.equal(buildings.list()[0]?.status, "occupied");

  buildings.restoreLegacyProjectionFromV2(
    Object.freeze([]),
    lots,
    compatibility,
  );
  assert.deepEqual(buildings.list(), []);
});
