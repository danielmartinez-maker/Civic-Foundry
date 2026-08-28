import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import type { SimulationCore } from '../src/simulation/core/SimulationCore.ts';

const commandsModuleUrl = new URL('../src/rendering/gpu/GpuOverlayCommands.ts', import.meta.url);

async function loadCommands(): Promise<any> {
  assert.ok(existsSync(commandsModuleUrl), 'GpuOverlayCommands must translate canonical overlay mappers before Phase 3 can render them');
  const module = await import(commandsModuleUrl.href);
  for (const name of [
    'buildTrafficOverlayCommands',
    'buildServiceOverlayCommands',
    'buildTransitOverlayCommands',
    'buildEconomyOverlayCommands',
    'buildCadastralOverlayCommands',
    'buildZoningEnvelopeCommands',
  ]) assert.equal(typeof module[name], 'function', `${name} must be exported`);
  return module;
}

const node = (id: string, x: number, y: number) => ({ id, x, y });
const edges = [
  { id: 'edge:slow', from: 'node:a', to: 'node:b', freeFlowSpeedCellsPerSecond: 2, freeFlowTicks: 10 },
  { id: 'edge:fast', from: 'node:b', to: 'node:c', freeFlowSpeedCellsPerSecond: 4, freeFlowTicks: 8 },
];
const nodes = new Map([
  ['node:a', node('node:a', 1, 2)],
  ['node:b', node('node:b', 4, 2)],
  ['node:c', node('node:c', 4, 6)],
]);
const graph = {
  edges,
  getEdge: (id: string) => edges.find((edge) => edge.id === id),
  getNode: (id: string) => nodes.get(id),
};

function trafficCore(): SimulationCore {
  return {
    transportationGraph: graph,
    traffic: {
      edgeMetrics: [
        { edgeId: 'edge:slow', congestion: 0.75, averageSpeedCellsPerSecond: 0.5, weightedVehicles: 10 },
        { edgeId: 'edge:fast', congestion: 0.10, averageSpeedCellsPerSecond: 3, weightedVehicles: 2 },
      ],
    },
    trafficSnapshot: { worstBottlenecks: ['edge:slow'] },
  } as unknown as SimulationCore;
}

function serviceCore(): SimulationCore {
  return {
    buildings: { occupied: () => [{ id: 'building:1', x: 2, y: 3 }] },
    neighborhoodSnapshot: {
      perBuilding: {
        'building:1': {
          combinedServiceQuality: 0.65,
          fireSafety: 0.4,
          policeSafety: 0.5,
          healthcareAccess: 0.6,
          educationAccess: 0.7,
          garbageCleanliness: 0.8,
        },
      },
    },
  } as unknown as SimulationCore;
}

function transitCore(): SimulationCore {
  const stops = new Map([
    ['bus:a', { id: 'bus:a', x: 1, y: 1, type: 'bus_stop' }],
    ['bus:b', { id: 'bus:b', x: 2, y: 1, type: 'bus_stop' }],
    ['brt:a', { id: 'brt:a', x: 1, y: 2, type: 'bus_stop' }],
    ['brt:b', { id: 'brt:b', x: 2, y: 2, type: 'bus_stop' }],
    ['tram:a', { id: 'tram:a', x: 1, y: 3, type: 'tram_stop' }],
    ['tram:b', { id: 'tram:b', x: 2, y: 3, type: 'tram_stop' }],
    ['metro:a', { id: 'metro:a', x: 1, y: 4, type: 'metro_station' }],
    ['metro:b', { id: 'metro:b', x: 2, y: 4, type: 'metro_station' }],
  ]);
  const lines = [
    { id: 'line:bus', name: 'Bus', mode: 'bus', stopIds: ['bus:a', 'bus:b'] },
    { id: 'line:brt', name: 'BRT', mode: 'brt', stopIds: ['brt:a', 'brt:b'] },
    { id: 'line:tram', name: 'Tram', mode: 'tram', stopIds: ['tram:a', 'tram:b'] },
    { id: 'line:metro', name: 'Metro', mode: 'metro', stopIds: ['metro:a', 'metro:b'] },
  ];
  return {
    clock: { tick: 100 },
    transit: {
      listLines: () => lines,
      listStops: () => [...stops.values()],
      getLine: (id: string) => lines.find((line) => line.id === id),
      getStop: (id: string) => stops.get(id),
    },
    mobility: {
      passengers: { snapshot: () => ({ queues: [] }) },
      vehicles: { listVehicles: () => [] },
      operations: {
        snapshotLineWithVehicles: () => ({ completedPassengerWeight: 0, reliability: 1 }),
      },
    },
    mobilitySnapshot: { transitModeShare: 0.25, personAccessibility: 0.75, meanWaitTicks: 0 },
  } as unknown as SimulationCore;
}

