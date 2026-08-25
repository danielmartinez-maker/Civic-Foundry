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
    for (const seed of seeds) {
      validateEntityId('parcelId', seed.parcelId);
      validateEntityId('ownerId', seed.ownerId);
      validateNonNegative('reservationValue', seed.reservationValue);
      if (this.holdings.has(seed.parcelId)) throw new Error(`duplicate property holding: ${seed.parcelId}`);
      this.holdings.set(seed.parcelId, {
        parcelId: seed.parcelId,
        ownerId: seed.ownerId,
        reservationValue: seed.reservationValue,
      });
    }
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
    return Object.freeze([...this.transactions]);
  }
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

function validateEntityId(name: string, value: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be non-empty`);
}

function validateNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite and non-negative`);
}
