import type { GeographyEntity, GeographyKind } from '../geography/GeographyTypes.ts';
import type { ChannelSegment } from '../hydrology/HydrologyTypes.ts';
import type { BoundingBox2, Point2, Polygon2 } from './GeometryTypes.ts';
import { pointInPolygon } from './PolygonMath.ts';

export type IndexedPoint = Readonly<{ id:string; point:Point2; category:string }>;
const DEPTH:Readonly<Record<GeographyKind,number>>=Object.freeze({region:0,municipality:1,district:2,neighborhood:3,block:4});
function validBounds(bounds:BoundingBox2):boolean{return [bounds.minX,bounds.minY,bounds.maxX,bounds.maxY].every(Number.isFinite)&&bounds.maxX>bounds.minX&&bounds.maxY>bounds.minY;}
function polygonBounds(polygon:Polygon2):BoundingBox2{let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const point of polygon.points){minX=Math.min(minX,point.x);minY=Math.min(minY,point.y);maxX=Math.max(maxX,point.x);maxY=Math.max(maxY,point.y);}return{minX,minY,maxX,maxY};}
function inBounds(point:Point2,bounds:BoundingBox2):boolean{return point.x>=bounds.minX&&point.x<=bounds.maxX&&point.y>=bounds.minY&&point.y<=bounds.maxY;}
function cross(a:Point2,b:Point2,c:Point2):number{return(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);}
function segmentsIntersect(a:Point2,b:Point2,c:Point2,d:Point2):boolean{const o1=cross(a,b,c),o2=cross(a,b,d),o3=cross(c,d,a),o4=cross(c,d,b);return((o1>=0&&o2<=0)||(o1<=0&&o2>=0))&&((o3>=0&&o4<=0)||(o3<=0&&o4>=0));}
function polygonIntersectsBounds(polygon:Polygon2,bounds:BoundingBox2):boolean{const pb=polygonBounds(polygon);if(pb.maxX<bounds.minX||pb.minX>bounds.maxX||pb.maxY<bounds.minY||pb.minY>bounds.maxY)return false;if(polygon.points.some((point)=>inBounds(point,bounds)))return true;const corners=[{x:bounds.minX,y:bounds.minY},{x:bounds.maxX,y:bounds.minY},{x:bounds.maxX,y:bounds.maxY},{x:bounds.minX,y:bounds.maxY}];if(corners.some((corner)=>pointInPolygon(corner,polygon,true)))return true;for(let i=0;i<polygon.points.length;i++){const a=polygon.points[i]!,b=polygon.points[(i+1)%polygon.points.length]!;for(let j=0;j<4;j++)if(segmentsIntersect(a,b,corners[j]!,corners[(j+1)%4]!))return true;}return false;}
function distance(a:Point2,b:Point2):number{return Math.hypot(a.x-b.x,a.y-b.y);}
function pointSegmentDistance(point:Point2,a:Point2,b:Point2):number{const dx=b.x-a.x,dy=b.y-a.y;const lengthSquared=dx*dx+dy*dy;if(lengthSquared===0)return distance(point,a);const t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/lengthSquared));return distance(point,{x:a.x+t*dx,y:a.y+t*dy});}
function entitySort(a:GeographyEntity,b:GeographyEntity):number{return DEPTH[b.kind]-DEPTH[a.kind]||a.id.localeCompare(b.id);}

export class GeometryIndex {
  private readonly worldBounds:BoundingBox2;
  private bucketSize=4;
  private readonly entityById=new Map<string,GeographyEntity>();
  private readonly entityBuckets=new Map<string,string[]>();
  private points:readonly IndexedPoint[]=[];
  private channels:readonly ChannelSegment[]=[];
  private readonly gridWidth:number;
  private readonly gridHeight:number;

