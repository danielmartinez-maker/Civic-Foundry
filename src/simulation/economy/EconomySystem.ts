import type { TreasurySystem } from '../treasury/TreasurySystem.ts';
import type { TaxRevenue } from '../tax/TaxSystem.ts';

export type EconomySnapshot = Readonly<{
  taxRevenue: number;
  facilityOperatingCost: number;
  utilityOperatingCost: number;
  serviceOperatingCost: number;
  paidOperatingCost: number;
  unpaidOperatingCost: number;
  netRecurringBalance: number;
  cashBalance: number;
}>;

export class EconomySystem {
  lastSettlement: EconomySnapshot = { taxRevenue: 0, facilityOperatingCost: 0, utilityOperatingCost: 0, serviceOperatingCost: 0, paidOperatingCost: 0, unpaidOperatingCost: 0, netRecurringBalance: 0, cashBalance: 0 };

  settle(treasury: TreasurySystem, revenue: TaxRevenue, utilityOperatingCost: number, serviceOperatingCost = 0): EconomySnapshot {
    treasury.credit(revenue.total, 'Recurring tax revenue');
    const utilityCost = Math.max(0, Number.isFinite(utilityOperatingCost) ? utilityOperatingCost : 0);
    const serviceCost = Math.max(0, Number.isFinite(serviceOperatingCost) ? serviceOperatingCost : 0);
    const cost = utilityCost + serviceCost;
    const paid = Math.min(cost, treasury.balance);
    if (paid > 0) treasury.tryDebit(paid, 'Utility operating costs');
    const unpaid = cost - paid;
    this.lastSettlement = {
      taxRevenue: revenue.total,
      facilityOperatingCost: cost,
      utilityOperatingCost: utilityCost,
      serviceOperatingCost: serviceCost,
      paidOperatingCost: paid,
      unpaidOperatingCost: unpaid,
      netRecurringBalance: revenue.total - cost,
      cashBalance: treasury.balance,
    };
    return { ...this.lastSettlement };
  }

  restore(snapshot: EconomySnapshot): void {
    this.lastSettlement = { ...snapshot };
  }
}
