import { ARCHETYPES, type Commodity } from '../../data/economy.ts';
import type { Firm } from './FirmSystem.ts';

export type InventoryRecord = Readonly<{ onHand: number; targetStock: number; storageCapacity: number; reservedInbound: number; reservedOutbound: number }>;
export type CargoToken = Readonly<{ shipmentId: string; sourceFirmId?: string; commodity: Commodity; quantity: number }>;
export type InventoryStateSnapshot = Readonly<{
  records: readonly Readonly<{ firmId: string; commodity: Commodity; record: InventoryRecord }>[];
  cargo: readonly Readonly<{ token: CargoToken; status: 'in_transit' }>[];
}>;

type MutableRecord = { onHand: number; targetStock: number; storageCapacity: number; reservedInbound: number; reservedOutbound: number };

const commodities: readonly Commodity[] = ['industrial_inputs', 'manufactured_goods', 'consumer_goods'];
const key = (firmId: string, commodity: Commodity) => `${firmId}|${commodity}`;

export class InventorySystem {
  private readonly records = new Map<string, MutableRecord>();
  private readonly cargo = new Map<string, CargoToken>();

  syncFirm(firm: Firm): void {
    const def = ARCHETYPES[firm.archetype];
    for (const commodity of commodities) {
      const k = key(firm.id, commodity);
      if (this.records.has(k)) continue;
      this.records.set(k, { onHand: 0, targetStock: def.targetStock[commodity] ?? 0, storageCapacity: def.storageCapacity, reservedInbound: 0, reservedOutbound: 0 });
    }
  }

  seed(firmId: string, commodity: Commodity, quantity: number): void {
    const record = this.ensure(firmId, commodity);
    record.onHand = Math.max(0, Number.isFinite(quantity) ? quantity : 0);
  }

  get(firmId: string, commodity: Commodity): InventoryRecord { return { ...this.ensure(firmId, commodity) }; }
  add(firmId: string, commodity: Commodity, quantity: number): number {
    const r = this.ensure(firmId, commodity); const amount = Math.max(0, quantity); const accepted = Math.min(amount, Math.max(0, r.storageCapacity - r.onHand)); r.onHand += accepted; return accepted;
  }
  remove(firmId: string, commodity: Commodity, quantity: number): number { const r = this.ensure(firmId, commodity); const removed = Math.min(r.onHand, Math.max(0, quantity)); r.onHand -= removed; return removed; }

  dispatchCargo(firmId: string, commodity: Commodity, quantity: number, shipmentId: string): CargoToken {
    if (this.cargo.has(shipmentId)) throw new Error('shipment cargo already exists');
    const r = this.ensure(firmId, commodity); const amount = Math.max(0, quantity);
    if (amount <= 0 || r.onHand + 1e-9 < amount) throw new Error('insufficient inventory');
    r.onHand -= amount;
    const token: CargoToken = { shipmentId, sourceFirmId: firmId, commodity, quantity: amount };
    this.cargo.set(shipmentId, token); return { ...token };
  }

  createExternalCargo(commodity: Commodity, quantity: number, shipmentId: string): CargoToken {
    if (this.cargo.has(shipmentId)) throw new Error('shipment cargo already exists');
    const amount = Math.max(0, quantity); if (amount <= 0) throw new Error('invalid cargo quantity');
    const token: CargoToken = { shipmentId, commodity, quantity: amount }; this.cargo.set(shipmentId, token); return { ...token };
  }

  receiveCargo(firmId: string, token: CargoToken): void {
    const live = this.cargo.get(token.shipmentId); if (!live || live.commodity !== token.commodity || Math.abs(live.quantity - token.quantity) > 1e-9) throw new Error('cargo is not in transit');
    this.restoreConservedCargo(firmId, live.commodity, live.quantity); this.cargo.delete(token.shipmentId);
  }
  completeExport(token: CargoToken): void { if (!this.cargo.has(token.shipmentId)) throw new Error('cargo is not in transit'); this.cargo.delete(token.shipmentId); }
  cancelCargo(token: CargoToken): void {
    const live = this.cargo.get(token.shipmentId); if (!live) throw new Error('cargo is not in transit');
    if (live.sourceFirmId) this.restoreConservedCargo(live.sourceFirmId, live.commodity, live.quantity);
    this.cargo.delete(token.shipmentId);
  }
  getCargo(shipmentId: string): CargoToken | undefined { const t = this.cargo.get(shipmentId); return t ? { ...t } : undefined; }
  listForFirm(firmId: string): Readonly<Record<Commodity, InventoryRecord>> { return Object.freeze({ industrial_inputs: this.get(firmId, 'industrial_inputs'), manufactured_goods: this.get(firmId, 'manufactured_goods'), consumer_goods: this.get(firmId, 'consumer_goods') }); }
  shortageRatio(firmId: string): number {
    let target = 0, short = 0; for (const c of commodities) { const r = this.get(firmId, c); target += r.targetStock; short += Math.max(0, r.targetStock - r.onHand); } return target === 0 ? 0 : short / target;
  }
  snapshotState(): InventoryStateSnapshot {
    return { records: [...this.records.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,r]) => { const [firmId, commodity] = k.split('|') as [string, Commodity]; return { firmId, commodity, record: { ...r } }; }), cargo: [...this.cargo.values()].sort((a,b)=>a.shipmentId.localeCompare(b.shipmentId)).map((token)=>({ token:{...token}, status:'in_transit' as const })) };
  }
  restoreState(state: InventoryStateSnapshot): void { this.records.clear(); this.cargo.clear(); for (const item of state.records) this.records.set(key(item.firmId,item.commodity), { ...item.record }); for (const item of state.cargo) this.cargo.set(item.token.shipmentId, { ...item.token }); }
  removeFirm(firmId: string): void { for (const c of commodities) this.records.delete(key(firmId,c)); }
  private restoreConservedCargo(firmId: string, commodity: Commodity, quantity: number): void { const r = this.ensure(firmId, commodity); r.onHand += quantity; }
  private ensure(firmId: string, commodity: Commodity): MutableRecord { const k=key(firmId,commodity); let r=this.records.get(k); if(!r){r={onHand:0,targetStock:0,storageCapacity:100,reservedInbound:0,reservedOutbound:0};this.records.set(k,r);} return r; }
}
