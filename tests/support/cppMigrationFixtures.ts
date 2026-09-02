import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { SimulationCore } from "../../src/simulation/core/SimulationCore.ts";
import { SimulationClock } from "../../src/simulation/core/SimulationClock.ts";
import { SimulationKernel } from "../../src/simulation/kernel/SimulationKernel.ts";
import { serializeCoreV9 } from "../../src/save/saveV9.ts";
import { TerrainGrid } from "../../src/world/terrain/TerrainGrid.ts";
import { canonicalStringify, digestCanonical } from "./kernelParity.ts";

export type MigrationCommand = Readonly<{
  sequence: number;
  tick: number;
  type: string;
  payload: unknown;
}>;

export type MigrationSaveInput =
  | Readonly<{ kind: "fresh"; startTick: number; speed: 0 | 1 | 2 | 4 }>
  | Readonly<{
      kind: "v9";
      fixture: "urban-fabric" | "cadastral-history";
    }>;

export type MigrationScenario = Readonly<{
  id: string;
  source: string;
  seed: number;
  saveInput: MigrationSaveInput;
  commandJournal: readonly MigrationCommand[];
  targetTicks: readonly number[];
  expectedDomainHashes: Readonly<Record<string, string>>;
  expectedInvariants: Readonly<Record<string, boolean>>;
  classification: "PARITY" | "CORRECTION" | "DEFERRED";
}>;

export type MigrationManifest = Readonly<{
  version: number;
  stackId: string;
  baselineCommit: string;
  saveVersion: number;
  scenarios: readonly MigrationScenario[];
}>;

export type MigrationCheckpoint = Readonly<{
  snapshot: Readonly<{
    hashVersion: 1;
    pendingCommands: readonly Readonly<{
      payload: string;
      sequence: number;
      tick: number;
      type: string;
    }>[];
    randomStreams: Readonly<Record<string, number>>;
    seed: number;
    speed: 0 | 1 | 2 | 4;
    tick: number;
  }>;
  events: readonly Readonly<{
    payload: string;
    sequence: number;
    source: string;
    tick: number;
    type: string;
  }>[];
  domainHashes: Readonly<
    Record<
      string,
      Readonly<{ ownership: "owned" | "unowned"; version: number; value: string }>
    >
  >;
}>;

export type MigrationScenarioResult = Readonly<{
  id: string;
  saveInputHash: string | null;
  checkpoints: Readonly<Record<string, MigrationCheckpoint>>;
}>;

export const MIGRATION_HASH_DOMAINS = Object.freeze([
  "kernel",
  "world",
  "cadastre",
  "buildings",
  "transportation",
  "population",
  "economy",
  "services",
] as const);

export function loadMigrationManifest(): MigrationManifest {
  return JSON.parse(
    readFileSync("tests/fixtures/cpp-migration/manifest.json", "utf8"),
  ) as MigrationManifest;
}

function flatTerrain(width = 8, height = 6): TerrainGrid {
  return new TerrainGrid(
    width,
    height,
    Array.from({ length: width * height }, () => ({
      elevation: 0.5,
      water: false,
      buildable: true,
      biome: "grass" as const,
    })),
  );
}

export function createUrbanFabricV9Save(
  seed = 91,
): ReturnType<typeof serializeCoreV9> {
  const core = new SimulationCore({
    terrain: flatTerrain(),
    seed,
    startingFunds: 500_000,
  });
  assert.equal(core.buildRoad([{ x: 2, y: 3 }], "local").ok, true);
  assert.equal(
    core.paintZone([{ x: 2, y: 2 }], "residential").painted,
    1,
  );
  core.buildings.restore([
    {
      id: "building:lot:2,2",
      lotId: "lot:2,2",
      x: 2,
      y: 2,
      zone: "residential",
      definitionId: "residential_cottage",
      status: "occupied",
      constructionStartedTick: 0,
      completionTick: 0,
    },
  ]);
  core.rebuildCadastreFromLegacyState();

  const parcel = core.cadastre.listParcels()[0];
  assert.ok(parcel);
  core.zoning.assignParcel(parcel.id, "R5");
  core.propertyMarket.restore({
    holdings: [
      {
        parcelId: parcel.id,
        ownerId: "owner:a",
        reservationValue: 100_000,
      },
    ],
    transactions: [],
    nextTransactionId: 1,
  });
  core.propertyMarket.transact({
    tick: 3,
    parcelIds: [parcel.id],
    buyerId: "owner:b",
    sellerId: "owner:a",
    purpose: "sale",
    price: 120_000,
    landValue: 80_000,
    improvementValue: 40_000,
  });
  return serializeCoreV9(core);
}