function economyCore(): SimulationCore {
  const vehicle = {
    id: 'freight:1',
    routeEdgeIds: ['edge:slow', 'edge:fast'],
    delayTicks: 3,
    shipment: {
      vehicleWeight: 2,
      quantity: 8,
      originKind: 'gateway',
      originId: 'gateway:west',
      destinationKind: 'firm',
      destinationId: 'firm:1',
    },
  };
  return {
    transportationGraph: graph,
    buildings: { getById: () => undefined },
    economyDomain: {
      firms: { list: () => [] },
      getFirmInventories: () => ({}),
      inventories: { shortageRatio: () => 0 },
      freightVehicles: { listVehicles: () => [vehicle] },
      trade: { listGateways: () => [{ id: 'gateway:west', x: 0, y: 2, importCapacity: 20, exportCapacity: 20 }] },
    },
  } as unknown as SimulationCore;
}

function cadastralCore(): SimulationCore {
  const cadastralNodes = new Map([
    ['n1', { id: 'n1', point: { x: 0, y: 0 } }],
    ['n2', { id: 'n2', point: { x: 100, y: 0 } }],
    ['n3', { id: 'n3', point: { x: 100, y: 100 } }],
    ['n4', { id: 'n4', point: { x: 0, y: 100 } }],
  ]);
  const cadastralEdges = new Map([
    ['frontage:1', { id: 'frontage:1', fromNodeId: 'n1', toNodeId: 'n2' }],
    ['access:1', { id: 'access:1', fromNodeId: 'n2', toNodeId: 'n3' }],
  ]);
  const ring = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  return {
    cadastre: {
      listBlocks: () => [{ id: 'block:1', boundary: ring }],
      listParcels: () => [{ id: 'parcel:1', blockId: 'block:1', frontageEdgeIds: ['frontage:1'], accessEdgeIds: ['access:1'] }],
      parcelPolygon: () => ring,
      getEdge: (id: string) => cadastralEdges.get(id),
      getNode: (id: string) => cadastralNodes.get(id),
      getParcel: (id: string) => id === 'parcel:1' ? { id, blockId: 'block:1', zoningDistrictId: 'residential' } : undefined,
    },
    zoning: { getParcelAssignment: () => undefined },
    buildableEnvelopes: {
      evaluate: () => ({
        buildableFootprint: [{ x: 20, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 80 }, { x: 20, y: 80 }],
        maxHeightMeters: 23.6,
        effectiveFAR: 2,
        effectiveCoverageRatio: 0.6,
        limitingConstraints: [],
      }),
    },
  } as unknown as SimulationCore;
}

const segments = (commands: readonly any[]) => commands.filter((command) => command.kind === 'segment');
const rings = (commands: readonly any[]) => commands.filter((command) => command.kind === 'ring');
const markers = (commands: readonly any[]) => commands.filter((command) => command.kind === 'marker');
const labels = (commands: readonly any[]) => commands.filter((command) => command.kind === 'label');

test('traffic commands preserve canonical edge geometry and normalization semantics', async () => {
  const { buildTrafficOverlayCommands } = await loadCommands();
  const core = trafficCore();

  const bottlenecks = segments(buildTrafficOverlayCommands(core, 'bottlenecks'));
  assert.deepEqual(bottlenecks.map((command) => command.key), ['traffic:bottlenecks:edge:slow']);
  assert.deepEqual(bottlenecks[0]?.from, { x: 1, y: 2 });
  assert.deepEqual(bottlenecks[0]?.to, { x: 4, y: 2 });
  assert.equal(bottlenecks[0]?.color, '#ff5b5b');

  const congestion = segments(buildTrafficOverlayCommands(core, 'congestion'));
  assert.equal(congestion.find((command) => command.key.endsWith('edge:slow'))?.color, 'hsla(30,85%,58%,.82)');

  const speed = segments(buildTrafficOverlayCommands(core, 'speed'));
  assert.equal(speed.find((command) => command.key.endsWith('edge:slow'))?.color, 'hsla(15,85%,58%,.82)');
  assert.equal(speed.find((command) => command.key.endsWith('edge:fast'))?.color, 'hsla(90,85%,58%,.82)');

  const volume = segments(buildTrafficOverlayCommands(core, 'volume'));
  assert.equal(volume.find((command) => command.key.endsWith('edge:slow'))?.color, 'hsla(0,85%,58%,.82)');
  assert.equal(volume.find((command) => command.key.endsWith('edge:fast'))?.color, 'hsla(96,85%,58%,.82)');
});

