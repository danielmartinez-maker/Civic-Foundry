import test from 'node:test';
import assert from 'node:assert/strict';
import { HousingSupplySystem } from '../src/simulation/housing/HousingSupplySystem.ts';
import { BuildingSystem, type Building } from '../src/simulation/buildings/BuildingSystem.ts';

function residentialRowhouse(status: Building['status'] = 'occupied'): Building {
  return {
    id: 'building:lot:4,4',
    lotId: 'lot:4,4',
    x: 4,
    y: 4,
    zone: 'residential',
    definitionId: 'residential_rowhouse',
    status,
    constructionStartedTick: 0,
    completionTick: 70,
    housingProduct: 'mixed',
    rentalProductUnits: 6,
    forSaleProductUnits: 6,
  };
}

test('every housing occupancy mutation preserves exclusive unit conservation', () => {
  const supply = new HousingSupplySystem();
  supply.syncBuildings([residentialRowhouse()], 100);
  const id = supply.list()[0]!.buildingId;
  supply.occupy(id, 'renter', 3, 7);
  supply.occupy(id, 'owner', 2, 5);
  const ledger = supply.get(id)!;
  assert.equal(ledger.rentalProductUnits, ledger.renterOccupiedUnits + ledger.vacantRentableUnits);
  assert.equal(ledger.forSaleProductUnits, ledger.ownerOccupiedUnits + ledger.vacantForSaleUnits);
  assert.equal(ledger.rentalProductUnits + ledger.forSaleProductUnits + ledger.unavailableUnits, ledger.housingUnits);
  assert.equal(ledger.residentLoad, 12);

  supply.vacate(id, 'renter', 1, 2);
  const afterVacate = supply.get(id)!;
  assert.equal(afterVacate.renterOccupiedUnits, 2);
  assert.equal(afterVacate.vacantRentableUnits, 4);
  assert.equal(afterVacate.residentLoad, 10);
});

test('construction buildings expose no housing inventory and occupied legacy buildings initialize deterministically', () => {
  const supply = new HousingSupplySystem();
  supply.syncBuildings([residentialRowhouse('construction')], 10);
  assert.equal(supply.list().length, 0);

  const legacy = residentialRowhouse();
  delete legacy.housingProduct;
  delete legacy.rentalProductUnits;
  delete legacy.forSaleProductUnits;
  supply.syncBuildings([legacy], 100);
  const ledger = supply.get(legacy.id)!;
  assert.equal(ledger.housingProduct, 'mixed');
  assert.equal(ledger.rentalProductUnits, 6);
  assert.equal(ledger.forSaleProductUnits, 6);
  assert.equal(ledger.askingRent, 480);
  assert.equal(ledger.estimatedSalePrice, 28_800);
});

test('restore rejects broken unit conservation before mutating current supply', () => {
  const supply = new HousingSupplySystem();
  supply.syncBuildings([residentialRowhouse()], 100);
  const snapshot = supply.snapshotState();
  const corrupt = structuredClone(snapshot) as { ledgers: Array<{ rentalProductUnits: number }> };
  corrupt.ledgers[0]!.rentalProductUnits += 1;
  assert.throws(() => supply.restoreState(corrupt as never), /unit conservation|housing units/i);
  assert.equal(supply.list().length, 1);
});

test('BuildingSystem can remove a building by stable building id', () => {
  const buildings = new BuildingSystem();
  const building = residentialRowhouse();
  buildings.restore([building]);
  assert.equal(buildings.removeById(building.id)?.id, building.id);
  assert.equal(buildings.list().length, 0);
});
