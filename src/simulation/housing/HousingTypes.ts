export type HousingProduct = 'rental' | 'for_sale' | 'mixed';
export type HousingProductAllocation = Readonly<{ product: HousingProduct; rentalUnits: number; forSaleUnits: number }>;
export type MigrantArchetype = Readonly<{ householdSize: number; workers: number; vehicleAccess: boolean; tenurePreference: 'renter' | 'owner'; savingsMonths: number }>;

export type MortgageProxy = Readonly<{ originalPrincipal: number; remainingPrincipal: number; annualRate: number; scheduledPayment: number; purchaseTick: number }>;
export type HouseholdPreferenceWeights = Readonly<{ affordability: number; commute: number; services: number; neighborhood: number; space: number; density: number; tenure: number; stability: number }>;
export type HouseholdTenure = 'renter' | 'owner' | 'seeking';
export type HouseholdAffordabilityState = 'comfortable' | 'manageable' | 'stressed' | 'severe';
export type HouseholdDisplacementState = 'none' | 'displaced' | 'unhoused';
export type HouseholdSearchState = 'stable' | 'searching';

export type HouseholdCohort = Readonly<{
  id: string; weight: number; householdSize: number; workers: number; employedWorkers: number;
  employerFirmIds: readonly string[]; grossIncome: number; disposableHousingIncome: number; employmentStability: number;
  tenure: HouseholdTenure; buildingId: string | null; unitRequirement: number; vehicleAccess: boolean;
  liquidSavings: number; mortgage: MortgageProxy | null; housingCost: number; housingCostBurden: number;
  affordabilityState: HouseholdAffordabilityState; preferences: HouseholdPreferenceWeights; moveFriction: number;
  residenceCycles: number; displacementState: HouseholdDisplacementState; searchState: HouseholdSearchState;
  arrearsCycles: number; severeBurdenCycles: number; unhousedCycles: number; lastMoveReason: string | null; createdTick: number;
}>;

export type HouseholdCreateInput = Readonly<{
  weight: number; householdSize: number; workers: number; employedWorkers?: number; employerFirmIds?: readonly string[];
  grossIncome?: number; disposableHousingIncome?: number; employmentStability?: number; tenure: HouseholdTenure; buildingId: string | null;
  unitRequirement: number; vehicleAccess: boolean; liquidSavings: number; mortgage?: MortgageProxy | null; housingCost?: number;
  preferences?: HouseholdPreferenceWeights; moveFriction?: number;
}>;

export type HouseholdStateSnapshot = Readonly<{ households: readonly HouseholdCohort[]; nextId: number }>;

export type HousingBuildingLedger = Readonly<{
  buildingId: string; x: number; y: number; definitionId: string; housingUnits: number; residentCapacity: number; overcrowdingCeiling: number;
  housingProduct: HousingProduct; rentalProductUnits: number; forSaleProductUnits: number; renterOccupiedUnits: number; ownerOccupiedUnits: number;
  vacantRentableUnits: number; vacantForSaleUnits: number; unavailableUnits: number; residentLoad: number;
  askingRent: number; effectiveRent: number; priorRent: number; askingSalePrice: number; estimatedSalePrice: number; vacancyDuration: number;
  qualifiedRentalApplicants: number; qualifiedBuyerPressure: number; turnover: number; averageResidentIncome: number; averageHousingCostBurden: number;
  quality: number; accessibility: number; habitability: number; rentChange: number; priceChange: number;
  existingUseValue: number; redevelopmentPressure: number; displacementRiskHouseholds: number; lastUpdatedTick: number;
}>;
export type HousingSupplyStateSnapshot = Readonly<{ ledgers: readonly HousingBuildingLedger[] }>;

export type HousingCandidate = Readonly<{
  buildingId: string; tenure: 'renter' | 'owner'; housingCost: number; askingPrice: number; availableUnits: number; residentsPerUnit: number;
  accessibility: number; services: number; neighborhood: number; quality: number; density: number; overcrowdingRatio: number; displacementRisk: number;
}>;
export type HousingChoiceContext = Readonly<{ marketInterestRate: number; voluntaryMove: boolean; currentUtility?: number }>;
export type MortgageQuote = Readonly<{
  eligible: boolean; principal: number; scheduledPayment: number; requiredDownPayment: number; transactionReserve: number;
  emergencyReserve: number; maximumAffordablePrice: number; rejectionReasons: readonly string[];
}>;
export type HousingUtilityComponents = Readonly<{
  affordability: number; space: number; commute: number; services: number; neighborhood: number; tenure: number; vehicle: number;
  density: number; stability: number; movingCost: number; overcrowdingPenalty: number; displacementRisk: number;
}>;
export type HousingChoiceResult = Readonly<{
  buildingId: string; tenure: 'renter' | 'owner'; eligible: boolean; totalUtility: number; housingCost: number;
  components: HousingUtilityComponents; rejectionReasons: readonly string[]; mortgage: MortgageQuote | null;
}>;