test('service commands preserve mapper labels and heat-cell semantics', async () => {
  const { buildServiceOverlayCommands } = await loadCommands();
  const commands = buildServiceOverlayCommands(serviceCore(), 'fire');
  const cell = commands.find((command: any) => command.kind === 'cell');
  const label = commands.find((command: any) => command.kind === 'label');
  assert.deepEqual(cell, {
    kind: 'cell', key: 'service:fire:building:1', x: 2, y: 3,
    fill: 'hsl(48,82%,52%)', alpha: 0.42, label: '40%',
  });
  assert.equal(label?.text, '40%');
  assert.equal(label?.minTileWidth, 40);
});

test('transit commands preserve mode colors, dashes, and stop marker identity', async () => {
  const { buildTransitOverlayCommands } = await loadCommands();
  const commands = buildTransitOverlayCommands(transitCore(), 'routes');
  const routeSegments = segments(commands);
  const byLine = new Map(routeSegments.map((command) => [command.key.split(':segment:')[0], command]));
  assert.equal(byLine.get('transit:line:bus')?.color, '#68a8ff');
  assert.deepEqual(byLine.get('transit:line:bus')?.dash ?? [], []);
  assert.equal(byLine.get('transit:line:brt')?.color, '#59d8c4');
  assert.deepEqual(byLine.get('transit:line:brt')?.dash, [9, 4]);
  assert.equal(byLine.get('transit:line:tram')?.color, '#ffb65f');
  assert.deepEqual(byLine.get('transit:line:tram')?.dash, [3, 4]);
  assert.equal(byLine.get('transit:line:metro')?.color, '#bb8cff');
  assert.deepEqual(byLine.get('transit:line:metro')?.dash, [12, 4, 3, 4]);
  assert.ok(markers(commands).some((command) => command.marker === 'stop'));
  assert.ok(markers(commands).some((command) => command.marker === 'metro-station'));
});

test('economy commands preserve freight dash and gateway diamond semantics', async () => {
  const { buildEconomyOverlayCommands } = await loadCommands();
  const freight = buildEconomyOverlayCommands(economyCore(), 'freight-routes');
  assert.ok(segments(freight).length >= 2);
  assert.ok(segments(freight).every((command) => JSON.stringify(command.dash) === JSON.stringify([7, 4])));
  assert.ok(segments(freight).every((command) => command.color === '#d9a64a'));

  const gateways = buildEconomyOverlayCommands(economyCore(), 'gateways');
  assert.deepEqual(markers(gateways).map((command) => command.marker), ['gateway']);
});

test('cadastre commands keep block, parcel, frontage, and access styles distinct', async () => {
  const { buildCadastralOverlayCommands } = await loadCommands();
  const commands = buildCadastralOverlayCommands(cadastralCore(), 'parcel:1');
  assert.ok(rings(commands).some((command) => command.key === 'cadastre:block:block:1' && command.stroke === '#7d8990' && command.strokeWidth === 1.2));
  assert.ok(rings(commands).some((command) => command.key === 'cadastre:parcel:parcel:1' && command.stroke === '#ffffff' && command.strokeWidth === 1.6));
  assert.ok(segments(commands).some((command) => command.key === 'cadastre:frontage:parcel:1:frontage:1' && command.color === '#59d8c4' && command.widthFactor === 3));
  assert.ok(segments(commands).some((command) => command.key === 'cadastre:access:parcel:1:access:1' && command.color === '#f1c36e' && command.widthFactor === 2 && JSON.stringify(command.dash) === JSON.stringify([5, 3])));
});

test('zoning envelope commands preserve parcel/buildable rings and rounded height label', async () => {
  const { buildZoningEnvelopeCommands } = await loadCommands();
  const commands = buildZoningEnvelopeCommands(cadastralCore(), 'parcel:1');
  assert.ok(rings(commands).some((command) => command.key === 'zoning-envelope:parcel:parcel:1' && command.fill === '#df5c5c' && command.fillAlpha === 0.22 && command.stroke === '#f08b8b'));
  assert.ok(rings(commands).some((command) => command.key === 'zoning-envelope:buildable:parcel:1' && command.fill === '#59d8c4' && command.fillAlpha === 0.32 && command.stroke === '#59d8c4'));
  assert.ok(labels(commands).some((command) => command.text === '24m'));
});
