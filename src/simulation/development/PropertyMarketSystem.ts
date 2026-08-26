export type PropertyTransactionPurpose = 'sale' | 'redevelopment' | 'assembly' | 'renovation';

export type PropertyHoldingSeed = Readonly<{
  parcelId: string;
  ownerId: string;
  reservationValue: number;
}>;

export type PropertyTransactionInput = Readonly<{
  tick: number;
  parcelIds: readonly string[];
  buyerId: string;
  sellerId: string;
  purpose: PropertyTransactionPurpose;
  price: number;
  landValue: number;
  improvementValue: number;
}>;

export type PropertyTransaction = Readonly<{
  id: string;
  tick: number;
  parcelIds: readonly string[];
  buyerId: string;
  sellerId: string;
  purpose: PropertyTransactionPurpose;
  price: number;
  landValue: number;
  improvementValue: number;
}>;

export type PropertyMarketSnapshot = Readonly<{
  holdings: readonly PropertyHoldingSeed[];
  transactions: readonly PropertyTransaction[];
  nextTransactionId: number;
}>;

type PropertyHolding = {
  parcelId: string;
  ownerId: string;
  reservationValue: number;
};

const TRANSACTION_PURPOSES: readonly PropertyTransactionPurpose[] = Object.freeze([
  'sale',
  'redevelopment',
  'assembly',
  'renovation',
]);

export class PropertyMarketSystem {
  private readonly holdings = new Map<string, PropertyHolding>();
  private readonly transactions: PropertyTransaction[] = [];
  private nextTransactionId = 1;

  constructor(seeds: readonly PropertyHoldingSeed[] = []) {
    const normalized = validateHoldings(seeds);
    for (const seed of normalized) this.holdings.set(seed.parcelId, { ...seed });
  }

  ownerOf(parcelId: string): string | undefined {
    validateEntityId('parcelId', parcelId);
    return this.holdings.get(parcelId)?.ownerId;
  }

  reservationValue(parcelId: string): number | undefined {
    validateEntityId('parcelId', parcelId);
    return this.holdings.get(parcelId)?.reservationValue;
  }

  transact(input: PropertyTransactionInput): PropertyTransaction {
    const parcelIds = validateTransaction(input, this.holdings);
    const transaction: PropertyTransaction = Object.freeze({
      id: `property:tx:${this.nextTransactionId}`,
      tick: input.tick,
      parcelIds: Object.freeze(parcelIds),
      buyerId: input.buyerId,
      sellerId: input.sellerId,
      purpose: input.purpose,
      price: input.price,
      landValue: input.landValue,
      improvementValue: input.improvementValue,
    });

    for (const parcelId of parcelIds) {
      const holding = this.holdings.get(parcelId)!;
      holding.ownerId = input.buyerId;
    }
    this.nextTransactionId += 1;
    this.transactions.push(transaction);
    return transaction;
  }

  listTransactions(): readonly PropertyTransaction[] {
    return Object.freeze(this.transactions.map(cloneTransaction));
  }

  snapshot(): PropertyMarketSnapshot {
    const holdings = [...this.holdings.values()]
      .sort((left, right) => left.parcelId.localeCompare(right.parcelId))
      .map((holding) => Object.freeze({ ...holding }));
    return Object.freeze({
      holdings: Object.freeze(holdings),
      transactions: Object.freeze(this.transactions.map(cloneTransaction)),
      nextTransactionId: this.nextTransactionId,
    });
  }

  restore(snapshot: PropertyMarketSnapshot): void {
    if (!snapshot || typeof snapshot !== 'object') throw new Error('property market snapshot must be an object');
    const holdings = validateHoldings(snapshot.holdings);
    const transactions = validateTransactionHistory(snapshot.transactions, holdings);
    if (!Number.isInteger(snapshot.nextTransactionId) || snapshot.nextTransactionId !== transactions.length + 1) {
      throw new Error('property market next transaction id must follow transaction history');
    }

    this.holdings.clear();
    for (const holding of holdings) this.holdings.set(holding.parcelId, { ...holding });
    this.transactions.splice(0, this.transactions.length, ...transactions);
    this.nextTransactionId = snapshot.nextTransactionId;
  }
}

function validateHoldings(input: readonly PropertyHoldingSeed[]): PropertyHoldingSeed[] {
  if (!Array.isArray(input)) throw new Error('property holdings must be an array');
  const seen = new Set<string>();
  const holdings = input.map((seed) => {
    if (!seed || typeof seed !== 'object') throw new Error('property holding must be an object');
    validateEntityId('parcelId', seed.parcelId);
    validateEntityId('ownerId', seed.ownerId);
    validateNonNegative('reservationValue', seed.reservationValue);
    if (seen.has(seed.parcelId)) throw new Error(`duplicate property holding: ${seed.parcelId}`);
    seen.add(seed.parcelId);
    return Object.freeze({ ...seed });
  });
  holdings.sort((left, right) => left.parcelId.localeCompare(right.parcelId));
  return holdings;
}

