import { getBuildingDefinition } from '../../data/buildings.ts';
import { defaultLegacyProductAllocation, HOUSING_CONFIG } from '../../data/housing.ts';
import type { Building } from '../buildings/BuildingSystem.ts';
import type { HousingBuildingLedger, HousingProductAllocation, HousingSupplyStateSnapshot } from './HousingTypes.ts';

type MutableLedger = { -readonly [K in keyof HousingBuildingLedger]: HousingBuildingLedger[K] };

function cloneLedger(value: HousingBuildingLedger): HousingBuildingLedger {
  return { ...value };
}

function finite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function validateLedger(ledger: HousingBuildingLedger): void {
  if (!ledger.buildingId) throw new Error('housing ledger building id is required');
  for (const key of [
    'housingUnits', 'rentalProductUnits', 'forSaleProductUnits', 'renterOccupiedUnits', 'ownerOccupiedUnits',
    'vacantRentableUnits', 'vacantForSaleUnits', 'unavailableUnits', 'residentLoad', 'overcrowdingCeiling',
  ] as const) {
    const value = ledger[key];
    if (!Number.isInteger(value) || value < 0) throw new Error(`${ledger.buildingId}.${key} must be a non-negative integer`);
  }
  if (ledger.rentalProductUnits !== ledger.renterOccupiedUnits + ledger.vacantRentableUnits) {
    throw new Error('housing unit conservation failed for rental inventory');
  }
  if (ledger.forSaleProductUnits !== ledger.ownerOccupiedUnits + ledger.vacantForSaleUnits) {
    throw new Error('housing unit conservation failed for sale inventory');
  }
  if (ledger.rentalProductUnits + ledger.forSaleProductUnits + ledger.unavailableUnits !== ledger.housingUnits) {
    throw new Error('housing units do not conserve physical inventory');
  }
  if (ledger.residentLoad > ledger.overcrowdingCeiling) throw new Error('resident load exceeds overcrowding ceiling');
  for (const key of [
    'askingRent', 'effectiveRent', 'priorRent', 'askingSalePrice', 'estimatedSalePrice', 'vacancyDuration',
    'qualifiedRentalApplicants', 'qualifiedBuyerPressure', 'turnover', 'averageResidentIncome', 'averageHousingCostBurden',
    'quality', 'accessibility', 'habitability', 'rentChange', 'priceChange', 'existingUseValue', 'redevelopmentPressure',
    'displacementRiskHouseholds', 'lastUpdatedTick',
  ] as const) finite(`${ledger.buildingId}.${key}`, ledger[key]);
}

function allocationFor(building: Building): HousingProductAllocation {
  const definition = getBuildingDefinition(building.definitionId);
  if (building.housingProduct !== undefined || building.rentalProductUnits !== undefined || building.forSaleProductUnits !== undefined) {
    if (!building.housingProduct || building.rentalProductUnits === undefined || building.forSaleProductUnits === undefined) {
      throw new Error(`incomplete housing product metadata: ${building.id}`);
    }
    if (!Number.isInteger(building.rentalProductUnits) || !Number.isInteger(building.forSaleProductUnits)
      || building.rentalProductUnits < 0 || building.forSaleProductUnits < 0
      || building.rentalProductUnits + building.forSaleProductUnits !== definition.housingUnits) {
      throw new Error(`invalid housing product allocation: ${building.id}`);
    }
    if (building.housingProduct === 'rental' && building.forSaleProductUnits !== 0) throw new Error(`rental housing cannot include for-sale units: ${building.id}`);
    if (building.housingProduct === 'for_sale' && building.rentalProductUnits !== 0) throw new Error(`for-sale housing cannot include rental units: ${building.id}`);
    return { product: building.housingProduct, rentalUnits: building.rentalProductUnits, forSaleUnits: building.forSaleProductUnits };
  }
  return defaultLegacyProductAllocation(building.definitionId, definition.housingUnits);
}

export class HousingSupplySystem {
  private readonly ledgers = new Map<string, MutableLedger>();

