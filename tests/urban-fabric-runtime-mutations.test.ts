import test from 'node:test';
import assert from 'node:assert/strict';
import { PropertyMarketSystem } from '../src/simulation/development/PropertyMarketSystem.ts';

test('property history may reference a retired parcel when cadastral lineage recognizes it', () => {
  const market = new PropertyMarketSystem();
  const snapshot = {
    holdings: [
      {
        parcelId: 'parcel:child',
        ownerId: 'owner:b',
        reservationValue: 120_000,
      },
    ],
    transactions: [
      {
        id: 'property:tx:1',
        tick: 3,
        parcelIds: ['parcel:parent'],
        buyerId: 'owner:b',
        sellerId: 'owner:a',
        purpose: 'sale' as const,
        price: 120_000,
        landValue: 80_000,
        improvementValue: 40_000,
      },
    ],
    nextTransactionId: 2,
  } as const;

  assert.throws(() => market.restore(snapshot), /missing holding/);
  market.restore(snapshot, {
    isHistoricalParcelId: (id) => id === 'parcel:parent',
  });
  assert.deepEqual(market.snapshot(), snapshot);
});
