import type { TreasurySystem } from '../treasury/TreasurySystem.ts';
import type { TaxRevenue } from '../tax/TaxSystem.ts';

export type EconomySnapshot = Readonly<{
  taxRevenue: number;
  facilityOperatingCost: number;
  paidOperatingCost: number;
  unpaidOperatingCost: number;
  netRecurringBalance: number;
  cashBalance: number;
}>;

export class EconomySystem {
  lastSettlement: EconomySnapshot = { taxRevenue: 0, facilityOperatingCost: 0, paidOperatingCost: 0, unpaidOperatingCost: 0, netRecurringBalance: 0, cashBalance: 0 };

  settle(treasury: TreasurySystem, revenue: TaxRevenue, operatingCost: number): EconomySnapshot {
    treasury.credit(revenue.total, 'Recurring tax revenue');
    const cost = Math.max(0, Number.isFinite(operatingCost) ? operatingCost : 0);
    const paid = Math.min(cost, treasury.balance);
    if (paid > 0) treasury.tryDebit(paid, 'Utility operating costs');
    const unpaid = cost - paid;
    this.lastSettlement = {
      taxRevenue: revenue.total,
      facilityOperatingCost: cost,
      paidOperatingCost: paid,
      unpaidOperatingCost: unpaid,
      netRecurringBalance: revenue.total - cost,
      cashBalance: treasury.balance,
    };
    return { ...this.lastSettlement };
  }
}
