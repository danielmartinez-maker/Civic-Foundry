import test from 'node:test';
import assert from 'node:assert/strict';
import { LegacyV7EntityProjector, type LegacyV7EntitySource } from '../src/entities/LegacyV7EntityProjector.ts';

function fixtureSource(): LegacyV7EntitySource {
  return {
    lots: { list: () => [{ id: 'lot:1,1', x: 1, y: 1, zone: 'commercial', frontageRoadKey: '1,0' }] },
    buildings: { list: () => [{ id: 'building:lot:1,1', lotId: 'lot:1,1', x: 1, y: 1, zone: 'commercial', definitionId: 'commercial-low', status: 'occupied', constructionStartedTick: 10, completionTick: 20 }] },
    economyDomain: {
      firms: { list: () => [{ id: 'firm:1', buildingId: 'building:lot:1,1', zone: 'commercial', archetype: 'retail_local', status: 'operating', jobCapacity: 10, filledJobs: 8, vacancies: 2, productivity: 1, cashHealth: 1, consecutiveLossCycles: 0, consecutiveRecoveryCycles: 0, formationTick: 25, lastOperatingMargin: 0.1 }] },
      freightVehicles: { listVehicles: () => [{ id: 'freight-vehicle:1', shipment: { id: 'shipment:1', orderId: 'order:1', commodity: 'consumer_goods', quantity: 2, vehicleWeight: 1, originKind: 'firm', originId: 'firm:1', destinationKind: 'gateway', destinationId: 'gateway:east', originNodeId: '1,0', destinationNodeId: '2,0', createdTick: 30, generalizedCost: 4 }, routeEdgeIds: ['edge:1'], currentEdgeIndex: 0, edgeProgressTicks: 0, departureTick: 31, expectedArrivalTick: 40, delayTicks: 0, status: 'moving' }] },
    },
    utilities: { listFacilities: () => [{ id: 'utility:1', type: 'power', x: 2, y: 1 }] },
    services: { listFacilities: () => [{ id: 'service:1', type: 'fire_station', department: 'fire', x: 3, y: 1 }] },
    transit: {
      listStops: () => [
        { id: 'transit-stop:1', type: 'surface_stop', x: 4, y: 1 },
        { id: 'transit-stop:2', type: 'surface_stop', x: 5, y: 1 },
      ],
      listLines: () => [{ id: 'transit-line:1', name: 'One', mode: 'bus', stopIds: ['transit-stop:1', 'transit-stop:2'], headwayTicks: 20, fare: 1, enabled: true }],
    },
    traffic: { activeVehicles: [{ id: 'vehicle:1', tripId: 'trip:1', purpose: 'commute', travelerWeight: 1, originBuildingId: 'building:lot:1,1', destinationBuildingId: 'building:lot:1,1', edgeIds: ['edge:1'], currentEdgeIndex: 0, edgeProgressTicks: 0, departureTick: 30, accumulatedDelayTicks: 0, freeFlowTicks: 5, status: 'moving' }] },
    serviceVehicles: { listVehicles: () => [{ id: 'service-vehicle:service:1:1', facilityId: 'service:1', department: 'fire', vehicleType: 'fire_engine', currentJobId: null, edgeIds: [], returnEdgeIds: [], currentEdgeIndex: 0, edgeProgressTicks: 0, currentSpeed: 0, state: 'idle', accumulatedDelayTicks: 0, currentNodeId: null, destinationNodeId: null, homeNodeId: null, serviceRemainingTicks: 0 }] },
    incidents: { listIncidents: () => [{ id: 'incident:1', kind: 'fire', targetBuildingId: 'building:lot:1,1', createdTick: 35, severity: 0.5, intensity: 0.5, damage: 0, status: 'active', serviceJobId: 'service-job:1', spreadTriggered: false }] },
  };
}

test('V7 projector covers durable compatibility entities and deliberately excludes project identity', () => {
  const projection = new LegacyV7EntityProjector().project(fixtureSource());
  const kinds = new Set(projection.entities.map((entity) => entity.kind));
  for (const kind of ['lot', 'building', 'firm', 'utility-facility', 'service-facility', 'transit-stop', 'transit-line', 'traffic-vehicle', 'service-vehicle', 'freight-vehicle', 'incident']) {
    assert.equal(kinds.has(kind as never), true, `missing ${kind}`);
  }
  assert.equal(kinds.has('project'), false);
});

