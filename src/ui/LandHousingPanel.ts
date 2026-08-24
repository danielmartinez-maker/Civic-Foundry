import type { LandHousingMarketSnapshot } from '../simulation/development/LandHousingMarketSystem.ts';
import type { HousingChoiceSnapshot } from '../simulation/housing/HousingChoiceSystem.ts';
import type { HousingTenureSnapshot } from '../simulation/housing/HousingTenureSystem.ts';
import type { HousingRelocationSnapshot } from '../simulation/housing/HousingRelocationSystem.ts';
import { housingAffordabilityScore } from '../simulation/housing/HousingEconomics.ts';
import type { RedevelopmentPressureSnapshot } from '../simulation/development/RedevelopmentPressureSystem.ts';
import type { RedevelopmentExecutionSnapshot, RedevelopmentExecutionDecisionReason } from '../simulation/development/RedevelopmentExecutionSystem.ts';

const pct = (value: number): string => `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
const index = (value: number): string => Number.isFinite(value) ? value.toFixed(2) : '0.00';
const number = (value: number): string => Number.isFinite(value) ? value.toFixed(value >= 100 ? 0 : 1) : '0';
const money = (value: number): string => `$${Math.round(Number.isFinite(value) ? value : 0).toLocaleString()}`;
const titleCase = (value: string): string => value.split('-').map((part) => part.length > 0 ? part[0]!.toUpperCase() + part.slice(1) : part).join(' ');
const average = (values: readonly number[]): number => values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

export class LandHousingPanel {
  render(
    market: LandHousingMarketSnapshot,
    housing: HousingChoiceSnapshot,
    tenure: HousingTenureSnapshot,
    relocation: HousingRelocationSnapshot,
    pressure: RedevelopmentPressureSnapshot,
    execution: RedevelopmentExecutionSnapshot,
  ): string {
    const rows: [string, string][] = [];
    for (const zone of ['residential', 'commercial', 'industrial'] as const) {
      const item = market.zones[zone];
      rows.push([
        `${zone[0]!.toUpperCase()}${zone.slice(1)} market`,
        `Pressure ${index(item.marketPressure)} · Rent index ${index(item.rentIndex)} · Vacancy ${pct(item.vacancyRate)} · Land value ${index(item.landValueIndex)}`,
      ]);
    }

    rows.push(
      ['Physical capacity', number(housing.physicalCapacity)],
      ['Effective affordable capacity', number(housing.effectiveAffordableCapacity)],
      ['Housed / population', `${number(housing.housedResidents)} / ${number(housing.population)}`],
      ['Unplaced residents', number(housing.unplacedResidents)],
      ['Affordability', pct(housing.affordabilityIndex)],
      ['Cost burden', `${pct(housing.costBurdenShare)} · ${number(housing.costBurdenedResidents)} residents`],
    );

    for (const band of ['lower', 'middle', 'upper'] as const) {
      const item = housing.byBand[band];
      const relocationBand = relocation.byBand[band];
      rows.push([
        `${band[0]!.toUpperCase()}${band.slice(1)} income`,
        `${number(item.assignedResidents)}/${number(item.targetResidents)} housed · ${number(item.unplacedResidents)} unplaced · ${pct(item.averageRentBurden)} average rent burden · ${number(relocationBand.renterResidents)} renter / ${number(relocationBand.ownerResidents)} owner`,
      ]);
    }

    const tenureBuildings = Object.values(tenure.byBuilding);
    const lowerIncomeAffordableSlack = tenure.options.reduce((sum, option) => {
      if (housingAffordabilityScore(option.monthlyCost, 'lower') <= 0) return sum;
      const building = relocation.byBuilding[option.buildingId];
      const assigned = option.tenure === 'renter' ? (building?.renterResidents ?? 0) : (building?.ownerResidents ?? 0);
      return sum + Math.max(0, option.capacity - assigned);
    }, 0);

    rows.push(
      ['Renter share', `${pct(relocation.renterShare)} · ${number(relocation.renterResidents)} residents`],
      ['Owner share', `${pct(relocation.ownerShare)} · ${number(relocation.ownerResidents)} residents`],
      ['Rental vacancy', pct(relocation.rentalVacancyRate)],
      ['Ownership vacancy', pct(relocation.ownershipVacancyRate)],
      ['Average asking rent', money(average(tenureBuildings.map((item) => item.askingRent)))],
      ['Average owner cost', money(average(tenureBuildings.map((item) => item.monthlyOwnerCost)))],
      ['Financing rate', pct(tenure.marketInterestRate)],
      ['Moved this cycle', number(relocation.movedResidentsThisCycle)],
      ['Displaced this cycle', number(relocation.displacedResidentsThisCycle)],
      ['Rehoused displaced', number(relocation.rehousedDisplacedResidentsThisCycle)],
      ['Failed searches', number(relocation.failedSearchResidentsThisCycle)],
      ['Lower-income affordable slack', number(lowerIncomeAffordableSlack)],
    );

    const reasonCounts = new Map<RedevelopmentExecutionDecisionReason, number>();
    for (const decision of execution.decisions) {
      reasonCounts.set(decision.reason, (reasonCounts.get(decision.reason) ?? 0) + 1);
    }
    const admitted = reasonCounts.get('admitted') ?? 0;
    const blockerSummary = [...reasonCounts.entries()]
      .filter(([reason]) => reason !== 'admitted')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([reason, count]) => `${titleCase(reason)} ${count}`)
      .join(' · ');

    rows.push(
      ['High-pressure parcels', `${pressure.highPressureCount} · average pressure ${index(pressure.averagePressure)}`],
      ['Redevelopment ready', `${admitted}`],
      ['Redevelopment blockers', blockerSummary || 'None'],
    );

    return `<div class="economy-grid">${rows.map(([label, value]) => `<div class="economy-row"><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>`;
  }
}
