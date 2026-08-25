import test from 'node:test';
import assert from 'node:assert/strict';
import { SeededRandom } from '../src/simulation/core/SeededRandom.ts';
import { normalizePolygon } from '../src/world/geometry/PolygonMath.ts';
import { GeographyHierarchy } from '../src/world/geography/GeographyHierarchy.ts';
import { generateAdministrativeHierarchy } from '../src/world/geography/AdministrativeBoundaryGenerator.ts';
import type { GeographyEntity } from '../src/world/geography/GeographyTypes.ts';

const poly = (x0:number,y0:number,x1:number,y1:number) => normalizePolygon([{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}]);
const root = normalizePolygon([{x:0,y:0},{x:20,y:0},{x:20,y:12},{x:0,y:12}]);

function validEntities(): GeographyEntity[] {
  return [
    { id:'region:0', kind:'region', parentId:null, boundary:root, sortKey:'000' },
    { id:'municipality:region:0:000', kind:'municipality', parentId:'region:0', boundary:root, sortKey:'000' },
    { id:'district:municipality:region:0:000:000', kind:'district', parentId:'municipality:region:0:000', boundary:poly(0,0,20,12), sortKey:'000' },
    { id:'neighborhood:district:municipality:region:0:000:000:000', kind:'neighborhood', parentId:'district:municipality:region:0:000:000', boundary:poly(0,0,20,12), sortKey:'000' },
    { id:'block:neighborhood:district:municipality:region:0:000:000:000:000', kind:'block', parentId:'neighborhood:district:municipality:region:0:000:000:000', boundary:poly(0,0,10,12), sortKey:'000' },
    { id:'block:neighborhood:district:municipality:region:0:000:000:000:001', kind:'block', parentId:'neighborhood:district:municipality:region:0:000:000:000', boundary:poly(10,0,20,12), sortKey:'001' },
  ];
}

test('hierarchy validates parent chain and resolves deepest entity', () => {
  const hierarchy = new GeographyHierarchy(validEntities());
  assert.equal(hierarchy.list('region').length, 1);
  assert.equal(hierarchy.childrenOf('region:0')[0]?.kind, 'municipality');
  assert.equal(hierarchy.parentOf('municipality:region:0:000')?.id, 'region:0');
  assert.equal(hierarchy.entityAt({x:3,y:3})?.kind, 'block');
  assert.equal(hierarchy.entityAt({x:3,y:3}, 'district')?.kind, 'district');
  assert.deepEqual(GeographyHierarchy.restore(hierarchy.snapshot()).snapshot(), hierarchy.snapshot());
});

test('hierarchy rejects multiple roots, orphans, wrong parent kinds, and sibling overlap', () => {
  assert.throws(() => new GeographyHierarchy([...validEntities(), { id:'region:1', kind:'region', parentId:null, boundary:poly(30,0,40,10), sortKey:'001' }]), /one region root/);
  const orphan = validEntities(); orphan[1] = { ...orphan[1]!, parentId:'missing' };
  assert.throws(() => new GeographyHierarchy(orphan), /orphan/);
  const wrong = validEntities(); wrong[2] = { ...wrong[2]!, parentId:'region:0' };
  assert.throws(() => new GeographyHierarchy(wrong), /parent kind/);
  const overlap = validEntities(); overlap[5] = { ...overlap[5]!, boundary:poly(9,0,20,12) };
  assert.throws(() => new GeographyHierarchy(overlap), /sibling overlap/);
});

test('hierarchy rejects cycles and children outside parents', () => {
  const cycle = validEntities();
  cycle[1] = { ...cycle[1]!, parentId: cycle[2]!.id };
  cycle[2] = { ...cycle[2]!, parentId: cycle[1]!.id };
  assert.throws(() => new GeographyHierarchy(cycle), /parent kind|cycle/);
  const outside = validEntities(); outside[4] = { ...outside[4]!, boundary:poly(-1,0,10,12) };
  assert.throws(() => new GeographyHierarchy(outside), /outside parent/);
});

test('generated hierarchy is same-seed deterministic with stable ids and irregular boundaries', () => {
  const a = generateAdministrativeHierarchy(root, new SeededRandom(77));
  const b = generateAdministrativeHierarchy(root, new SeededRandom(77));
  assert.deepEqual(a, b);
  const hierarchy = new GeographyHierarchy(a);
  assert.equal(hierarchy.list('region').length, 1);
  assert.equal(hierarchy.list('municipality').length, 1);
  assert.ok(hierarchy.list('district').length >= 2 && hierarchy.list('district').length <= 4);
  assert.ok(hierarchy.list('neighborhood').length >= hierarchy.list('district').length * 2);
  assert.ok(hierarchy.list('block').length >= hierarchy.list('neighborhood').length * 2);
  assert.equal(new Set(a.map((entity) => entity.id)).size, a.length);
  assert.ok(a.filter((e) => e.kind === 'district' || e.kind === 'neighborhood' || e.kind === 'block')
    .some((e) => e.boundary.points.some((p) => !Number.isInteger(p.x) || !Number.isInteger(p.y))));
});
