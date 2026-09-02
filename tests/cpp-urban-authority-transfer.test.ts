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
import { SimulationCore } from "../src/simulation/core/SimulationCore.ts";
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
    return Object.freeze({
      result: Object.freeze({
        committed: false,
        resultingParcelIds: Object.freeze([]),
        retiredParcelIds: Object.freeze([]),
        rejectionReasons: Object.freeze(["fake-command-not-configured"]),
        parcelReferenceRewrites: Object.freeze({}),
      }),
      snapshot: this.snapshotValue,
    });
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

test("Task 20 keeps the native urban bridge attached after construction override scope ends", () => {
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
  assert.ok(rebuildsAfterConstruction > 0);
  assert.ok(restoresAfterConstruction > 0);

  core.step(1);
  assert.equal(bridge.restoreCalls.length, restoresAfterConstruction + 1);

  const painted = core.paintZone([{ x: 0, y: 0 }], "residential");
  assert.equal(painted.painted, 1);
  assert.equal(bridge.rebuildCalls.length, rebuildsAfterConstruction + 1);
});
