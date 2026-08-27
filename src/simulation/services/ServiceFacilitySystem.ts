import type { TerrainGrid } from '../../world/terrain/TerrainGrid.ts';
import type { RoadSystem } from '../../world/roads/RoadSystem.ts';
import type { TreasurySystem } from '../treasury/TreasurySystem.ts';
import {
  SERVICE_DEFINITIONS,
  type ServiceDepartment,
  type ServiceFacilityType,
} from '../../data/services.ts';

export type ServiceFacility = Readonly<{
  id: string;
  type: ServiceFacilityType;
  department: ServiceDepartment;
  x: number;
  y: number;
}>;

export type DepartmentFunding = Record<ServiceDepartment, number>;
export type DepartmentCosts = Record<ServiceDepartment, number>;

const DEPARTMENTS: readonly ServiceDepartment[] = ['fire', 'police', 'healthcare', 'education', 'garbage'];
const CARDINAL = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;

export class ServiceFacilitySystem {
  private readonly terrain: TerrainGrid;
  private readonly roads: RoadSystem;
  private readonly externallyOccupied: (x: number, y: number) => boolean;
  private readonly facilities: ServiceFacility[] = [];
  private readonly funding: DepartmentFunding = { fire: 100, police: 100, healthcare: 100, education: 100, garbage: 100 };
  private nextId = 1;
  private fiscalPaymentRatio = 1;
  private _entityRevision = 0;

  constructor(terrain: TerrainGrid, roads: RoadSystem, externallyOccupied: (x: number, y: number) => boolean = () => false) {
    this.terrain = terrain;
    this.roads = roads;
    this.externallyOccupied = externallyOccupied;
  }

  get entityRevision(): number {
    return this._entityRevision;
  }

  placeFacility(type: ServiceFacilityType, x: number, y: number, treasury: TreasurySystem): { ok: boolean; cost: number; reason?: string } {
    const definition = SERVICE_DEFINITIONS[type];
    const cost = definition.constructionCost;
    if (!this.terrain.isBuildable(x, y)) return { ok: false, cost, reason: 'unbuildable terrain' };
    if (this.roads.has(x, y)) return { ok: false, cost, reason: 'road occupies cell' };
    if (this.externallyOccupied(x, y) || this.facilities.some((facility) => facility.x === x && facility.y === y)) {
      return { ok: false, cost, reason: 'cell occupied' };
    }
    if (!CARDINAL.some(([dx, dy]) => this.roads.has(x + dx, y + dy))) return { ok: false, cost, reason: 'road access required' };
    if (!treasury.tryDebit(cost, `Build ${definition.label}`)) return { ok: false, cost, reason: 'insufficient funds' };
    this.facilities.push({ id: `service:${this.nextId++}`, type, department: definition.department, x, y });
    this._entityRevision++;
    return { ok: true, cost };
  }

  listFacilities(): ServiceFacility[] {
    return this.facilities.map((facility) => ({ ...facility })).sort((a, b) => a.id.localeCompare(b.id));
  }

  getFacility(id: string): ServiceFacility | undefined {
    const facility = this.facilities.find((item) => item.id === id);
    return facility ? { ...facility } : undefined;
  }

  getAt(x: number, y: number): ServiceFacility | undefined {
    const facility = this.facilities.find((item) => item.x === x && item.y === y);
    return facility ? { ...facility } : undefined;
  }

  setFunding(department: ServiceDepartment, percent: number): number {
    const finite = Number.isFinite(percent) ? percent : 100;
    this.funding[department] = Math.max(50, Math.min(150, finite));
    return this.funding[department];
  }

  getFunding(department: ServiceDepartment): number {
    return this.funding[department];
  }

  fundingSnapshot(): DepartmentFunding {
    return { ...this.funding };
  }

  fundingEffectiveness(department: ServiceDepartment): number {
    const ratio = this.funding[department] / 100;
    const funding = Math.max(0.5, Math.min(1.25, 0.35 + 0.65 * ratio));
    return Math.max(0.35, funding * this.fiscalPaymentRatio);
  }

  effectiveStaffing(facilityId: string): number {
    const facility = this.requireFacility(facilityId);
    const definition = SERVICE_DEFINITIONS[facility.type];
    return definition.staffingRequired * this.fundingEffectiveness(facility.department);
  }

  effectiveCapacity(facilityId: string): number {
    const facility = this.requireFacility(facilityId);
    const definition = SERVICE_DEFINITIONS[facility.type];
    return definition.baseCapacity * this.fundingEffectiveness(facility.department);
  }

  activeVehicleCount(facilityId: string): number {
    const facility = this.requireFacility(facilityId);
    const definition = SERVICE_DEFINITIONS[facility.type];
    if (definition.baseVehicleCount === 0) return 0;
    return Math.max(0, Math.min(definition.baseVehicleCount, Math.floor(definition.baseVehicleCount * this.fundingEffectiveness(facility.department) + 1e-9)));
  }

  setFiscalPaymentRatio(ratio: number): number {
    this.fiscalPaymentRatio = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 1));
    return this.fiscalPaymentRatio;
  }

  getFiscalPaymentRatio(): number {
    return this.fiscalPaymentRatio;
  }

  operatingCostByDepartment(): DepartmentCosts {
    const costs: DepartmentCosts = { fire: 0, police: 0, healthcare: 0, education: 0, garbage: 0 };
    for (const facility of this.facilities) {
      costs[facility.department] += SERVICE_DEFINITIONS[facility.type].monthlyOperatingCost * (this.funding[facility.department] / 100);
    }
    return costs;
  }

  totalOperatingCost(): number {
    return Object.values(this.operatingCostByDepartment()).reduce((sum, value) => sum + value, 0);
  }

  getNextId(): number {
    return this.nextId;
  }

  restore(facilities: readonly ServiceFacility[], funding: Partial<DepartmentFunding>, nextId: number, fiscalPaymentRatio = 1): void {
    this.facilities.length = 0;
    this.facilities.push(...facilities.map((facility) => ({ ...facility })));
    for (const department of DEPARTMENTS) this.setFunding(department, funding[department] ?? 100);
    this.nextId = Math.max(1, Math.floor(nextId));
    this.setFiscalPaymentRatio(fiscalPaymentRatio);
    this._entityRevision++;
  }

  private requireFacility(id: string): ServiceFacility {
    const facility = this.facilities.find((item) => item.id === id);
    if (!facility) throw new Error(`unknown service facility: ${id}`);
    return facility;
  }
}