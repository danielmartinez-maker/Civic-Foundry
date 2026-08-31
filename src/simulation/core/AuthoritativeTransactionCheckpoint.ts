import type { SimulationCore as SimulationCoreBase } from './SimulationCoreBase.ts';
import type { Parcel } from '../../world/cadastre/CadastralTypes.ts';
import type { ZoneType } from './types.ts';

function legacyZoneForParcel(parcel: Parcel): ZoneType | undefined {
  const zone = parcel.zoningDistrictId;
  return zone === 'residential' || zone === 'commercial' || zone === 'industrial' ? zone : undefined;
}

export function captureAuthoritativeTransactionCheckpoint(core: SimulationCoreBase) {
  const waste = core.wasteCollection.snapshot();
  return Object.freeze({
    randomState: core.random.getState(),
    treasury: Object.freeze({ balance: core.treasury.balance, transactions: core.treasury.transactions.map((tx) => ({ ...tx })) }),
    roads: Object.freeze({ revision: core.roads.revision, cells: core.roads.list() }),
    zoning: core.zoning.list(),
    parcelAssignments: core.zoning.listParcelAssignments(),
    cadastre: core.cadastre.snapshot(),
    buildings: core.buildings.list(),
    buildingsV2: core.buildings.listV2(),
    propertyMarket: core.propertyMarket.snapshot(),
    population: core.population.population,
    taxRates: core.taxes.getRates(),
    utilities: Object.freeze({ facilities: core.utilities.listFacilities(), nextId: core.utilities.getNextId() }),
    garbageBacklog: core.garbage.snapshotBacklog(),
    economy: { ...core.economy.lastSettlement },
    employmentSnapshot: { ...core.employmentSnapshot },
    utilitySnapshot: structuredClone(core.utilitySnapshot),
    garbageSnapshot: { ...core.garbageSnapshot },
    demandSnapshot: { ...core.demandSnapshot },
    taxRevenue: { ...core.taxRevenue },
    economySnapshot: { ...core.economySnapshot },
    tripGeneration: Object.freeze({ rngState: core.tripGeneration.getRandomState(), nextTripId: core.tripGeneration.getNextTripId() }),
    traffic: core.traffic.snapshotState(),
    intersections: core.intersections.snapshot(),
    services: Object.freeze({
      facilities: core.services.listFacilities(),
      funding: core.services.fundingSnapshot(),
      fiscalPaymentRatio: core.services.getFiscalPaymentRatio(),
      nextFacilityId: core.services.getNextId(),
      jobs: core.serviceDispatch.listJobs(),
      nextJobId: core.serviceDispatch.getNextJobId(),
      vehicles: core.serviceVehicles.listVehicles(),
      incidents: core.incidents.listIncidents(),
      incidentOutcomes: core.incidents.snapshotOutcomes(),
      incidentRngState: core.incidents.getRandomState(),
      nextIncidentId: core.incidents.getNextIncidentId(),
      waste: Object.freeze({
        buildings: waste.buildings.map((item) => ({ ...item })),
        processingQueue: waste.processingQueue,
        processedTotal: waste.processedTotal,
        jobCargo: waste.jobCargo.map(([id, value]) => [id, value] as const),
        jobAssignments: waste.jobAssignments.map(([buildingId, jobId]) => [buildingId, jobId] as const),
      }),
    }),
    serviceDemandSnapshot: structuredClone(core.serviceDemandSnapshot),
    educationSnapshot: { ...core.educationSnapshot },
    neighborhoodSnapshot: structuredClone(core.neighborhoodSnapshot),
    serviceAccessByBuilding: structuredClone(core.serviceAccessByBuilding),
    lastServiceGeneratedWaste: core.lastServiceGeneratedWaste,
    transit: core.transit.snapshot(),
    mobility: core.mobility.snapshotState(),
    mobilitySnapshot: structuredClone(core.mobilitySnapshot),
    economyDomain: core.economyDomain.snapshotState(),
    developerMarket: core.developerMarket.snapshotState(),
    developmentPolicy: core.developmentPolicySnapshot,
    housingRelocation: core.housingRelocation.snapshotState(),
  });
}

export type AuthoritativeTransactionCheckpoint = ReturnType<typeof captureAuthoritativeTransactionCheckpoint>;

