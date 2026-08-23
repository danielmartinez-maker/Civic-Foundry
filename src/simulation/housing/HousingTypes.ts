export type HousingProduct = 'rental' | 'for_sale' | 'mixed';

export type HousingProductAllocation = Readonly<{
  product: HousingProduct;
  rentalUnits: number;
  forSaleUnits: number;
}>;

export type MigrantArchetype = Readonly<{
  householdSize: number;
  workers: number;
  vehicleAccess: boolean;
  tenurePreference: 'renter' | 'owner';
  savingsMonths: number;
}>;