  syncBuildings(buildings: readonly Building[], tick: number): void {
    if (!Number.isInteger(tick) || tick < 0) throw new Error('tick must be a non-negative integer');
    const eligible = buildings
      .filter((building) => building.status === 'occupied' && building.zone === 'residential')
      .slice().sort((a, b) => a.id.localeCompare(b.id));
    const ids = new Set(eligible.map((building) => building.id));
    for (const id of [...this.ledgers.keys()]) if (!ids.has(id)) this.ledgers.delete(id);

    for (const building of eligible) {
      const definition = getBuildingDefinition(building.definitionId);
      if (definition.zone !== 'residential' || definition.housingUnits <= 0) continue;
      const existing = this.ledgers.get(building.id);
      if (existing) {
        existing.x = building.x;
        existing.y = building.y;
        existing.lastUpdatedTick = tick;
        continue;
      }
      const allocation = allocationFor(building);
      const salePrice = definition.baseRent * HOUSING_CONFIG.salePriceToEffectiveRent;
      const ledger: MutableLedger = {
        buildingId: building.id,
        x: building.x,
        y: building.y,
        definitionId: building.definitionId,
        housingUnits: definition.housingUnits,
        residentCapacity: definition.residentCapacity,
        overcrowdingCeiling: Math.floor(definition.residentCapacity * definition.overcrowdingMultiplier),
        housingProduct: allocation.product,
        rentalProductUnits: allocation.rentalUnits,
        forSaleProductUnits: allocation.forSaleUnits,
        renterOccupiedUnits: 0,
        ownerOccupiedUnits: 0,
        vacantRentableUnits: allocation.rentalUnits,
        vacantForSaleUnits: allocation.forSaleUnits,
        unavailableUnits: 0,
        residentLoad: 0,
        askingRent: definition.baseRent,
        effectiveRent: definition.baseRent,
        priorRent: definition.baseRent,
        askingSalePrice: salePrice,
        estimatedSalePrice: salePrice,
        vacancyDuration: 0,
        qualifiedRentalApplicants: 0,
        qualifiedBuyerPressure: 0,
        turnover: 0,
        averageResidentIncome: 0,
        averageHousingCostBurden: 0,
        quality: 0.70,
        accessibility: 0.70,
        habitability: 1,
        rentChange: 0,
        priceChange: 0,
        existingUseValue: 0,
        redevelopmentPressure: 0,
        displacementRiskHouseholds: 0,
        lastUpdatedTick: tick,
      };
      validateLedger(ledger);
      this.ledgers.set(building.id, ledger);
    }
  }

  list(): HousingBuildingLedger[] {
    return [...this.ledgers.values()].sort((a, b) => a.buildingId.localeCompare(b.buildingId)).map(cloneLedger);
  }

  get(buildingId: string): HousingBuildingLedger | undefined {
    const ledger = this.ledgers.get(buildingId);
    return ledger ? cloneLedger(ledger) : undefined;
  }

  occupy(buildingId: string, tenure: 'renter' | 'owner', units: number, residents = units): HousingBuildingLedger {
    const ledger = this.require(buildingId);
    this.validateDelta(units, residents);
    if (ledger.residentLoad + residents > ledger.overcrowdingCeiling) throw new Error('occupancy exceeds overcrowding ceiling');
    if (tenure === 'renter') {
      if (units > ledger.vacantRentableUnits) throw new Error('insufficient vacant rental units');
      ledger.vacantRentableUnits -= units;
      ledger.renterOccupiedUnits += units;
    } else {
      if (units > ledger.vacantForSaleUnits) throw new Error('insufficient vacant for-sale units');
      ledger.vacantForSaleUnits -= units;
      ledger.ownerOccupiedUnits += units;
    }
    ledger.residentLoad += residents;
    validateLedger(ledger);
    return cloneLedger(ledger);
  }

  vacate(buildingId: string, tenure: 'renter' | 'owner', units: number, residents = units): HousingBuildingLedger {
    const ledger = this.require(buildingId);
    this.validateDelta(units, residents);
    if (residents > ledger.residentLoad) throw new Error('cannot vacate more residents than present');
    if (tenure === 'renter') {
      if (units > ledger.renterOccupiedUnits) throw new Error('cannot vacate more renter units than occupied');
      ledger.renterOccupiedUnits -= units;
      ledger.vacantRentableUnits += units;
    } else {
      if (units > ledger.ownerOccupiedUnits) throw new Error('cannot vacate more owner units than occupied');
      ledger.ownerOccupiedUnits -= units;
      ledger.vacantForSaleUnits += units;
    }
    ledger.residentLoad -= residents;
    ledger.turnover += units;
    validateLedger(ledger);
    return cloneLedger(ledger);
  }

  removeBuilding(buildingId: string): HousingBuildingLedger | undefined {
    const ledger = this.ledgers.get(buildingId);
    if (!ledger) return undefined;
    this.ledgers.delete(buildingId);
    return cloneLedger(ledger);
  }

  snapshotState(): HousingSupplyStateSnapshot {
    return { ledgers: this.list() };
  }

  restoreState(state: HousingSupplyStateSnapshot): void {
    if (!state || typeof state !== 'object' || !Array.isArray(state.ledgers)) throw new Error('housing supply state must contain ledgers');
    const next = new Map<string, MutableLedger>();
    for (const raw of state.ledgers) {
      validateLedger(raw);
      if (next.has(raw.buildingId)) throw new Error(`duplicate housing ledger: ${raw.buildingId}`);
      next.set(raw.buildingId, { ...raw });
    }
    this.ledgers.clear();
    for (const [id, ledger] of next) this.ledgers.set(id, ledger);
  }

  private require(buildingId: string): MutableLedger {
    const ledger = this.ledgers.get(buildingId);
    if (!ledger) throw new Error(`unknown housing building: ${buildingId}`);
    return ledger;
  }

  private validateDelta(units: number, residents: number): void {
    if (!Number.isInteger(units) || units <= 0) throw new Error('units must be a positive integer');
    if (!Number.isInteger(residents) || residents < 0) throw new Error('residents must be a non-negative integer');
  }
}