export function createCadastralHistoryV9Save(
  seed = 93,
): ReturnType<typeof serializeCoreV9> {
  const save = createUrbanFabricV9Save(seed);
  const liveParcelId = save.urbanFabric.parcels[0]?.id;
  assert.ok(liveParcelId);
  const retiredParcelId = "parcel:retired:cpp-migration";
  const transaction = save.propertyMarket.transactions[0];
  assert.ok(transaction);
  return {
    ...save,
    urbanFabric: {
      ...save.urbanFabric,
      lineage: [
        ...save.urbanFabric.lineage,
        {
          id: "lineage:cpp-migration:1",
          tick: 4,
          kind: "split",
          sourceParcelIds: [retiredParcelId],
          resultingParcelIds: [liveParcelId],
        },
      ],
    },
    propertyMarket: {
      ...save.propertyMarket,
      transactions: [
        ...save.propertyMarket.transactions,
        {
          ...transaction,
          id: "property:tx:cpp-migration:2",
          parcelIds: [retiredParcelId],
        },
      ],
      nextTransactionId: save.propertyMarket.nextTransactionId + 1,
    },
  };
}

export function materializeMigrationSaveInput(
  scenario: MigrationScenario,
): ReturnType<typeof serializeCoreV9> | null {
  if (scenario.saveInput.kind === "fresh") return null;
  if (scenario.saveInput.fixture === "urban-fabric") {
    return createUrbanFabricV9Save(scenario.seed);
  }
  return createCadastralHistoryV9Save(scenario.seed);
}

function fnv1a64(text: string): string {
  let hash = 14_695_981_039_346_656_037n;
  const prime = 1_099_511_628_211n;
  for (const byte of Buffer.from(text, "utf8")) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString();
}

function checkpointFor(
  kernel: SimulationKernel,
  seed: number,
  eventSequenceExclusive: number,
): MigrationCheckpoint {
  const snapshot = Object.freeze({
    hashVersion: 1 as const,
    pendingCommands: Object.freeze(
      kernel.commands.pending().map((command) =>
        Object.freeze({
          payload: canonicalStringify(command.command.payload),
          sequence: command.sequence,
          tick: command.enqueuedTick,
          type: command.command.type,
        }),
      ),
    ),
    randomStreams: kernel.random.snapshot(),
    seed,
    speed: kernel.clock.speed,
    tick: kernel.clock.tick,
  });
  const events = Object.freeze(
    kernel.events.since(eventSequenceExclusive).map((event) =>
      Object.freeze({
        payload: String(event.payload),
        sequence: event.sequence,
        source: event.source,
        tick: event.tick,
        type: event.type,
      }),
    ),
  );
  const kernelValue = fnv1a64(canonicalStringify(snapshot));
  const domainHashes: Record<
    string,
    Readonly<{ ownership: "owned" | "unowned"; version: number; value: string }>
  > = {};
  for (const domain of MIGRATION_HASH_DOMAINS) {
    domainHashes[domain] = Object.freeze(
      domain === "kernel"
        ? { ownership: "owned", version: 1, value: kernelValue }
        : { ownership: "unowned", version: 1, value: "0" },
    );
  }
  return Object.freeze({
    snapshot,
    events,
    domainHashes: Object.freeze(domainHashes),
  });
}

export function runTypeScriptMigrationScenario(
  scenario: MigrationScenario,
): MigrationScenarioResult {
  const save = materializeMigrationSaveInput(scenario);
  const clock = new SimulationClock();
  const startTick =
    save?.clock.tick ??
    (scenario.saveInput.kind === "fresh" ? scenario.saveInput.startTick : 0);
  const speed =
    save?.clock.speed ??
    (scenario.saveInput.kind === "fresh" ? scenario.saveInput.speed : 1);
  const seed = save?.seed ?? scenario.seed;
  clock.restore(startTick, speed);
  const kernel = new SimulationKernel({ clock, seed });

  for (const type of new Set(scenario.commandJournal.map((command) => command.type))) {
    kernel.commands.registerHandler(type, (command, context) => {
      context.events.append(context.tick, {
        type: command.command.type,
        source: "shadow-command",
        payload: canonicalStringify(command.command.payload),
      });
    });
  }

  for (const command of scenario.commandJournal) {
    const sequence = kernel.commands.enqueue(
      { type: command.type, payload: command.payload },
      command.tick,
    );
    assert.equal(
      sequence,
      command.sequence,
      `${scenario.id} command sequence must match the shared journal`,
    );
  }

  const checkpoints: Record<string, MigrationCheckpoint> = {};
  let eventSequenceExclusive = 0;
  for (const targetTick of [...scenario.targetTicks].sort((a, b) => a - b)) {
    assert.ok(
      targetTick >= kernel.clock.tick,
      `${scenario.id} target tick ${targetTick} precedes ${kernel.clock.tick}`,
    );
    kernel.step(targetTick - kernel.clock.tick);
    const checkpoint = checkpointFor(kernel, seed, eventSequenceExclusive);
    checkpoints[String(targetTick)] = checkpoint;
    const lastEvent = checkpoint.events.at(-1);
    if (lastEvent) eventSequenceExclusive = lastEvent.sequence;
  }

  return Object.freeze({
    id: scenario.id,
    saveInputHash: save ? digestCanonical(save) : null,
    checkpoints: Object.freeze(checkpoints),
  });
}

export function runTypeScriptMigrationCorpus(
  manifest: MigrationManifest = loadMigrationManifest(),
): readonly MigrationScenarioResult[] {
  return Object.freeze(
    manifest.scenarios.map((scenario) => runTypeScriptMigrationScenario(scenario)),
  );
}
