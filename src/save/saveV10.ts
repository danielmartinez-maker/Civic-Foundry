import type { SimulationCore } from "../simulation/core/SimulationCore.ts";
import type { DynamicRoutingSnapshot } from "../simulation/transportation/DynamicRoutingSystem.ts";
import type { IntersectionControlSnapshot } from "../simulation/transportation/IntersectionControlSystem.ts";
import type { ParkingAuthoritySnapshot } from "../simulation/transportation/ParkingAuthoritySystem.ts";
import type { TransportationIncidentSnapshot } from "../simulation/transportation/TransportationIncidentSystem.ts";
import { hydrateCoreV9, serializeCoreV9, type SaveV9 } from "./saveV9.ts";

export type TransportationSaveStateV10 = Readonly<{
  intersections: IntersectionControlSnapshot;
  dynamicRouting: DynamicRoutingSnapshot;
  incidents: TransportationIncidentSnapshot;
  parking: ParkingAuthoritySnapshot;
}>;

export type SaveV10 = Omit<SaveV9, "saveVersion" | "gameVersion"> &
  Readonly<{
    saveVersion: 10;
    gameVersion: "0.10.0-transportation-3r";
    transportation3R: TransportationSaveStateV10;
  }>;

export function serializeCoreV10(
  core: SimulationCore,
  baseV9: SaveV9 = serializeCoreV9(core),
): SaveV10 {
  core.transportation3R.refreshNetwork(core.roads, core.transportationGraph);
  return Object.freeze({
    ...baseV9,
    saveVersion: 10,
    gameVersion: "0.10.0-transportation-3r",
    transportation3R: Object.freeze({
      intersections: core.transportation3R.intersections.snapshot(),
      dynamicRouting: core.transportation3R.dynamicRouting.snapshot(),
      incidents: core.transportation3R.incidents.snapshot(),
      parking: core.transportation3R.parking.snapshot(),
    }),
  });
}

export function hydrateCoreV10(input: unknown): SimulationCore {
  if (!isRecord(input) || input.saveVersion !== 10) return hydrateCoreV9(input);
  if (input.gameVersion !== "0.10.0-transportation-3r") {
    throw new Error("invalid V10 game version");
  }
  if (!isRecord(input.transportation3R)) {
    throw new Error("transportation3R must be an object");
  }

  const save = input as unknown as SaveV10;
  const { transportation3R: _transportation3R, ...withoutTransportation } =
    save;
  const v9: SaveV9 = {
    ...withoutTransportation,
    saveVersion: 9,
    gameVersion: "0.9.0-urban-fabric",
  };
  const core = hydrateCoreV9(v9);
  core.transportation3R.refreshNetwork(core.roads, core.transportationGraph);
  validateTransportationReferences(core, save.transportation3R);
  core.transportation3R.incidents.restore(save.transportation3R.incidents);
  core.transportation3R.parking.restore(save.transportation3R.parking);
  core.transportation3R.dynamicRouting.restore(
    save.transportation3R.dynamicRouting,
  );
  core.transportation3R.intersections.restore(
    save.transportation3R.intersections,
  );
  return core;
}

function validateTransportationReferences(
  core: SimulationCore,
  state: TransportationSaveStateV10,
): void {
  const network = core.transportation3R.networkSnapshot();
  const junctionIds = new Set(network.junctions.map((item) => item.id));
  const segmentIds = new Set(network.segments.map((item) => item.id));
  const carriagewayIds = new Set(network.carriageways.map((item) => item.id));
  const laneIds = new Set(network.lanes.map((item) => item.id));
  const movementIds = new Set(network.movements.map((item) => item.id));

  for (const control of state.intersections.controls) {
    if (!junctionIds.has(control.junctionId)) {
      throw new Error(
        `V10 intersection control references missing junction: ${control.junctionId}`,
      );
    }
  }
  for (const queue of state.intersections.queues) {
    if (!movementIds.has(queue.movementId)) {
      throw new Error(
        `V10 intersection queue references missing movement: ${queue.movementId}`,
      );
    }
  }
  for (const pending of state.intersections.pendingReleased) {
    if (!junctionIds.has(pending.junctionId)) {
      throw new Error(
        `V10 released queue references missing junction: ${pending.junctionId}`,
      );
    }
    for (const release of pending.releases) {
      if (!movementIds.has(release.movementId)) {
        throw new Error(
          `V10 released queue references missing movement: ${release.movementId}`,
        );
      }
    }
  }
  for (const item of state.intersections.serviceCredits) {
    if (!movementIds.has(item.movementId)) {
      throw new Error(
        `V10 service credit references missing movement: ${item.movementId}`,
      );
    }
  }
  for (const item of state.intersections.lastSteppedTicks) {
    if (!junctionIds.has(item.junctionId)) {
      throw new Error(
        `V10 stepped tick references missing junction: ${item.junctionId}`,
      );
    }
  }

  for (const id of Object.keys(
    state.dynamicRouting.state.travelTimeTicksByCarriageway,
  )) {
    if (!carriagewayIds.has(id)) {
      throw new Error(
        `V10 routing state references missing carriageway: ${id}`,
      );
    }
  }
  for (const id of Object.keys(
    state.dynamicRouting.state.congestionPenaltyTicksByCarriageway,
  )) {
    if (!carriagewayIds.has(id)) {
      throw new Error(
        `V10 congestion state references missing carriageway: ${id}`,
      );
    }
  }
  for (const id of Object.keys(
    state.dynamicRouting.state.incidentPenaltyTicksByCarriageway,
  )) {
    if (!carriagewayIds.has(id)) {
      throw new Error(
        `V10 incident routing state references missing carriageway: ${id}`,
      );
    }
  }
  for (const id of state.dynamicRouting.state.blockedCarriagewayIds) {
    if (!carriagewayIds.has(id)) {
      throw new Error(
        `V10 blocked routing state references missing carriageway: ${id}`,
      );
    }
  }
  for (const id of state.dynamicRouting.state.blockedMovementIds) {
    if (!movementIds.has(id)) {
      throw new Error(
        `V10 blocked routing state references missing movement: ${id}`,
      );
    }
  }

  for (const incident of state.incidents.incidents) {
    if (!segmentIds.has(incident.segmentId)) {
      throw new Error(
        `V10 incident references missing segment: ${incident.segmentId}`,
      );
    }
    for (const laneId of incident.laneIds) {
      if (!laneIds.has(laneId)) {
        throw new Error(`V10 incident references missing lane: ${laneId}`);
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
