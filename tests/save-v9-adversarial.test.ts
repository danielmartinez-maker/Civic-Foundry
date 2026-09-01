import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { hydrateCoreV9, serializeCoreV9 } from '../src/save/saveV9.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';

function flatTerrain(width = 8, height = 6): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

function saveWithParcel() {
  const core = new SimulationCore({ terrain: flatTerrain(), seed: 109, startingFunds: 500_000 });
  assert.equal(core.buildRoad([{ x: 2, y: 3 }], 'local').ok, true);
  assert.equal(core.paintZone([{ x: 2, y: 2 }], 'residential').painted, 1);
  const parcel = core.cadastre.listParcels()[0];
  assert.ok(parcel);
  return serializeCoreV9(core);
}

test('Save V9 rejects non-finite numeric state before hydration', () => {
  const save = saveWithParcel();
  const malformed = { ...structuredClone(save), seed: Number.NaN };
  assert.throws(() => hydrateCoreV9(malformed), /non-finite number/);
});

test('Save V9 rejects duplicate entity ids', () => {
  const save = saveWithParcel();
  const parcel = save.urbanFabric.parcels[0];
  assert.ok(parcel);
  const malformed = {
    ...structuredClone(save),
    urbanFabric: {
      ...structuredClone(save.urbanFabric),
      parcels: [...structuredClone(save.urbanFabric.parcels), structuredClone(parcel)],
    },
  };
  assert.throws(() => hydrateCoreV9(malformed), /duplicate id/);
});

test('Save V9 rejects dangling canonical zoning, building, and holding parcel references', () => {
  const save = saveWithParcel();
  const danglingZoning = {
    ...structuredClone(save),
    zoningV2: { parcelAssignments: [{ parcelId: 'parcel:missing', districtId: 'R2', overlayIds: [] }] },
  };
  assert.throws(() => hydrateCoreV9(danglingZoning), /zoning assignment references missing parcel/);

  const danglingBuilding = {
    ...structuredClone(save),
    buildingsV2: [{ id: 'building:missing', parcelIds: ['parcel:missing'] }],
  };
  assert.throws(() => hydrateCoreV9(danglingBuilding), /building building:missing references missing parcel/);

  const danglingHolding = {
    ...structuredClone(save),
    propertyMarket: {
      holdings: [{ parcelId: 'parcel:missing', ownerId: 'owner:test', reservationValue: 1 }],
      transactions: [],
      nextTransactionId: 1,
    },
  };
  assert.throws(() => hydrateCoreV9(danglingHolding), /property holding references missing parcel/);
});

test('Save V9 rejects dangling transit queue references', () => {
  const save = saveWithParcel();
  const malformed = {
    ...structuredClone(save),
    transit: {
      ...structuredClone(save.transit),
      mobility: {
        ...structuredClone(save.transit.mobility),
        passengers: {
          ...structuredClone(save.transit.mobility.passengers),
          queues: [{ stopId: 'transit-stop:missing', lineId: 'transit-line:missing', directionKey: 'forward', cohorts: [] }],
        },
      },
    },
  };
  assert.throws(() => hydrateCoreV9(malformed), /invalid transit queue reference/);
});

test('Save V9 rejects dangling economy inventory firm references', () => {
  const save = saveWithParcel();
  const malformed = {
    ...structuredClone(save),
    economyDomain: {
      ...structuredClone(save.economyDomain),
      inventories: {
        ...structuredClone(save.economyDomain.inventories),
        records: [{
          firmId: 'firm:missing',
          commodity: 'consumer_goods' as const,
          record: { onHand: 1, targetStock: 1, storageCapacity: 1, reservedInbound: 0, reservedOutbound: 0 },
        }],
      },
    },
  };
  assert.throws(() => hydrateCoreV9(malformed), /invalid economy inventory firm reference/);
});