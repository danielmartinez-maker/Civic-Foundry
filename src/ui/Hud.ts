import type { SimulationCore } from '../simulation/core/SimulationCore.ts';
import type { TaxRates } from '../simulation/tax/TaxSystem.ts';

export type HudMetrics = Readonly<{
  treasury: number;
  population: number;
  residentialDemand: number;
  commercialDemand: number;
  industrialDemand: number;
  employed: number;
  jobs: number;
  unemploymentRate: number;
  powerRatio: number;
  waterRatio: number;
  garbageRatio: number;
  garbageBacklog: number;
  netRecurringBalance: number;
  taxRates: TaxRates;
  activeVehicles: number;
  congestionIndex: number;
  averageNetworkSpeed: number;
  averageCommuteTicks: number;
  delayedTripShare: number;
  jobAccessibility: number;
  commercialAccessibility: number;
  serviceQuality: number;
  educationServiceRatio: number;
  activeServiceVehicles: number;
  waitingServiceJobs: number;
  serviceOperatingCost: number;
  serviceFiscalRatio: number;
}>;

export function collectHudMetrics(core: SimulationCore): HudMetrics {
  return {
    treasury: core.treasury.balance,
    population: core.population.population,
    residentialDemand: core.demandSnapshot.residential,
    commercialDemand: core.demandSnapshot.commercial,
    industrialDemand: core.demandSnapshot.industrial,
    employed: core.employmentSnapshot.employed,
    jobs: core.employmentSnapshot.totalJobs,
    unemploymentRate: core.employmentSnapshot.unemploymentRate,
    powerRatio: core.utilitySnapshot.power.serviceRatio,
    waterRatio: core.utilitySnapshot.water.serviceRatio,
    garbageRatio: core.garbageSnapshot.serviceRatio,
    garbageBacklog: core.garbageSnapshot.backlog,
    netRecurringBalance: core.economySnapshot.netRecurringBalance,
    taxRates: core.taxes.getRates(),
    activeVehicles: core.trafficSnapshot.activeVehicleCount,
    congestionIndex: core.trafficSnapshot.congestionIndex,
    averageNetworkSpeed: core.trafficSnapshot.averageNetworkSpeed,
    averageCommuteTicks: core.trafficSnapshot.averageCommuteTicks,
    delayedTripShare: core.trafficSnapshot.delayedTripShare,
    jobAccessibility: core.trafficSnapshot.jobAccessibility,
    commercialAccessibility: core.trafficSnapshot.commercialAccessibility,
    serviceQuality: core.neighborhoodSnapshot.citywideServiceQuality,
    educationServiceRatio: core.educationSnapshot.educationServiceRatio,
    activeServiceVehicles: core.serviceVehicles.listVehicles().filter((vehicle) => vehicle.state !== 'unavailable').length,
    waitingServiceJobs: core.serviceDispatch.listJobs().filter((job) => job.status === 'waiting').length,
    serviceOperatingCost: core.services.totalOperatingCost(),
    serviceFiscalRatio: core.services.getFiscalPaymentRatio(),
  };
}

export function percent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

export class HudView {
  private readonly root: HTMLElement;
  private readonly values = new Map<string, HTMLElement>();

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = [
      ['treasury', 'Treasury'], ['population', 'Population'], ['demand', 'R / C / I'], ['jobs', 'Jobs'],
      ['power', 'Power'], ['water', 'Water'], ['garbage', 'Waste'], ['net', 'Recurring'],
      ['vehicles', 'Vehicles'], ['congestion', 'Congestion'], ['access', 'Job access'], ['commute', 'Commute'],
      ['service', 'Services'], ['education', 'Education'], ['service-fleet', 'Service fleet'], ['service-jobs', 'Waiting calls'],
    ].map(([id, label]) => `<div class="hud-stat"><span>${label}</span><strong data-hud="${id}">—</strong></div>`).join('');
    root.querySelectorAll<HTMLElement>('[data-hud]').forEach((element) => this.values.set(element.dataset.hud ?? '', element));
  }

  update(metrics: HudMetrics): void {
    this.set('treasury', `$${Math.round(metrics.treasury).toLocaleString()}`);
    this.set('population', Math.round(metrics.population).toLocaleString());
    this.set('demand', `${metrics.residentialDemand.toFixed(2)} / ${metrics.commercialDemand.toFixed(2)} / ${metrics.industrialDemand.toFixed(2)}`);
    this.set('jobs', `${metrics.employed}/${metrics.jobs} · ${percent(metrics.unemploymentRate)} unemp.`);
    this.set('power', percent(metrics.powerRatio));
    this.set('water', percent(metrics.waterRatio));
    this.set('garbage', `${percent(metrics.garbageRatio)} · ${metrics.garbageBacklog.toFixed(0)} backlog`);
    const sign = metrics.netRecurringBalance >= 0 ? '+' : '−';
    this.set('net', `${sign}$${Math.round(Math.abs(metrics.netRecurringBalance)).toLocaleString()}`);
    this.set('vehicles', String(metrics.activeVehicles));
    this.set('congestion', percent(metrics.congestionIndex));
    this.set('access', percent(metrics.jobAccessibility));
    this.set('commute', metrics.averageCommuteTicks > 0 ? `${metrics.averageCommuteTicks.toFixed(1)} ticks` : '—');
    this.set('service', percent(metrics.serviceQuality));
    this.set('education', percent(metrics.educationServiceRatio));
    this.set('service-fleet', String(metrics.activeServiceVehicles));
    this.set('service-jobs', String(metrics.waitingServiceJobs));
  }

  private set(id: string, value: string): void {
    const element = this.values.get(id);
    if (element) element.textContent = value;
  }
}