  constructor(worldBounds:BoundingBox2){if(!validBounds(worldBounds))throw new Error('invalid geometry index bounds');this.worldBounds=Object.freeze({...worldBounds});this.gridWidth=Math.max(1,Math.round(worldBounds.maxX-worldBounds.minX));this.gridHeight=Math.max(1,Math.round(worldBounds.maxY-worldBounds.minY));}
  private bucketKey(x:number,y:number):string{return`${x},${y}`;}
  private bucketX(x:number):number{return Math.floor((x-this.worldBounds.minX)/this.bucketSize);}
  private bucketY(y:number):number{return Math.floor((y-this.worldBounds.minY)/this.bucketSize);}
  private candidateIds(bounds:BoundingBox2):Set<string>{const ids=new Set<string>();for(let by=this.bucketY(bounds.minY);by<=this.bucketY(bounds.maxY);by++)for(let bx=this.bucketX(bounds.minX);bx<=this.bucketX(bounds.maxX);bx++)for(const id of this.entityBuckets.get(this.bucketKey(bx,by))??[])ids.add(id);return ids;}

  rebuild(entities:readonly GeographyEntity[],channels:readonly ChannelSegment[],points:readonly IndexedPoint[]=[]):void{
    this.entityById.clear();this.entityBuckets.clear();
    const area=(this.worldBounds.maxX-this.worldBounds.minX)*(this.worldBounds.maxY-this.worldBounds.minY);
    this.bucketSize=Math.max(4,Math.sqrt(area/Math.max(1,entities.length)));
    for(const entity of [...entities].sort((a,b)=>a.id.localeCompare(b.id))){
      if(this.entityById.has(entity.id))throw new Error(`duplicate indexed entity: ${entity.id}`);
      this.entityById.set(entity.id,entity);
      const bounds=polygonBounds(entity.boundary);
      for(let by=this.bucketY(bounds.minY);by<=this.bucketY(bounds.maxY);by++)for(let bx=this.bucketX(bounds.minX);bx<=this.bucketX(bounds.maxX);bx++){
        const key=this.bucketKey(bx,by);const ids=this.entityBuckets.get(key)??[];ids.push(entity.id);ids.sort();this.entityBuckets.set(key,ids);
      }
    }
    this.points=Object.freeze([...points].map((point)=>Object.freeze({id:point.id,point:Object.freeze({...point.point}),category:point.category})).sort((a,b)=>a.id.localeCompare(b.id)));
    this.channels=Object.freeze([...channels].map((channel)=>Object.freeze({...channel})).sort((a,b)=>a.id.localeCompare(b.id)));
  }
  entitiesAt(point:Point2,kind?:GeographyKind):readonly GeographyEntity[]{const ids=this.entityBuckets.get(this.bucketKey(this.bucketX(point.x),this.bucketY(point.y)))??[];return Object.freeze(ids.map((id)=>this.entityById.get(id)!).filter((entity)=>(kind===undefined||entity.kind===kind)&&pointInPolygon(point,entity.boundary,true)).sort(entitySort));}
  queryBounds(bounds:BoundingBox2,kind?:GeographyKind):readonly GeographyEntity[]{if(!validBounds(bounds))throw new Error('invalid geometry query bounds');return Object.freeze([...this.candidateIds(bounds)].map((id)=>this.entityById.get(id)!).filter((entity)=>(kind===undefined||entity.kind===kind)&&polygonIntersectsBounds(entity.boundary,bounds)).sort(entitySort));}
  nearbyPoints(point:Point2,radius:number,category?:string):readonly IndexedPoint[]{if(!Number.isFinite(radius)||radius<0)throw new Error('radius must be non-negative');return Object.freeze(this.points.map((item)=>({item,distance:distance(point,item.point)})).filter((entry)=>entry.distance<=radius&&(category===undefined||entry.item.category===category)).sort((a,b)=>a.distance-b.distance||a.item.id.localeCompare(b.item.id)).map((entry)=>entry.item));}
  channelIdsNear(point:Point2,radius:number):readonly string[]{if(!Number.isFinite(radius)||radius<0)throw new Error('radius must be non-negative');const cellPoint=(index:number):Point2=>{if(!Number.isInteger(index)||index<0||index>=this.gridWidth*this.gridHeight)throw new Error('channel index outside geometry bounds');return{x:this.worldBounds.minX+(index%this.gridWidth)+0.5,y:this.worldBounds.minY+Math.floor(index/this.gridWidth)+0.5};};return Object.freeze(this.channels.map((channel)=>({id:channel.id,distance:pointSegmentDistance(point,cellPoint(channel.fromIndex),cellPoint(channel.toIndex))})).filter((entry)=>entry.distance<=radius).sort((a,b)=>a.distance-b.distance||a.id.localeCompare(b.id)).map((entry)=>entry.id));}
}
