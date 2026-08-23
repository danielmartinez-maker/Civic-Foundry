export type HousingProduct = 'rental' | 'for_sale' | 'mixed';
export type HousingProductAllocation = Readonly<{ product: HousingProduct; rentalUnits: number; forSaleUnits: number }>;
export type MigrantArchetype = Readonly<{ householdSize: number; workers: number; vehicleAccess: boolean; tenurePreference: 'renter' | 'owner'; savingsMonths: number }>;

export type MortgageProxy = Readonly<{
  originalPrincipal: number;
  remainingPrincipal: number;
  annualRate: number;
  scheduledPayment: number;
  purchaseTick: number;
}>;

export type HouseholdPreferenceWeights = Readonly<{
  affordability: number;
  commute: number;
  services: number;
  neighborhood: number;
  space: number;
  density: number;
  tenure: number;
  stability: number;
}>;

export type HouseholdTenure = 'renter' | 'owner' | 'seeking';
export type HouseholdAffordabilityState = 'comfortable' | 'manageable' | 'stressed' | 'severe';
export type HouseholdDisplacementState = 'none' | 'displaced' | 'unhoused';
export type HouseholdSearchState = 'stable' | 'searching';

export type HouseholdCohort = Readonly<{
  id: string;
  weight: number;
  householdSize: number;
  workers: number;
  employedWorkers: number;
  employerFirmIds: readonly string[];
  grossIncome: number;
  disposableHousingIncome: number;
  employmentStability: number;
  tenure: HouseholdTenure;
  buildingId: string | null;
  unitRequirement: number;
  vehicleAccess: boolean;
  liquidSavings: number;
  mortgage: MortgageProxy | null;
  housingCost: number;
  housingCostBurden: number;
  affordabilityState: HouseholdAffordabilityState;
  preferences: HouseholdPreferenceWeights;
  moveFriction: number;
  residenceCycles: number;
  displacementState: HouseholdDisplacementState;
  searchState: HouseholdSearchState;
  arrearsCycles: number;
  severeBurdenCycles: number;
  unhousedCycles: number;
  lastMoveReason: string | null;
  createdTick: number;
}>;

export type HouseholdCreateInput = Readonly<{
  weight: number;
  householdSize: number;
  workers: number;
  employedWorkers?: number;
  employerFirmIds?: readonly string[];
  grossIncome?: number;
  disposableHousingIncome?: number;
  employmentStability?: number;
  tenure: HouseholdTenure;
  buildingId: string | null;
  unitRequirement: number;
  vehicleAccess: boolean;
  liquidSavings: number;
  mortgage?: MortgageProxy | null;
  housingCost?: number;
  preferences?: HouseholdPreferenceWeights;
  moveFriction?: number;
}>;

export type HouseholdStateSnapshot = Readonly<{
  households: readonly HouseholdCohort[];
  nextId: number;
}>;
