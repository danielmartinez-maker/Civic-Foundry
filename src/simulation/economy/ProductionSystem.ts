import { ARCHETYPES, type Commodity } from '../../data/economy.ts';
import type { Firm } from './FirmSystem.ts';
import type { InventorySystem } from './InventorySystem.ts';

export type FirmProductionResult = Readonly<{
  consumed: Partial<Record<Commodity, number>>;
  produced: Partial<Record<Commodity, number>>;
  soldConsumerGoods: number;
  lostOutputFromInputShortage: number;
  throughput: number;
}>;

export class ProductionSystem {
  runFirmCycle(firm: Firm, inventories: InventorySystem, inputs: { utilityRatio: number; serviceRatio: number; localDemand: number }): FirmProductionResult {
    inventories.syncFirm(firm);
    const def = ARCHETYPES[firm.archetype];
    const laborRatio = firm.jobCapacity <= 0 ? 0 : Math.max(0, Math.min(1, firm.filledJobs / firm.jobCapacity));
    const viability = Math.min(laborRatio, Math.max(0, Math.min(1, inputs.utilityRatio)), Math.max(0, Math.min(1, inputs.serviceRatio)));
    const consumed: Partial<Record<Commodity, number>> = {}; const produced: Partial<Record<Commodity, number>> = {};
    if (firm.archetype === 'retail_local') {
      const desired = def.consumes!.units * firm.productivity * viability * Math.max(0, inputs.localDemand);
      const sold = inventories.remove(firm.id, 'consumer_goods', desired); consumed.consumer_goods = sold;
      return { consumed, produced, soldConsumerGoods: sold, lostOutputFromInputShortage: Math.max(0, desired - sold), throughput: sold };
    }
    const consume = def.consumes; const produce = def.produces;
    if (!consume || !produce || viability <= 0) return { consumed, produced, soldConsumerGoods: 0, lostOutputFromInputShortage: 0, throughput: 0 };
    const desiredCycles = firm.productivity * viability;
    const inputAvailable = inventories.get(firm.id, consume.commodity).onHand;
    const output = inventories.get(firm.id, produce.commodity);
    const cycles = Math.max(0, Math.min(desiredCycles, inputAvailable / consume.units, Math.max(0, output.storageCapacity - output.onHand) / produce.units));
    const consumedUnits = inventories.remove(firm.id, consume.commodity, cycles * consume.units);
    const producedUnits = inventories.add(firm.id, produce.commodity, cycles * produce.units);
    consumed[consume.commodity] = consumedUnits; produced[produce.commodity] = producedUnits;
    const lost = Math.max(0, desiredCycles - cycles) * produce.units;
    return { consumed, produced, soldConsumerGoods: 0, lostOutputFromInputShortage: lost, throughput: producedUnits };
  }
}
