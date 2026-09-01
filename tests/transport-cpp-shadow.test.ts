import test from 'node:test';
import {
  assertNetworkParity,
  compareRoute,
  native,
  nativePath,
  type ShadowRoadCell,
} from './support/transportCppShadowHarness.ts';

const fixtures = [
  {
    name: 'dead-end', revision: 101,
    cells: [{ x: 1, y: 1, type: 'local' }, { x: 2, y: 1, type: 'local' }, { x: 3, y: 1, type: 'local' }] as const,
    start: 'j:legacy:1,1', end: 'j:legacy:3,1',
  },
  {
    name: 'four-way', revision: 102,
    cells: [
      { x: 3, y: 2, type: 'collector' }, { x: 2, y: 3, type: 'local' }, { x: 3, y: 3, type: 'arterial' },
      { x: 4, y: 3, type: 'collector' }, { x: 3, y: 4, type: 'local' },
    ] as const,
    start: 'j:legacy:2,3', end: 'j:legacy:4,3',
  },
  {
    name: 'mixed-class', revision: 103,
    cells: [{ x: 1, y: 6, type: 'local' }, { x: 2, y: 6, type: 'collector' }, { x: 3, y: 6, type: 'arterial' }] as const,
    start: 'j:legacy:1,6', end: 'j:legacy:3,6',
  },
] satisfies readonly { name: string; revision: number; cells: readonly ShadowRoadCell[]; start: string; end: string }[];

test('C++ transportation shadow matches accepted TypeScript network and routing fixtures', { skip: !nativePath }, () => {
  const handle = native.create();
  try {
    for (const fixture of fixtures) {
      assertNetworkParity(handle, fixture.name, fixture.cells, fixture.revision);
      compareRoute(handle, fixture.name, fixture.cells, fixture.revision, fixture.start, fixture.end);
      compareRoute(handle, `${fixture.name}.same-node`, fixture.cells, fixture.revision, fixture.start, fixture.start);
    }

    const disconnected = [
      { x: 1, y: 9, type: 'local' }, { x: 2, y: 9, type: 'local' },
      { x: 7, y: 9, type: 'local' }, { x: 8, y: 9, type: 'local' },
    ] satisfies readonly ShadowRoadCell[];
    assertNetworkParity(handle, 'disconnected', disconnected, 104);
    compareRoute(handle, 'disconnected', disconnected, 104, 'j:legacy:1,9', 'j:legacy:8,9');

    const before = [{ x: 5, y: 7, type: 'local' }, { x: 6, y: 7, type: 'local' }, { x: 7, y: 7, type: 'local' }] satisfies readonly ShadowRoadCell[];
    const after = [{ x: 5, y: 7, type: 'local' }, { x: 7, y: 7, type: 'local' }] satisfies readonly ShadowRoadCell[];
    compareRoute(handle, 'road-edit.before', before, 105, 'j:legacy:5,7', 'j:legacy:7,7');
    compareRoute(handle, 'road-edit.after', after, 106, 'j:legacy:5,7', 'j:legacy:7,7');
  } finally {
    native.destroy(handle);
  }
});
