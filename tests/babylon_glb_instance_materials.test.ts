import assert from 'node:assert/strict';
import test from 'node:test';
import { BabylonGlbPrototype } from '../src/rendering/3d/assets/BabylonGlbPrototypeLoader.ts';

function fakeEntries() {
  return Object.freeze({
    rootNodes: Object.freeze([]),
    skeletons: Object.freeze([]),
    animationGroups: Object.freeze([]),
    dispose: () => {},
  });
}

test('Babylon GLB prototype can clone materials for stateful per-building presentation instances', () => {
  let receivedCloneMaterials: boolean | undefined;
  const container = Object.freeze({
    instantiateModelsToScene: (
      _nameFunction?: (sourceName: string) => string,
      cloneMaterials?: boolean,
    ) => {
      receivedCloneMaterials = cloneMaterials;
      return fakeEntries();
    },
    dispose: () => {},
  });
  const prototype = new BabylonGlbPrototype('cf_house@lod0', container as never);

  const instance = prototype.instantiate('building:b1', { cloneMaterials: true });

  assert.equal(receivedCloneMaterials, true);
  instance.dispose();
  prototype.dispose();
});

test('Babylon GLB prototype keeps shared-material instantiation as the default', () => {
  let receivedCloneMaterials: boolean | undefined;
  const container = Object.freeze({
    instantiateModelsToScene: (
      _nameFunction?: (sourceName: string) => string,
      cloneMaterials?: boolean,
    ) => {
      receivedCloneMaterials = cloneMaterials;
      return fakeEntries();
    },
    dispose: () => {},
  });
  const prototype = new BabylonGlbPrototype('cf_house@lod0', container as never);

  const instance = prototype.instantiate('building:b1');

  assert.equal(receivedCloneMaterials, false);
  instance.dispose();
  prototype.dispose();
});
