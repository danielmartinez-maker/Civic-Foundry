import type { SimulationCore } from '../simulation/core/SimulationCore.ts';
import { districtForLegacyZone, getZoningDistrict } from '../simulation/zoning/ZoningDistrictCatalog.ts';
import type { ZoningDistrict } from '../simulation/zoning/ZoningTypes.ts';
import type { Parcel } from '../world/cadastre/CadastralTypes.ts';
import { escapeHtml } from './escapeHtml.ts';

export class ParcelInspector {
  render(parcelId: string, core: SimulationCore): string {
    const parcel = core.cadastre.getParcel(parcelId);
    if (!parcel) throw new Error(`unknown parcel: ${parcelId}`);

    const district = resolveDistrict(parcel, core);
    const envelope = district
      ? core.buildableEnvelopes.evaluate(parcel.id, core.cadastre, district)
      : undefined;
    const buildings = core.buildings.listV2()
      .filter((building) => building.parcelIds.includes(parcel.id))
      .sort((left, right) => left.id.localeCompare(right.id));
    const primaryBuilding = buildings[0];
    const property = core.propertyMarket.snapshot();
    const holding = property.holdings.find((item) => item.parcelId === parcel.id);
    const latestTransaction = property.transactions
      .filter((transaction) => transaction.parcelIds.includes(parcel.id))
      .sort((left, right) => left.tick - right.tick || left.id.localeCompare(right.id))
      .at(-1);
    const lineage = core.cadastre.listLineage()
      .filter((event) => event.sourceParcelIds.includes(parcel.id) || event.resultingParcelIds.includes(parcel.id));

    const frontageMeters = envelope?.frontageMeters ?? frontageLength(parcel, core);
    const buildingUses = buildings.length === 0
      ? 'none'
      : [...new Set(buildings.flatMap((building) => building.floors.flatMap((floor) => floor.uses.map((use) => use.use))))]
        .sort()
        .join(', ');
    const realizedFAR = buildings.reduce((sum, building) => sum + building.realizedFAR, 0);
    const averageCondition = buildings.length === 0
      ? undefined
      : buildings.reduce((sum, building) => sum + building.lifecycle.condition, 0) / buildings.length;
    const effectiveAge = buildings.length === 0
      ? undefined
      : buildings.reduce((sum, building) => sum + building.lifecycle.effectiveAge, 0) / buildings.length;
    const drivers = redevelopmentDrivers(buildings.length, realizedFAR, envelope?.effectiveFAR, averageCondition);
    const constraints = envelope?.limitingConstraints.map((constraint) => constraint.code) ?? [];

    return [
      '<section class="parcel-inspector">',
      `<h3>Parcel ${text(parcel.id)}</h3>`,
      '<dl>',
      row('Area', `${parcel.areaM2.toFixed(1)} m²`),
      row('Frontage', `${frontageMeters.toFixed(1)} m`),
      row('District', district?.id ?? parcel.zoningDistrictId ?? 'unassigned'),
      row('Allowed FAR', envelope ? envelope.allowedFAR.toFixed(2) : 'n/a'),
      row('Effective FAR', envelope ? envelope.effectiveFAR.toFixed(2) : 'n/a'),
      row('Height', envelope ? `${envelope.maxHeightMeters.toFixed(1)} m` : 'n/a'),
      row('Coverage', envelope ? `${(envelope.effectiveCoverageRatio * 100).toFixed(0)}%` : 'n/a'),
      row('Building uses', buildingUses),
      row('Realized FAR', realizedFAR.toFixed(2)),
      row('Condition', averageCondition === undefined ? 'vacant' : `${averageCondition.toFixed(0)}/100`),
      row('Effective age', effectiveAge === undefined ? 'n/a' : effectiveAge.toFixed(1)),
      row('Owner', holding?.ownerId ?? primaryBuilding?.ownerId ?? 'unassigned'),
      row('Land value', latestTransaction ? money(latestTransaction.landValue) : holding ? money(holding.reservationValue) : 'n/a'),
      row('Improvement value', latestTransaction ? money(latestTransaction.improvementValue) : primaryBuilding ? money(primaryBuilding.projectCost) : 'n/a'),
      row('Redevelopment pressure', 'not evaluated'),
      row('Positive drivers', drivers.length > 0 ? drivers.join('; ') : 'none'),
      row('Constraints', constraints.length > 0 ? constraints.join(', ') : 'none'),
      row('Lineage', lineageSummary(parcel.id, lineage)),
      '</dl>',
      '</section>',
    ].join('');
  }
}

function resolveDistrict(parcel: Parcel, core: SimulationCore): ZoningDistrict | undefined {
  const assignment = core.zoning.getParcelAssignment(parcel.id);
  if (assignment) return getZoningDistrict(assignment.districtId);
  const explicit = getZoningDistrict(parcel.zoningDistrictId);
  if (explicit) return explicit;
  if (parcel.zoningDistrictId === 'residential' || parcel.zoningDistrictId === 'commercial' || parcel.zoningDistrictId === 'industrial') {
    return districtForLegacyZone(parcel.zoningDistrictId);
  }
  return undefined;
}

function frontageLength(parcel: Parcel, core: SimulationCore): number {
  return parcel.frontageEdgeIds.reduce((sum, edgeId) => {
    const edge = core.cadastre.getEdge(edgeId);
    if (!edge) return sum;
    const start = core.cadastre.getNode(edge.startNodeId)?.point;
    const end = core.cadastre.getNode(edge.endNodeId)?.point;
    if (!start || !end) return sum;
    return sum + Math.hypot(end.x - start.x, end.y - start.y);
  }, 0);
}

function redevelopmentDrivers(
  buildingCount: number,
  realizedFAR: number,
  effectiveFAR: number | undefined,
  condition: number | undefined,
): string[] {
  const drivers: string[] = [];
  if (buildingCount === 0) drivers.push('vacant parcel');
  if (effectiveFAR !== undefined && effectiveFAR - realizedFAR > 0.05) {
    drivers.push(`${(effectiveFAR - realizedFAR).toFixed(2)} unused FAR`);
  }
  if (condition !== undefined && condition < 70) drivers.push('physical condition');
  return drivers;
}

function lineageSummary(
  parcelId: string,
  events: ReturnType<SimulationCore['cadastre']['listLineage']>,
): string {
  if (events.length === 0) return 'original parcel';
  return events.map((event) => {
    const direction = event.resultingParcelIds.includes(parcelId) ? 'from' : 'to';
    const related = direction === 'from' ? event.sourceParcelIds : event.resultingParcelIds;
    return `${event.operation} ${direction} ${related.join(', ')}`;
  }).join('; ');
}

function row(label: string, value: string): string {
  return `<dt>${text(label)}</dt><dd>${text(value)}</dd>`;
}

function text(value: string): string {
  return escapeHtml(value);
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}
