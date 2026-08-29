import test from 'node:test';
import assert from 'node:assert/strict';
import type { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { buildTransitOverlayCommands } from '../src/rendering/gpu/GpuOverlayCommands.ts';

test('transit none mode emits no GPU overlay commands', () => {
  const stops = new Map([
    ['stop:a', { id: 'stop:a', x: 1, y: 1, type: 'surface_stop' }],
    ['stop:b', { id: 'stop:b', x: 4, y: 1, type: 'surface_stop' }],
  ]);
  const line = {
    id: 'line:bus',
    name: 'Bus',
    mode: 'bus',
    stopIds: ['stop:a', 'stop:b'],
  };
  const core = {
    clock: { tick: 100 },
    transit: {
      listLines: () => [line],
      listStops: () => [...stops.values()],
      getStop: (id: string) => stops.get(id),
    },
    mobility: {
      passengers: { snapshot: () => ({ queues: [] }) },
      vehicles: { listVehicles: () => [] },
      operations: {
        snapshotLineWithVehicles: () => ({ completedPassengerWeight: 0, reliability: 1 }),
      },
    },
    mobilitySnapshot: {
      transitModeShare: 0,
      personAccessibility: 0,
      meanWaitTicks: 0,
    },
  } as unknown as SimulationCore;

  assert.deepEqual(buildTransitOverlayCommands(core, 'none'), []);
});
