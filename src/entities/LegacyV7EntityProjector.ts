import type { Lot } from '../world/lots/LotSystem.ts';
import type { Building } from '../simulation/buildings/BuildingSystem.ts';
import type { Firm } from '../simulation/economy/FirmSystem.ts';
import type { UtilityFacility } from '../simulation/utilities/UtilitySystem.ts';
import type { ServiceFacility } from '../simulation/services/ServiceFacilitySystem.ts';
import type { TransitLine, TransitStop } from '../simulation/transit/TransitNetworkSystem.ts';
import type { TrafficVehicle } from '../simulation/traffic/TrafficSystem.ts';
import type { ServiceVehicle } from '../simulation/services/ServiceVehicleSystem.ts';
import type { FreightVehicle } from '../simulation/economy/FreightVehicleSystem.ts';
import type { ServiceIncident } from '../simulation/services/IncidentSystem.ts';
import { ordinalCompare, type LegacyEntityKey } from './EntityTypes.ts';
import { EntityProjectionBuilder, type EntityProjectionData } from './EntityProjection.ts';

export type LegacyV7EntitySource = {
  lots: { list: () => Lot[] };
  buildings: { list: () => Building[] };
  economyDomain: {
    firms: { list: () => Firm[] };
    freightVehicles: { listVehicles: () => FreightVehicle[] };
  };
  utilities: { listFacilities: () => UtilityFacility[] };
  services: { listFacilities: () => ServiceFacility[] };
  transit: {
    listStops: () => TransitStop[];
    listLines: () => TransitLine[];
  };
  traffic: { activeVehicles: TrafficVehicle[] };
  serviceVehicles: { listVehicles: () => ServiceVehicle[] };
  incidents: { listIncidents: () => ServiceIncident[] };
};

function sortedById<T extends Readonly<{ id: string }>>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => ordinalCompare(a.id, b.id));
}

function key(kind: LegacyEntityKey['kind'], legacyId: string): LegacyEntityKey {
  return Object.freeze({ kind, legacyId });
}

function buildingToken(building: Building): string {
  return `${building.constructionStartedTick}|${building.completionTick}|${building.definitionId}|${building.developerId ?? ''}`;
}

function addBuildingWeakReference(
  builder: EntityProjectionBuilder,
  source: LegacyEntityKey,
  targetBuildingId: string,
  relation: string,
  evidenceTick: number,
  buildingById: ReadonlyMap<string, Building>,
): void {
  const target = key('building', targetBuildingId);
  const building = buildingById.get(targetBuildingId);
  if (building && building.constructionStartedTick <= evidenceTick) {
    builder.reference({ source, target, semantics: 'weak', relation });
    return;
  }
  builder.unresolved({
    source,
    target,
    semantics: 'weak',
    relation,
    reason: building
      ? `current building incarnation started at tick ${building.constructionStartedTick}, after reference evidence tick ${evidenceTick}`
      : 'referenced building incarnation is not present in current V7 state',
  });
}

