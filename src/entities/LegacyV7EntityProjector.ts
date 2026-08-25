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
import { ordinalCompare, type EntityKind, type LegacyEntityKey } from './EntityTypes.ts';
import {
  EntityProjectionBuilder,
  type EntityProjectionData,
  type EntityProjectionPartition,
} from './EntityProjection.ts';

type Revisioned = Readonly<{ entityRevision?: number }>;
type CachedList = Readonly<{ revision: number; items: readonly Readonly<{ id: string }>[] }>;

export type LegacyV7EntitySource = {
  lots: Revisioned & { list: () => Lot[] };
  buildings: Revisioned & { list: () => Building[] };
  economyDomain: {
    firms: Revisioned & { list: () => Firm[] };
    freightVehicles: Revisioned & { listVehicles: () => FreightVehicle[] };
  };
  utilities: Revisioned & { listFacilities: () => UtilityFacility[] };
  services: Revisioned & { listFacilities: () => ServiceFacility[] };
  transit: {
    revision?: number;
    listStops: () => TransitStop[];
    listLines: () => TransitLine[];
  };
  traffic: Revisioned & { activeVehicles: TrafficVehicle[] };
  serviceVehicles: Revisioned & { listVehicles: () => ServiceVehicle[] };
  incidents: Revisioned & { listIncidents: () => ServiceIncident[] };
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

function stableRevisionKey(revisions: readonly (number | undefined)[]): string | undefined {
  if (revisions.some((revision) => revision === undefined)) return undefined;
  return (revisions as readonly number[]).join('|');
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

function composePartitions(partitions: readonly EntityProjectionPartition[]): EntityProjectionData {
  return Object.freeze({
    entities: Object.freeze(partitions.flatMap((partition) => partition.projection.entities)),
    references: Object.freeze(partitions.flatMap((partition) => partition.projection.references)),
    unresolved: Object.freeze(partitions.flatMap((partition) => partition.projection.unresolved)),
  });
}

export class LegacyV7EntityProjector {
  private lastSource: LegacyV7EntitySource | undefined;
  private readonly listCache = new Map<string, CachedList>();
  private readonly partitionCache = new Map<string, EntityProjectionPartition>();
  private lastComposedPartitions: readonly EntityProjectionPartition[] | undefined;
  private lastProjection: EntityProjectionData | undefined;
  private volatileRevision = 0;

  private resetForSource(source: LegacyV7EntitySource): void {
    if (source === this.lastSource) return;
    this.lastSource = source;
    this.listCache.clear();
    this.partitionCache.clear();
    this.lastComposedPartitions = undefined;
    this.lastProjection = undefined;
    this.volatileRevision = 0;
  }

  private cachedList<T extends Readonly<{ id: string }>>(
    name: string,
    revision: number | undefined,
    loader: () => readonly T[],
  ): T[] {
    if (revision === undefined) return sortedById(loader());
    const cached = this.listCache.get(name);
    if (cached?.revision === revision) return cached.items as T[];
    const items = sortedById(loader());
    this.listCache.set(name, Object.freeze({ revision, items: Object.freeze(items) }));
    return items;
  }

  private partition(
    id: string,
    ownedKinds: readonly EntityKind[],
    revisions: readonly (number | undefined)[],
    build: () => EntityProjectionData,
  ): EntityProjectionPartition {
    const stableKey = stableRevisionKey(revisions);
    const cached = this.partitionCache.get(id);
    if (stableKey !== undefined && cached?.revisionKey === stableKey) return cached;

    const partition = Object.freeze({
      id,
      ownedKinds: Object.freeze([...ownedKinds]),
      revisionKey: stableKey ?? `volatile:${++this.volatileRevision}`,
      projection: build(),
    });
    if (stableKey !== undefined) this.partitionCache.set(id, partition);
    return partition;
  }

  projectPartitions(source: LegacyV7EntitySource): readonly EntityProjectionPartition[] {
    this.resetForSource(source);

    let buildings: Building[] | undefined;
    let buildingById: ReadonlyMap<string, Building> | undefined;
    const getBuildings = (): Building[] => {
      buildings ??= this.cachedList('buildings', source.buildings.entityRevision, () => source.buildings.list());
      return buildings;
    };
    const getBuildingById = (): ReadonlyMap<string, Building> => {
      buildingById ??= new Map(getBuildings().map((building) => [building.id, building] as const));
      return buildingById;
    };

    const lots = this.partition('lots', ['lot'], [source.lots.entityRevision], () => {
      const builder = new EntityProjectionBuilder();
      for (const lot of this.cachedList('lots', source.lots.entityRevision, () => source.lots.list())) {
        builder.entity({
          kind: 'lot',
          legacyId: lot.id,
          incarnationToken: lot.id,
          metadata: Object.freeze({ zone: lot.zone, x: lot.x, y: lot.y }),
        });
      }
      return builder.build();
    });

    const buildingPartition = this.partition(
      'buildings',
      ['building'],
      [source.buildings.entityRevision, source.lots.entityRevision],
      () => {
        const builder = new EntityProjectionBuilder();
        for (const building of getBuildings()) {
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
        return builder.build();
      },
    );

    const firms = this.partition(
      'firms',
      ['firm'],
      [source.economyDomain.firms.entityRevision, source.buildings.entityRevision],
      () => {
        const builder = new EntityProjectionBuilder();
        const currentBuildingById = getBuildingById();
        for (const firm of this.cachedList(
          'firms',
          source.economyDomain.firms.entityRevision,
          () => source.economyDomain.firms.list(),
        )) {
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
            const building = currentBuildingById.get(firm.buildingId);
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
        return builder.build();
      },
    );

    const utilities = this.partition('utilities', ['utility-facility'], [source.utilities.entityRevision], () => {
      const builder = new EntityProjectionBuilder();
      for (const facility of this.cachedList(
        'utilities',
        source.utilities.entityRevision,
        () => source.utilities.listFacilities(),
      )) {
        builder.entity({
          kind: 'utility-facility',
          legacyId: facility.id,
          incarnationToken: facility.id,
          metadata: Object.freeze({ type: facility.type, x: facility.x, y: facility.y }),
        });
      }
      return builder.build();
    });

    const services = this.partition('services', ['service-facility'], [source.services.entityRevision], () => {
      const builder = new EntityProjectionBuilder();
      for (const facility of this.cachedList(
        'services',
        source.services.entityRevision,
        () => source.services.listFacilities(),
      )) {
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
      return builder.build();
    });

    const transit = this.partition(
      'transit',
      ['transit-stop', 'transit-line'],
      [source.transit.revision],
      () => {
        const builder = new EntityProjectionBuilder();
        const transitStops = this.cachedList('transit-stops', source.transit.revision, () => source.transit.listStops());
        const transitLines = this.cachedList('transit-lines', source.transit.revision, () => source.transit.listLines());

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
        return builder.build();
      },
    );

    const traffic = this.partition(
      'traffic',
      ['traffic-vehicle'],
      [source.traffic.entityRevision, source.buildings.entityRevision],
      () => {
        const builder = new EntityProjectionBuilder();
        const currentBuildingById = getBuildingById();
        for (const vehicle of this.cachedList(
          'traffic',
          source.traffic.entityRevision,
          () => source.traffic.activeVehicles,
        )) {
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
            currentBuildingById,
          );
          addBuildingWeakReference(
            builder,
            sourceKey,
            vehicle.destinationBuildingId,
            'traffic-destination-building',
            vehicle.departureTick,
            currentBuildingById,
          );
        }
        return builder.build();
      },
    );

    const serviceVehicles = this.partition(
      'service-vehicles',
      ['service-vehicle'],
      [source.serviceVehicles.entityRevision, source.services.entityRevision],
      () => {
        const builder = new EntityProjectionBuilder();
        for (const vehicle of this.cachedList(
          'service-vehicles',
          source.serviceVehicles.entityRevision,
          () => source.serviceVehicles.listVehicles(),
        )) {
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
        return builder.build();
      },
    );

    const freight = this.partition(
      'freight',
      ['freight-vehicle'],
      [source.economyDomain.freightVehicles.entityRevision, source.economyDomain.firms.entityRevision],
      () => {
        const builder = new EntityProjectionBuilder();
        for (const vehicle of this.cachedList(
          'freight',
          source.economyDomain.freightVehicles.entityRevision,
          () => source.economyDomain.freightVehicles.listVehicles(),
        )) {
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
        return builder.build();
      },
    );

    const incidents = this.partition(
      'incidents',
      ['incident'],
      [source.incidents.entityRevision, source.buildings.entityRevision],
      () => {
        const builder = new EntityProjectionBuilder();
        const currentBuildingById = getBuildingById();
        for (const incident of this.cachedList(
          'incidents',
          source.incidents.entityRevision,
          () => source.incidents.listIncidents(),
        )) {
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
            currentBuildingById,
          );
        }
        return builder.build();
      },
    );

    return Object.freeze([
      lots,
      buildingPartition,
      firms,
      utilities,
      services,
      transit,
      traffic,
      serviceVehicles,
      freight,
      incidents,
    ]);
  }

  project(source: LegacyV7EntitySource): EntityProjectionData {
    const partitions = this.projectPartitions(source);
    if (this.lastProjection !== undefined
      && this.lastComposedPartitions !== undefined
      && this.lastComposedPartitions.length === partitions.length
      && partitions.every((partition, index) => partition === this.lastComposedPartitions![index])) {
      return this.lastProjection;
    }

    const projection = composePartitions(partitions);
    this.lastComposedPartitions = partitions;
    this.lastProjection = projection;
    return projection;
  }
}
