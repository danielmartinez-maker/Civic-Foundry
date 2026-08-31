import test from 'node:test';
import assert from 'node:assert/strict';
import { InventorySystem } from '../src/simulation/economy/InventorySystem.ts';

test('receiving freight preserves the full cargo quantity when destination storage filled in transit', () => {
  const inventories = new InventorySystem();
  inventories.seed('firm:destination', 'manufactured_goods', 95);
  const cargo = inventories.createExternalCargo('manufactured_goods', 10, 'shipment:receive-overflow');

  inventories.receiveCargo('firm:destination', cargo);

  assert.equal(inventories.get('firm:destination', 'manufactured_goods').onHand, 105);
  assert.equal(inventories.getCargo(cargo.shipmentId), undefined);
});

test('cancelling freight preserves the full cargo quantity when source storage refilled in transit', () => {
  const inventories = new InventorySystem();
  inventories.seed('firm:source', 'manufactured_goods', 100);
  const cargo = inventories.dispatchCargo('firm:source', 'manufactured_goods', 10, 'shipment:cancel-overflow');
  assert.equal(inventories.add('firm:source', 'manufactured_goods', 10), 10);

  inventories.cancelCargo(cargo);

  assert.equal(inventories.get('firm:source', 'manufactured_goods').onHand, 110);
  assert.equal(inventories.getCargo(cargo.shipmentId), undefined);
});
