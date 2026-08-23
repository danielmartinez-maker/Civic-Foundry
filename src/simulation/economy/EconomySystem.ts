import type { TreasurySystem } from '../treasury/TreasurySystem.ts';
import type { TaxRevenue } from '../tax/TaxSystem.ts';

export type EconomySnapshot = Readonly<{
  taxRevenue: number;
  facilityOperatingCost: number;
  utilityOperatingCost: number;
  serviceOperatingCost: number;
  transitOperatingCost: number;
  transitFareRevenue: number;
  paidOperatingCost: number;
  unpaidOperatingCost: number;
  netRecurringBalance: number;
  cashBalance: number;
}>;

export class EconomySystem {
  lastSettlement: EconomySnapshot = {
    taxRevenue: 0,
    facilityOperatingCost: 0,
    utilityOperatingCost: 0,
    serviceOperatingCost: 0,
    transitOperatingCost: 0,
    transitFareRevenue: 0,
    paidOperatingCost: 0,
    unpaidOperatingCost: 0,
    netRecurringBalance: 0,
    cashBalance: 0,
  };

  settle(treasury: TreasurySystem, revenue: TaxRevenue, utilityOperatingCost: number, serviceOperatingCost = 0, transitOperatingCost = 0, transitFareRevenue = 0): EconomySnapshot {
    treasury.credit(revenue.total, 'Recurring tax revenue');
    const transitFare = Math.max(0, Number.isFinite(transitFareRevenue) ? transitFareRevenue : 0);
    if (transitFare > 0) treasury.credit(transitFare, 'Transit fare revenue');
    const utilityCost = Math.max(0, Number.isFinite(utilityOperatingCost) ? utilityOperatingCost : 0);
    const serviceCost = Math.max(0, Number.isFinite(serviceOperatingCost) ? serviceOperatingCost : 0);
    const transitCost = Math.max(0, Number.isFinite(transitOperatingCost) ? transitOperatingCost : 0);
    const cost = utilityCost + serviceCost + transitCost;
    const paid = Math.min(cost, treasury.balance);
    if (paid > 0) treasury.tryDebit(paid, 'Operating costs');
    const unpaid = cost - paid;
    this.lastSettlement = {
      taxRevenue: revenue.total,
      facilityOperatingCost: cost,
      utilityOperatingCost: utilityCost,
      serviceOperatingCost: serviceCost,
      transitOperatingCost: transitCost,
      transitFareRevenue: transitFare,
      paidOperatingCost: paid,
      unpaidOperatingCost: unpaid,
      netRecurringBalance: revenue.total + transitFare - cost,
      cashBalance: treasury.balance,
    };
    return { ...this.lastSettlement };
  }

  restore(snapshot: EconomySnapshot): void {
    this.lastSettlement = { ...snapshot };
  }
}