export class LegacyV7EntityProjector {
  project(source: LegacyV7EntitySource): EntityProjectionData {
    const builder = new EntityProjectionBuilder();
    const lots = sortedById(source.lots.list());
    const buildings = sortedById(source.buildings.list());
    const firms = sortedById(source.economyDomain.firms.list());
    const utilityFacilities = sortedById(source.utilities.listFacilities());
    const serviceFacilities = sortedById(source.services.listFacilities());
    const transitStops = sortedById(source.transit.listStops());
    const transitLines = sortedById(source.transit.listLines());
    const trafficVehicles = sortedById(source.traffic.activeVehicles);
    const serviceVehicles = sortedById(source.serviceVehicles.listVehicles());
    const freightVehicles = sortedById(source.economyDomain.freightVehicles.listVehicles());
    const incidents = sortedById(source.incidents.listIncidents());

    const buildingById = new Map(buildings.map((building) => [building.id, building] as const));

    for (const lot of lots) {
      builder.entity({
        kind: 'lot',
        legacyId: lot.id,
        incarnationToken: lot.id,
        metadata: Object.freeze({ zone: lot.zone, x: lot.x, y: lot.y }),
      });
    }

    for (const building of buildings) {
      builder.entity({
        kind: 'building',
        legacyId: building.id,
        incarnationToken: buildingToken(building),
        metadata: Object.freeze({
          zone: building.zone,
          status: building.status,
          definitionId: building.definitionId,
          x: building.x,
          y: building.y,
        }),
      });
    }

    for (const firm of firms) {
      const sourceKey = key('firm', firm.id);
      builder.entity({
        kind: 'firm',
        legacyId: firm.id,
        incarnationToken: `${firm.formationTick}|${firm.buildingId}`,
        metadata: Object.freeze({ status: firm.status, zone: firm.zone, archetype: firm.archetype }),
      });

      const target = key('building', firm.buildingId);
      if (firm.status !== 'closed') {
        builder.reference({ source: sourceKey, target, semantics: 'strong', relation: 'firm-building' });
      } else {
        const building = buildingById.get(firm.buildingId);
        const evidenceTick = firm.closureTick ?? firm.formationTick;
        if (building && building.constructionStartedTick <= evidenceTick) {
          builder.reference({ source: sourceKey, target, semantics: 'weak', relation: 'firm-building' });
        } else {
          builder.unresolved({
            source: sourceKey,
            target,
            semantics: 'weak',
            relation: 'firm-building',
            reason: building
              ? 'closed firm predates the current building incarnation'
              : 'closed firm building incarnation is not present in current V7 state',
          });
        }
      }
    }

    for (const facility of utilityFacilities) {
      builder.entity({
        kind: 'utility-facility',
        legacyId: facility.id,
        incarnationToken: facility.id,
        metadata: Object.freeze({ type: facility.type, x: facility.x, y: facility.y }),
      });
    }

    for (const facility of serviceFacilities) {
      builder.entity({
        kind: 'service-facility',
        legacyId: facility.id,
        incarnationToken: facility.id,
        metadata: Object.freeze({
          type: facility.type,
          department: facility.department,
          x: facility.x,
          y: facility.y,
        }),
      });
    }

    for (const stop of transitStops) {
      builder.entity({
        kind: 'transit-stop',
        legacyId: stop.id,
        incarnationToken: stop.id,
        metadata: Object.freeze({ type: stop.type, x: stop.x, y: stop.y }),
      });
    }

    for (const line of transitLines) {
      const sourceKey = key('transit-line', line.id);
      builder.entity({
        kind: 'transit-line',
        legacyId: line.id,
        incarnationToken: line.id,
        metadata: Object.freeze({ mode: line.mode, enabled: line.enabled }),
      });
      for (const stopId of [...line.stopIds].sort(ordinalCompare)) {
        builder.reference({
          source: sourceKey,
          target: key('transit-stop', stopId),
          semantics: 'strong',
          relation: 'transit-line-stop',
        });
      }
    }

    for (const vehicle of trafficVehicles) {
      const sourceKey = key('traffic-vehicle', vehicle.id);
      builder.entity({
        kind: 'traffic-vehicle',
        legacyId: vehicle.id,
        incarnationToken: `${vehicle.departureTick}|${vehicle.tripId}`,
        metadata: Object.freeze({ purpose: vehicle.purpose, status: vehicle.status }),
      });
      addBuildingWeakReference(
        builder,
        sourceKey,
        vehicle.originBuildingId,
        'traffic-origin-building',
        vehicle.departureTick,
        buildingById,
      );
      addBuildingWeakReference(
        builder,
        sourceKey,
        vehicle.destinationBuildingId,
        'traffic-destination-building',
        vehicle.departureTick,
        buildingById,
      );
    }

    for (const vehicle of serviceVehicles) {
      const sourceKey = key('service-vehicle', vehicle.id);
      builder.entity({
        kind: 'service-vehicle',
        legacyId: vehicle.id,
        incarnationToken: vehicle.id,
        metadata: Object.freeze({
          department: vehicle.department,
          vehicleType: vehicle.vehicleType,
          state: vehicle.state,
        }),
      });
      builder.reference({
        source: sourceKey,
        target: key('service-facility', vehicle.facilityId),
        semantics: 'strong',
        relation: 'service-vehicle-facility',
      });
    }

    for (const vehicle of freightVehicles) {
      const sourceKey = key('freight-vehicle', vehicle.id);
      builder.entity({
        kind: 'freight-vehicle',
        legacyId: vehicle.id,
        incarnationToken: `${vehicle.departureTick}|${vehicle.shipment.id}`,
        metadata: Object.freeze({ status: vehicle.status, commodity: vehicle.shipment.commodity }),
      });
      if (vehicle.shipment.originKind === 'firm') {
        builder.reference({
          source: sourceKey,
          target: key('firm', vehicle.shipment.originId),
          semantics: 'weak',
          relation: 'freight-origin-firm',
        });
      }
      if (vehicle.shipment.destinationKind === 'firm') {
        builder.reference({
          source: sourceKey,
          target: key('firm', vehicle.shipment.destinationId),
          semantics: 'weak',
          relation: 'freight-destination-firm',
        });
      }
    }

    for (const incident of incidents) {
      const sourceKey = key('incident', incident.id);
      builder.entity({
        kind: 'incident',
        legacyId: incident.id,
        incarnationToken: `${incident.createdTick}|${incident.serviceJobId}`,
        metadata: Object.freeze({ kind: incident.kind, status: incident.status }),
      });
      addBuildingWeakReference(
        builder,
        sourceKey,
        incident.targetBuildingId,
        'incident-building',
        incident.createdTick,
        buildingById,
      );
    }

    return builder.build();
  }
}