function validateTransactionHistory(
  input: readonly PropertyTransaction[],
  holdings: readonly PropertyHoldingSeed[],
): PropertyTransaction[] {
  if (!Array.isArray(input)) throw new Error('property transactions must be an array');
  const liveParcelIds = new Set(holdings.map((holding) => holding.parcelId));
  return input.map((transaction, index) => {
    if (!transaction || typeof transaction !== 'object') throw new Error('property transaction must be an object');
    const expectedId = `property:tx:${index + 1}`;
    if (transaction.id !== expectedId) throw new Error(`invalid property transaction id: ${transaction.id}`);
    if (!Number.isInteger(transaction.tick) || transaction.tick < 0) throw new Error('transaction tick must be a non-negative integer');
    validateEntityId('buyerId', transaction.buyerId);
    validateEntityId('sellerId', transaction.sellerId);
    if (transaction.buyerId === transaction.sellerId) throw new Error('buyer and seller must be different');
    if (!TRANSACTION_PURPOSES.includes(transaction.purpose)) throw new Error(`invalid property transaction purpose: ${transaction.purpose}`);
    validateNonNegative('price', transaction.price);
    validateNonNegative('landValue', transaction.landValue);
    validateNonNegative('improvementValue', transaction.improvementValue);
    if (Math.abs(transaction.price - (transaction.landValue + transaction.improvementValue)) > 0.01) {
      throw new Error('transaction price must equal land value plus improvement value');
    }
    if (!Array.isArray(transaction.parcelIds) || transaction.parcelIds.length === 0) {
      throw new Error('property transaction requires at least one parcel');
    }
    const seen = new Set<string>();
    const parcelIds = [...transaction.parcelIds];
    for (const parcelId of parcelIds) {
      validateEntityId('parcelId', parcelId);
      if (seen.has(parcelId)) throw new Error(`duplicate parcel in property transaction: ${parcelId}`);
      seen.add(parcelId);
      if (!liveParcelIds.has(parcelId)) throw new Error(`property transaction references missing holding: ${parcelId}`);
    }
    parcelIds.sort((left, right) => left.localeCompare(right));
    return Object.freeze({ ...transaction, parcelIds: Object.freeze(parcelIds) });
  });
}

function validateTransaction(
  input: PropertyTransactionInput,
  holdings: ReadonlyMap<string, PropertyHolding>,
): string[] {
  if (!Number.isInteger(input.tick) || input.tick < 0) throw new Error('transaction tick must be a non-negative integer');
  validateEntityId('buyerId', input.buyerId);
  validateEntityId('sellerId', input.sellerId);
  if (input.buyerId === input.sellerId) throw new Error('buyer and seller must be different');
  if (!TRANSACTION_PURPOSES.includes(input.purpose)) throw new Error(`invalid property transaction purpose: ${input.purpose}`);
  validateNonNegative('price', input.price);
  validateNonNegative('landValue', input.landValue);
  validateNonNegative('improvementValue', input.improvementValue);
  if (Math.abs(input.price - (input.landValue + input.improvementValue)) > 0.01) {
    throw new Error('transaction price must equal land value plus improvement value');
  }
  if (!Array.isArray(input.parcelIds) || input.parcelIds.length === 0) {
    throw new Error('property transaction requires at least one parcel');
  }

  const seen = new Set<string>();
  const parcelIds = [...input.parcelIds];
  for (const parcelId of parcelIds) {
    validateEntityId('parcelId', parcelId);
    if (seen.has(parcelId)) throw new Error(`duplicate parcel in property transaction: ${parcelId}`);
    seen.add(parcelId);
    const holding = holdings.get(parcelId);
    if (!holding) throw new Error(`property parcel has no owner record: ${parcelId}`);
    if (holding.ownerId !== input.sellerId) {
      throw new Error(`property seller does not own parcel ${parcelId}: ${holding.ownerId}`);
    }
  }

  parcelIds.sort((a, b) => a.localeCompare(b));
  return parcelIds;
}

function cloneTransaction(transaction: PropertyTransaction): PropertyTransaction {
  return Object.freeze({ ...transaction, parcelIds: Object.freeze([...transaction.parcelIds]) });
}

function validateEntityId(name: string, value: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be non-empty`);
}

function validateNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite and non-negative`);
}