test('V7 projector emits strong lifecycle-safe relationships and weak historical relationships', () => {
  const projection = new LegacyV7EntityProjector().project(fixtureSource());
  const byRelation = new Map(projection.references.map((reference) => [reference.relation, reference]));
  assert.equal(byRelation.get('firm-building')?.semantics, 'strong');
  assert.equal(byRelation.get('transit-line-stop')?.semantics, 'strong');
  assert.equal(byRelation.get('service-vehicle-facility')?.semantics, 'strong');
  assert.equal(byRelation.get('traffic-origin-building')?.semantics, 'weak');
  assert.equal(byRelation.get('traffic-destination-building')?.semantics, 'weak');
  assert.equal(byRelation.get('freight-origin-firm')?.semantics, 'weak');
  assert.equal(byRelation.get('incident-building')?.semantics, 'weak');
});

test('V7 projector marks pre-replacement building references unresolved instead of retargeting them', () => {
  const source = fixtureSource();
  source.buildings.list = () => [{ id: 'building:lot:1,1', lotId: 'lot:1,1', x: 1, y: 1, zone: 'commercial', definitionId: 'commercial-low', status: 'occupied', constructionStartedTick: 50, completionTick: 60 }];
  const projection = new LegacyV7EntityProjector().project(source);
  assert.equal(projection.references.some((reference) => reference.relation === 'traffic-origin-building'), false);
  assert.equal(projection.references.some((reference) => reference.relation === 'incident-building'), false);
  assert.ok(projection.unresolved.some((reference) => reference.relation === 'traffic-origin-building'));
  assert.ok(projection.unresolved.some((reference) => reference.relation === 'incident-building'));
});

test('V7 projection ordering is deterministic even when every source list is reversed', () => {
  const projector = new LegacyV7EntityProjector();
  const a = fixtureSource();
  const b = fixtureSource();
  const reverse = <T>(items: T[]) => [...items].reverse();
  b.lots.list = () => reverse(a.lots.list());
  b.buildings.list = () => reverse(a.buildings.list());
  b.economyDomain.firms.list = () => reverse(a.economyDomain.firms.list());
  b.economyDomain.freightVehicles.listVehicles = () => reverse(a.economyDomain.freightVehicles.listVehicles());
  b.utilities.listFacilities = () => reverse(a.utilities.listFacilities());
  b.services.listFacilities = () => reverse(a.services.listFacilities());
  b.transit.listStops = () => reverse(a.transit.listStops());
  b.transit.listLines = () => reverse(a.transit.listLines());
  b.traffic.activeVehicles = reverse(a.traffic.activeVehicles);
  b.serviceVehicles.listVehicles = () => reverse(a.serviceVehicles.listVehicles());
  b.incidents.listIncidents = () => reverse(a.incidents.listIncidents());
  assert.deepEqual(projector.project(a), projector.project(b));
});

test('a transient revision rebuild does not re-list unchanged durable projection sources', () => {
  const source = fixtureSource();
  Object.assign(source.lots, { entityRevision: 1 });
  Object.assign(source.buildings, { entityRevision: 1 });
  Object.assign(source.economyDomain.firms, { entityRevision: 1 });
  Object.assign(source.economyDomain.freightVehicles, { entityRevision: 1 });
  Object.assign(source.utilities, { entityRevision: 1 });
  Object.assign(source.services, { entityRevision: 1 });
  Object.assign(source.transit, { revision: 1 });
  Object.assign(source.traffic, { entityRevision: 1 });
  Object.assign(source.serviceVehicles, { entityRevision: 1 });
  Object.assign(source.incidents, { entityRevision: 1 });

  let lotLists = 0;
  let buildingLists = 0;
  const originalLots = source.lots.list;
  const originalBuildings = source.buildings.list;
  source.lots.list = () => { lotLists++; return originalLots(); };
  source.buildings.list = () => { buildingLists++; return originalBuildings(); };

  const projector = new LegacyV7EntityProjector();
  projector.project(source);
  Object.assign(source.traffic, { entityRevision: 2 });
  source.traffic.activeVehicles = [
    ...source.traffic.activeVehicles,
    { ...source.traffic.activeVehicles[0]!, id: 'vehicle:2', tripId: 'trip:2', departureTick: 31 },
  ];
  projector.project(source);

  assert.equal(lotLists, 1, 'traffic churn must not force durable lot reprojection');
  assert.equal(buildingLists, 1, 'traffic churn must not force durable building reprojection');
});
