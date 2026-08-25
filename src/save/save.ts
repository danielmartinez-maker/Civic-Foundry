import type { SimulationCore } from '../simulation/core/SimulationCore.ts';
import { hydrateCore as hydrateCoreV4, serializeCore as serializeCoreV4 } from './saveLegacy.ts';
import { hydrateCoreV5, serializeCoreV5 } from './saveV5.ts';
import { hydrateCoreV6, serializeCoreV6 } from './saveV6.ts';
import { hydrateCoreV7, serializeCoreV7 } from './saveV7.ts';
import { hydrateCoreV8, serializeCoreV8, type SaveV8 } from './saveV8.ts';

export type { SaveTrafficVehicle, SaveV3, SaveV4 } from './saveLegacy.ts';
export type { SaveV5 } from './saveV5.ts';
export type { SaveV6 } from './saveV6.ts';
export type { SaveV7 } from './saveV7.ts';
export type { SaveV8 } from './saveV8.ts';
export {
  hydrateCoreV4,
  serializeCoreV4,
  hydrateCoreV5,
  serializeCoreV5,
  hydrateCoreV6,
  serializeCoreV6,
  hydrateCoreV7,
  serializeCoreV7,
  hydrateCoreV8,
  serializeCoreV8,
};

export function serializeCore(core: SimulationCore): SaveV8 {
  return sanitizePausedServiceState(serializeCoreV8(core), core);
}

export function hydrateCore(input: unknown): SimulationCore { return hydrateCoreV8(input); }

function sanitizePausedServiceState(save: SaveV8, core: SimulationCore): SaveV8 {
  const buildingIds = new Set(core.buildings.list().map((building) => building.id));
  const orphanJobIds = new Set(save.services.jobs.filter((job) => !buildingIds.has(job.targetBuildingId)).map((job) => job.id));
  const resetVehicleIds = new Set(save.services.vehicles.filter((vehicle) => vehicle.currentJobId !== null && orphanJobIds.has(vehicle.currentJobId)).map((vehicle) => vehicle.id));

  let recoveredCargo = 0;
  const jobCargo = save.services.waste.jobCargo.filter(([jobId, cargo]) => {
    if (!orphanJobIds.has(jobId)) return true;
    recoveredCargo += Math.max(0, cargo);
    return false;
  });

  const vehicles = save.services.vehicles.map((vehicle) => {
    if (!vehicle.currentJobId || !orphanJobIds.has(vehicle.currentJobId)) return vehicle;
    const { queuedNodeId: _queuedNodeId, ...rest } = vehicle;
    return {
      ...rest,
      currentJobId: null,
      edgeIds: [],
      returnEdgeIds: [],
      currentEdgeIndex: 0,
      edgeProgressTicks: 0,
      currentSpeed: 0,
      state: 'idle' as const,
      accumulatedDelayTicks: 0,
      currentNodeId: vehicle.homeNodeId,
      destinationNodeId: null,
      serviceRemainingTicks: 0,
    };
  });

  const intersections = Object.fromEntries(Object.entries(save.intersections).map(([nodeId, approaches]) => [
    nodeId,
    approaches.map((approach) => ({
      incomingEdgeId: approach.incomingEdgeId,
      entries: approach.entries.filter((entry) => !resetVehicleIds.has(entry.vehicleId)).map((entry) => ({ ...entry })),
    })).filter((approach) => approach.entries.length > 0),
  ]).filter(([, approaches]) => (approaches as readonly unknown[]).length > 0));

  const filterBuildingRecord = <T>(record: Readonly<Record<string, T>>): Record<string, T> =>
    Object.fromEntries(Object.entries(record).filter(([buildingId]) => buildingIds.has(buildingId)));

  return {
    ...save,
    intersections,
    services: {
      ...save.services,
      jobs: save.services.jobs.filter((job) => !orphanJobIds.has(job.id)),
      vehicles,
      incidents: save.services.incidents.filter((incident) => buildingIds.has(incident.targetBuildingId) && !orphanJobIds.has(incident.serviceJobId)),
      waste: {
        ...save.services.waste,
        buildings: save.services.waste.buildings.filter((state) => buildingIds.has(state.buildingId)),
        processingQueue: save.services.waste.processingQueue + recoveredCargo,
        jobCargo,
        jobAssignments: save.services.waste.jobAssignments.filter(([buildingId, jobId]) => buildingIds.has(buildingId) && !orphanJobIds.has(jobId)),
      },
    },
    serviceCached: {
      ...save.serviceCached,
      demand: { ...save.serviceCached.demand, perBuilding: filterBuildingRecord(save.serviceCached.demand.perBuilding) },
      neighborhood: { ...save.serviceCached.neighborhood, perBuilding: filterBuildingRecord(save.serviceCached.neighborhood.perBuilding) },
      accessByBuilding: filterBuildingRecord(save.serviceCached.accessByBuilding),
    },
  };
}