export function restoreAuthoritativeTransactionCheckpoint(
  core: SimulationCoreBase,
  checkpoint: AuthoritativeTransactionCheckpoint,
): void {
  core.random.setState(checkpoint.randomState);
  core.treasury.restore(checkpoint.treasury.balance, [...checkpoint.treasury.transactions]);
  core.roads.restore(checkpoint.roads.cells, checkpoint.roads.revision);
  core.zoning.restore(checkpoint.zoning);
  core.cadastre.replaceSnapshot(checkpoint.cadastre);
  core.lots.rebuildFromCadastre(core.cadastre, legacyZoneForParcel);
  core.zoning.restoreParcelAssignments(checkpoint.parcelAssignments);
  core.buildings.restore(checkpoint.buildings);
  core.buildings.restoreV2(checkpoint.buildingsV2);
  const historicalParcelIds = new Set(core.cadastre.listLineage().flatMap((event) => event.sourceParcelIds));
  core.propertyMarket.restore(checkpoint.propertyMarket, { isHistoricalParcelId: (parcelId) => historicalParcelIds.has(parcelId) });
  core.population.restore(checkpoint.population);
  core.taxes.restoreRates(checkpoint.taxRates);
  core.utilities.restore(checkpoint.utilities.facilities, checkpoint.utilities.nextId);
  core.garbage.restoreBacklog(checkpoint.garbageBacklog);
  core.economy.restore(checkpoint.economy);
  core.employmentSnapshot = { ...checkpoint.employmentSnapshot };
  core.utilitySnapshot = structuredClone(checkpoint.utilitySnapshot);
  core.garbageSnapshot = { ...checkpoint.garbageSnapshot };
  core.demandSnapshot = { ...checkpoint.demandSnapshot };
  core.taxRevenue = { ...checkpoint.taxRevenue };
  core.economySnapshot = { ...checkpoint.economySnapshot };
  core.transportationGraph.rebuildIfNeeded(core.roads);
  core.tripGeneration.restoreRandomState(checkpoint.tripGeneration.rngState, checkpoint.tripGeneration.nextTripId);
  core.traffic.restoreState(checkpoint.traffic);
  core.intersections.restore(checkpoint.intersections);
  core.services.restore(checkpoint.services.facilities, checkpoint.services.funding, checkpoint.services.nextFacilityId, checkpoint.services.fiscalPaymentRatio);
  core.serviceDispatch.restore(checkpoint.services.jobs, checkpoint.services.nextJobId);
  core.serviceVehicles.restore(checkpoint.services.vehicles);
  core.incidents.restore(checkpoint.services.incidents, checkpoint.services.incidentOutcomes, checkpoint.services.incidentRngState, checkpoint.services.nextIncidentId);
  core.wasteCollection.restore(
    checkpoint.services.waste.buildings,
    checkpoint.services.waste.processingQueue,
    checkpoint.services.waste.processedTotal,
    checkpoint.services.waste.jobCargo,
    checkpoint.services.waste.jobAssignments,
  );
  core.serviceDemandSnapshot = structuredClone(checkpoint.serviceDemandSnapshot);
  core.educationSnapshot = { ...checkpoint.educationSnapshot };
  core.neighborhoodSnapshot = structuredClone(checkpoint.neighborhoodSnapshot);
  core.serviceAccessByBuilding = structuredClone(checkpoint.serviceAccessByBuilding);
  core.lastServiceGeneratedWaste = checkpoint.lastServiceGeneratedWaste;
  core.transit.restore(checkpoint.transit);
  core.mobility.restoreState(checkpoint.mobility);
  core.mobilitySnapshot = structuredClone(checkpoint.mobilitySnapshot);
  core.economyDomain.restoreState(checkpoint.economyDomain);
  core.economyDomain.restoreDerivedContext(core.buildings.occupied());
  core.developerMarket.restoreState(checkpoint.developerMarket);
  core.setDevelopmentPolicy(checkpoint.developmentPolicy);
  core.restoreHousingState(checkpoint.housingRelocation);

  const loads: Record<string, number> = { ...core.serviceVehicles.edgeLoads() };
  for (const [edgeId, load] of Object.entries(core.mobility.vehicles.edgeLoads())) loads[edgeId] = (loads[edgeId] ?? 0) + load;
  for (const [edgeId, load] of Object.entries(core.economyDomain.freightVehicles.edgeLoads())) loads[edgeId] = (loads[edgeId] ?? 0) + load;
  core.traffic.refreshMetrics(core.transportationGraph, loads);
  core.trafficSnapshot = core.trafficAnalytics.evaluate(core.traffic.edgeMetrics, core.traffic.recentOutcomes, core.traffic.activeVehicles.length);
}
