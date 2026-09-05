import test from "node:test";
import assert from "node:assert/strict";

import { NativeEngineBridge } from "../src/native/NativeEngineBridge.ts";
import {
  LegacySocioeconomicAuthorityCutover,
  SOCIOECONOMIC_AUTHORITY_GATES,
  type SocioeconomicAuthorityGate,
} from "../src/native/SocioeconomicAuthorityCutover.ts";
import type {
  NativeEngineAddon,
  NativeEngineHandle,
} from "../src/native/NativeEngineTypes.ts";
import { EconomyScheduler } from "../src/simulation/economy/EconomyScheduler.ts";
import { HousingRelocationSystem } from "../src/simulation/housing/HousingRelocationSystem.ts";
import { PopulationSystem } from "../src/simulation/population/PopulationSystem.ts";

const DOMAIN_BY_GATE: Readonly<Record<SocioeconomicAuthorityGate, string>> =
  Object.freeze({
    inventory_freight: "economy.inventory_freight",
    firms_production: "economy.firms_production",
    labor: "economy.labor",
    households_housing: "population.households_housing",
    personhood_lifecycle: "population.personhood_lifecycle",
  });

function cutoverFixture() {
  const economyDomain = new EconomyScheduler(1);
  const population = new PopulationSystem(10);
  const housingRelocation = new HousingRelocationSystem();
  const cutover = new LegacySocioeconomicAuthorityCutover({
    economyDomain,
    population,
    housingRelocation,
  });
  return { economyDomain, population, housingRelocation, cutover };
}

function authorityAddon(
  options: Readonly<{ failSubmit?: boolean; failStep?: boolean }> = {},
): NativeEngineAddon & { submitted: unknown[][]; stepCalls: number } {
  const handle = {};
  let tick = 0;
  let transferredCount = 0;
  let pending: ReadonlyArray<Readonly<Record<string, unknown>>> = [];
  const owned = new Set<string>();
  const submitted: unknown[][] = [];
  const addon: NativeEngineAddon & {
    submitted: unknown[][];
    stepCalls: number;
  } = {
    submitted,
    stepCalls: 0,
    createEngine: () => handle,
    destroyEngine: () => undefined,
    submitCommands: (_handle, commandsJson) => {
      if (options.failSubmit) throw new Error("submit failed");
      const commands = JSON.parse(commandsJson) as unknown[];
      submitted.push(commands);
      pending = commands as ReadonlyArray<Readonly<Record<string, unknown>>>;
    },
    step: (_handle, ticks) => {
      addon.stepCalls += 1;
      if (options.failStep) throw new Error("step failed");
      assert.equal(ticks, 1);
      for (const command of pending) {
        const type = String(command.type);
        const gate = type.slice(
          "native.socioeconomic.transfer.".length,
        ) as SocioeconomicAuthorityGate;
        assert.equal(gate, SOCIOECONOMIC_AUTHORITY_GATES[transferredCount]);
        owned.add(DOMAIN_BY_GATE[gate]);
        transferredCount += 1;
      }
      pending = [];
      tick += ticks;
    },
    loadV9: () => undefined,
    saveV9: () => '{"saveVersion":9}',
    getSnapshot: () =>
      JSON.stringify({
        hashVersion: 1,
        pendingCommands: [],
        randomStreams: {},
        seed: 1,
        speed: 1,
        tick,
      }),
    getEvents: () => "[]",
    getDomainHash: (_handle: NativeEngineHandle, domain: string) => ({
      ownership: owned.has(domain) ? 1 : 2,
      version: 1,
      value: owned.has(domain) ? 99n : 0n,
    }),
  };
  return addon;
}

test("legacy cutover independently disables migrated socioeconomic writers", () => {
  const { economyDomain, population, housingRelocation, cutover } =
    cutoverFixture();

  cutover.disableTypescriptWrites("inventory_freight");
  assert.deepEqual(economyDomain.getWriteAuthority(), {
    inventoryFreight: false,
    firmsProduction: true,
    labor: true,
  });
  cutover.disableTypescriptWrites("households_housing");
  cutover.disableTypescriptWrites("personhood_lifecycle");
  assert.equal(housingRelocation.typescriptWriteEnabled(), false);
  assert.equal(population.typescriptWriteEnabled(), false);
  assert.deepEqual(cutover.nativeOwnedGates(), [
    "inventory_freight",
    "households_housing",
    "personhood_lifecycle",
  ]);

  cutover.enableTypescriptWrites("households_housing");
  assert.equal(housingRelocation.typescriptWriteEnabled(), true);
  assert.equal(economyDomain.getWriteAuthority().inventoryFreight, false);
});

test("bridge hands economy authority to native in one tick with no dual writers", () => {
  const addon = authorityAddon();
  const bridge = new NativeEngineBridge(addon, { seed: 1 });
  const { economyDomain, cutover } = cutoverFixture();

  bridge.transferSocioeconomicAuthority(
    ["inventory_freight", "firms_production", "labor"],
    1,
    cutover,
  );

  assert.equal(addon.stepCalls, 1);
  assert.deepEqual(economyDomain.getWriteAuthority(), {
    inventoryFreight: false,
    firmsProduction: false,
    labor: false,
  });
  const commands = addon.submitted[0] as Array<Record<string, unknown>>;
  assert.equal(commands.length, 3);
  assert.deepEqual(
    commands.map((command) => [command.sequence, command.tick, command.type]),
    [
      [1, 1, "native.socioeconomic.transfer.inventory_freight"],
      [2, 1, "native.socioeconomic.transfer.firms_production"],
      [3, 1, "native.socioeconomic.transfer.labor"],
    ],
  );
  for (const gate of [
    "inventory_freight",
    "firms_production",
    "labor",
  ] as const) {
    assert.equal(bridge.domainHash(DOMAIN_BY_GATE[gate]).ownership, "owned");
    assert.equal(cutover.typescriptWriteEnabled(gate), false);
  }
});

test("bridge restores TypeScript writers when native submission fails before enqueue", () => {
  const addon = authorityAddon({ failSubmit: true });
  const bridge = new NativeEngineBridge(addon);
  const { economyDomain, cutover } = cutoverFixture();

  assert.throws(
    () =>
      bridge.transferSocioeconomicAuthority(
        ["inventory_freight", "firms_production"],
        1,
        cutover,
      ),
    /submit failed/,
  );
  assert.deepEqual(economyDomain.getWriteAuthority(), {
    inventoryFreight: true,
    firmsProduction: true,
    labor: true,
  });
});

test("bridge fails closed after transfer commands have entered native queue", () => {
  const addon = authorityAddon({ failStep: true });
  const bridge = new NativeEngineBridge(addon);
  const { economyDomain, cutover } = cutoverFixture();

  assert.throws(
    () =>
      bridge.transferSocioeconomicAuthority(
        ["inventory_freight", "firms_production"],
        1,
        cutover,
      ),
    /step failed/,
  );
  assert.deepEqual(economyDomain.getWriteAuthority(), {
    inventoryFreight: false,
    firmsProduction: false,
    labor: true,
  });
});
