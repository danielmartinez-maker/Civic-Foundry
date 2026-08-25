import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HighestBestUseSystem,
  type HighestBestUseInput,
} from '../src/simulation/development/HighestBestUseSystem.ts';
import {
  PropertyMarketSystem,
  type PropertyTransactionInput,
} from '../src/simulation/development/PropertyMarketSystem.ts';

const hbu = new HighestBestUseSystem();

test('profitable existing NOI can make hold the highest-and-best-use', () => {
  const result = hbu.evaluate(hbuInput({
    holdValue: 5_000_000,
    redevelopmentNetValue: 4_700_000,
  }));

  assert.equal(result.bestStrategy, 'hold');
  assert.ok(result.redevelopmentPremium < 0);
  assert.equal(result.bestValue, 5_000_000);
});

test('upzoning and deterioration can make redevelopment win', () => {
  const result = hbu.evaluate(hbuInput({
    holdValue: 2_000_000,
    redevelopmentNetValue: 5_500_000,
    redevelopmentExpectedReturn: 0.24,
    buildingCondition: 35,
  }));

  assert.equal(result.bestStrategy, 'redevelop');
  assert.ok(result.redevelopmentPremium > 0);
  assert.equal(result.bestValue, 5_500_000);
});

test('higher-value strategy stays blocked when risk-adjusted return misses developer hurdle', () => {
  const result = hbu.evaluate(hbuInput({
    holdValue: 2_500_000,
    redevelopmentNetValue: 6_000_000,
    redevelopmentExpectedReturn: 0.13,
    redevelopmentRiskScore: 0.45,
    developerHurdleRate: 0.12,
  }));

  assert.equal(result.bestStrategy, 'hold');
  assert.ok(result.alternatives.some((alternative) => alternative.strategy === 'redevelop'
    && alternative.eligible === false));
});

test('renovation and adaptive conversion compete with hold and redevelopment on net value', () => {
  const result = hbu.evaluate(hbuInput({
    holdValue: 2_000_000,
    renovationNetValue: 3_400_000,
    renovationExpectedReturn: 0.18,
    conversionNetValue: 4_100_000,
    conversionExpectedReturn: 0.20,
    redevelopmentNetValue: 3_900_000,
    redevelopmentExpectedReturn: 0.19,
  }));

  assert.equal(result.bestStrategy, 'convert');
  assert.equal(result.bestValue, 4_100_000);
});

test('property transaction changes owner and records land and improvement value', () => {
  const market = new PropertyMarketSystem([
    { parcelId: 'p1', ownerId: 'owner:a', reservationValue: 1_400_000 },
  ]);
  const tx = market.transact(transactionInput({
    parcelIds: ['p1'],
    buyerId: 'developer:b',
    sellerId: 'owner:a',
    price: 1_600_000,
    landValue: 900_000,
    improvementValue: 700_000,
  }));

  assert.equal(market.ownerOf('p1'), 'developer:b');
  assert.equal(tx.purpose, 'redevelopment');
  assert.equal(tx.landValue, 900_000);
  assert.equal(tx.improvementValue, 700_000);
  assert.equal(tx.price, 1_600_000);
});

test('multi-parcel property transfer is atomic when seller ownership is inconsistent', () => {
  const market = new PropertyMarketSystem([
    { parcelId: 'p1', ownerId: 'owner:a', reservationValue: 1_000_000 },
    { parcelId: 'p2', ownerId: 'owner:c', reservationValue: 800_000 },
  ]);

  assert.throws(() => market.transact(transactionInput({
    parcelIds: ['p1', 'p2'],
    buyerId: 'developer:b',
    sellerId: 'owner:a',
    price: 2_000_000,
    landValue: 1_500_000,
    improvementValue: 500_000,
  })), /owner|seller/i);
  assert.equal(market.ownerOf('p1'), 'owner:a');
  assert.equal(market.ownerOf('p2'), 'owner:c');
});

function hbuInput(overrides: Partial<HighestBestUseInput> = {}): HighestBestUseInput {
  return {
    parcelIds: ['p1'],
    holdValue: 3_000_000,
    buildingCondition: 70,
    developerHurdleRate: 0.12,
    renovationNetValue: 0,
    renovationExpectedReturn: 0,
    renovationRiskScore: 0.10,
    conversionNetValue: 0,
    conversionExpectedReturn: 0,
    conversionRiskScore: 0.15,
    redevelopmentNetValue: 4_000_000,
    redevelopmentExpectedReturn: 0.18,
    redevelopmentRiskScore: 0.20,
    ...overrides,
  };
}

function transactionInput(overrides: Partial<PropertyTransactionInput> = {}): PropertyTransactionInput {
  return {
    tick: 100,
    parcelIds: ['p1'],
    buyerId: 'developer:b',
    sellerId: 'owner:a',
    purpose: 'redevelopment',
    price: 1_600_000,
    landValue: 900_000,
    improvementValue: 700_000,
    ...overrides,
  };
}
