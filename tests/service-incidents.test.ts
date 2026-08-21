import test from 'node:test';
import assert from 'node:assert/strict';
import { IncidentSystem } from '../src/simulation/services/IncidentSystem.ts';
import { ServiceDispatchSystem, type ServiceJob } from '../src/simulation/services/ServiceDispatchSystem.ts';
import { ServiceVehicleSystem } from '../src/simulation/services/ServiceVehicleSystem.ts';
import { ServiceFacilitySystem } from '../src/simulation/services/ServiceFacilitySystem.ts';
import { ServiceDemandSystem, type ServiceDemandSnapshot } from '../src/simulation/services/ServiceDemandSystem.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { TreasurySystem } from '../src/simulation/treasury/TreasurySystem.ts';
import { RoadSystem } from '../src/world/roads/RoadSystem.ts';
import { TransportationGraph } from '../src/simulation/traffic/TransportationGraph.ts';
import { PathfindingSystem } from '../src/simulation/traffic/PathfindingSystem.ts';
import type { Building } from '../src/simulation/buildings/BuildingSystem.ts';

function building(id: string, x: number, y: number, zone: Building['zone'] = 'residential'): Building {
  return { id, lotId: `lot:${id}`, x, y, zone, definitionId: `${zone}_fixture`, status: 'occupied', constructionStartedTick: 0, completionTick: 0 };
}

function job(id: string, status: ServiceJob['status']): ServiceJob {
  return { id, type: 'fire_response', department: 'fire', targetBuildingId: 'target', createdTick: 0, severity: 1, status, accumulatedDelayTicks: 0 };
}

test('seeded incident generation is deterministic and higher real exposure produces incidents', () => {
  const buildings = [building('target', 4, 4, 'industrial')];
  const demand: ServiceDemandSnapshot = {
    eligibleStudents: 0,
    perBuilding: { target: { fire: 12, police: 0, healthcare: 0, educationStudents: 0, garbage: 0 } },
  };
  const dispatchA = new ServiceDispatchSystem();
  const dispatchB = new ServiceDispatchSystem();
  const a = new IncidentSystem(77);
  const b = new IncidentSystem(77);
  for (let tick = 1; tick <= 100; tick++) {
    a.generateFromDemand(tick, buildings, demand, dispatchA);
    b.generateFromDemand(tick, buildings, demand, dispatchB);
  }
  assert.deepEqual(a.listIncidents(), b.listIncidents());
  assert.ok(a.listIncidents().some((incident) => incident.kind === 'fire'));
});

test('fire intensity grows before responder arrival and declines during service', () => {
  const dispatch = new ServiceDispatchSystem();
  const incidents = new IncidentSystem(1);
  const id = incidents.createIncident('fire', building('target', 4, 4), 1, 0, dispatch);
  const linkedJob = incidents.getIncident(id)!.serviceJobId;
  const initial = incidents.getIncident(id)!.intensity;
  for (let tick = 1; tick <= 10; tick++) incidents.advance(tick, [job(linkedJob, 'waiting')], [building('target', 4, 4)]);
  const grown = incidents.getIncident(id)!.intensity;
  assert.ok(grown > initial);
  for (let tick = 11; tick <= 20; tick++) incidents.advance(tick, [job(linkedJob, 'servicing')], [building('target', 4, 4)]);
  assert.ok(incidents.getIncident(id)!.intensity < grown);
});

test('fire spread is bounded to cardinal adjacent occupied buildings', () => {
  const dispatch = new ServiceDispatchSystem();
  const incidents = new IncidentSystem(2);
  const center = building('center', 5, 5, 'industrial');
  const cardinal = building('cardinal', 6, 5);
  const diagonal = building('diagonal', 6, 6);
  const id = incidents.createIncident('fire', center, 1, 0, dispatch);
  const linked = incidents.getIncident(id)!.serviceJobId;
  for (let tick = 1; tick <= 12; tick++) incidents.advance(tick, [job(linked, 'waiting')], [center, cardinal, diagonal], dispatch);
  const targets = incidents.listIncidents().filter((incident) => incident.kind === 'fire').map((incident) => incident.targetBuildingId);
  assert.ok(targets.includes('cardinal'));
  assert.equal(targets.includes('diagonal'), false);
});

test('resolved police response reduces unresolved safety load and records a successful outcome', () => {
  const dispatch = new ServiceDispatchSystem();
  const incidents = new IncidentSystem(3);
  const id = incidents.createIncident('police', building('shop', 5, 5, 'commercial'), 0.8, 0, dispatch);
  const before = incidents.unresolvedLoad('police');
  const linked = incidents.getIncident(id)!.serviceJobId;
  const resolvedJob: ServiceJob = { id: linked, type: 'police_response', department: 'police', targetBuildingId: 'shop', createdTick: 0, severity: 0.8, status: 'completed', completionTick: 30, accumulatedDelayTicks: 30 };
  incidents.advance(30, [resolvedJob], [building('shop', 5, 5, 'commercial')]);
  assert.ok(incidents.unresolvedLoad('police') < before);
  assert.ok(incidents.recentOutcomeScore('police') > 0.5);
});

test('one-ambulance clinic leaves excess medical incidents waiting', () => {
  const terrainCells: TerrainCell[] = Array.from({ length: 20 * 12 }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' as const }));
  const terrain = new TerrainGrid(20, 12, terrainCells);
  const treasury = new TreasurySystem(300_000);
  const roads = new RoadSystem(terrain);
  roads.placePath(Array.from({ length: 14 }, (_, i) => ({ x: i + 2, y: 6 })), 'collector', treasury);
  const graph = new TransportationGraph(); graph.rebuildIfNeeded(roads);
  const facilities = new ServiceFacilitySystem(terrain, roads); facilities.restore([{ id: 'service:1', type: 'clinic', department: 'healthcare', x: 3, y: 5 }], {}, 2);
  const vehicles = new ServiceVehicleSystem(); vehicles.syncFleet(facilities);
  const dispatch = new ServiceDispatchSystem();
  const incidents = new IncidentSystem(4);
  const targets = [building('a', 10, 5), building('b', 12, 5)];
  incidents.createIncident('medical', targets[0]!, 0.7, 0, dispatch);
  incidents.createIncident('medical', targets[1]!, 0.7, 0, dispatch);
  dispatch.assignWaiting(targets, facilities, vehicles, graph, new PathfindingSystem(), (edge) => edge.freeFlowTicks, 1);
  const statuses = dispatch.listJobs().filter((entry) => entry.department === 'healthcare').map((entry) => entry.status).sort();
  assert.deepEqual(statuses, ['responding', 'waiting']);
});
