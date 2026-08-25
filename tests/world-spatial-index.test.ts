import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePolygon, pointInPolygon } from '../src/world/geometry/PolygonMath.ts';
import { GeometryIndex } from '../src/world/geometry/GeometryIndex.ts';
import type { GeographyEntity } from '../src/world/geography/GeographyTypes.ts';
import type { ChannelSegment } from '../src/world/hydrology/HydrologyTypes.ts';

const poly=(x0:number,y0:number,x1:number,y1:number)=>normalizePolygon([{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}]);
const entities:GeographyEntity[]=[
  {id:'region:0',kind:'region',parentId:null,boundary:poly(0,0,20,12),sortKey:'0'},
  {id:'district:0',kind:'district',parentId:'region:0',boundary:poly(2,2,18,10),sortKey:'1'},
  {id:'block:a',kind:'block',parentId:'district:0',boundary:poly(4,4,10,8),sortKey:'2a'},
  {id:'block:b',kind:'block',parentId:'district:0',boundary:poly(10,4,16,8),sortKey:'2b'},
];
const channels:ChannelSegment[]=[{id:'channel:000021',fromIndex:21,toIndex:22,accumulation:20,capacityVolumeM3:50}];
const DEPTH={region:0,municipality:1,district:2,neighborhood:3,block:4} as const;
const points=[
  {id:'p:c',point:{x:7,y:6},category:'facility'},
  {id:'p:a',point:{x:6,y:6},category:'facility'},
  {id:'p:b',point:{x:6,y:7},category:'shop'},
  {id:'p:d',point:{x:15,y:6},category:'facility'},
];

function build(order=entities):GeometryIndex{const index=new GeometryIndex({minX:0,minY:0,maxX:20,maxY:12});index.rebuild(order,channels,points);return index;}

test('entitiesAt matches exact polygon containment and resolves deepest kind then id on boundaries',()=>{
  const index=build(); const query={x:10,y:6};
  const actual=index.entitiesAt(query).map(e=>e.id);
  const direct=entities.filter(e=>pointInPolygon(query,e.boundary,true)).sort((a,b)=>DEPTH[b.kind]-DEPTH[a.kind]||a.id.localeCompare(b.id)).map(e=>e.id);
  assert.deepEqual(actual,direct);
  assert.deepEqual(actual.slice(0,2),['block:a','block:b']);
});

test('nearby points sort by distance then id and support category filtering',()=>{
  const index=build();
  assert.deepEqual(index.nearbyPoints({x:6,y:6},2).map(p=>p.id),['p:a','p:b','p:c']);
  assert.deepEqual(index.nearbyPoints({x:6,y:6},2,'facility').map(p=>p.id),['p:a','p:c']);
});

test('query ordering and results are invariant to rebuild input order',()=>{
  const a=build(); const b=build([...entities].reverse());
  assert.deepEqual(a.queryBounds({minX:3,minY:3,maxX:11,maxY:9}).map(e=>e.id),b.queryBounds({minX:3,minY:3,maxX:11,maxY:9}).map(e=>e.id));
  assert.deepEqual(a.entitiesAt({x:5,y:5}).map(e=>e.id),b.entitiesAt({x:5,y:5}).map(e=>e.id));
});

test('channelIdsNear spatializes drainage indices using world grid width',()=>{
  const index=build();
  assert.deepEqual(index.channelIdsNear({x:1.5,y:1.5},1),['channel:000021']);
  assert.deepEqual(index.channelIdsNear({x:10,y:10},1),[]);
});
