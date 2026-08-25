import { D8_CLOCKWISE, HYDROLOGY_EPSILON } from './HydrologyTypes.ts';
const SQRT2 = Math.SQRT2;

function validateInputs(width:number, height:number, elevation:Float64Array, water:Uint8Array): void {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) throw new Error('invalid drainage dimensions');
  if (elevation.length !== width * height || water.length !== width * height) throw new Error('drainage field length mismatch');
  for (const value of elevation) if (!Number.isFinite(value)) throw new Error('conditioned elevation must be finite');
}
function isBoundary(index:number, width:number, height:number): boolean {
  const x = index % width; const y = Math.floor(index / width);
  return x === 0 || y === 0 || x === width - 1 || y === height - 1;
}
function neighbors(index:number,width:number,height:number): Array<readonly [number,number]> {
  const x=index%width; const y=Math.floor(index/width);
  const output:Array<readonly [number,number]>=[];
  for (let order=0; order<D8_CLOCKWISE.length; order++) {
    const [dx,dy]=D8_CLOCKWISE[order]!; const nx=x+dx; const ny=y+dy;
    if (nx<0||ny<0||nx>=width||ny>=height) continue;
    output.push([ny*width+nx, order]);
  }
  return output;
}

export class DrainageGraph {
  readonly width:number;
  readonly height:number;
  private readonly receiver: readonly (number|null)[];
  private readonly outlets: readonly number[];
  private readonly order: readonly number[];

  private constructor(width:number, height:number, receiver:readonly (number|null)[], outlets:readonly number[], order:readonly number[]) {
    this.width=width; this.height=height; this.receiver=receiver; this.outlets=outlets; this.order=order;
  }

  static build(width:number,height:number,conditionedElevation:Float64Array,permanentWater:Uint8Array): DrainageGraph {
    validateInputs(width,height,conditionedElevation,permanentWater);
    const count=width*height;
    const receiver:Array<number|null>=Array.from({length:count},()=>null);
    const explicitOutlet=new Uint8Array(count);
    const lowerReceiver=new Int32Array(count); lowerReceiver.fill(-1);
    const rank=new Int32Array(count); rank.fill(-1);
    const queue:number[]=[];

    for (let index=0; index<count; index++) {
      if (isBoundary(index,width,height) || permanentWater[index]!==0) {
        explicitOutlet[index]=1;
        rank[index]=0;
        queue.push(index);
        continue;
      }
      let best=-1; let bestGradient=-Infinity;
      for (const [neighbor, d8Order] of neighbors(index,width,height)) {
        const drop=conditionedElevation[index]!-conditionedElevation[neighbor]!;
        if (drop <= HYDROLOGY_EPSILON) continue;
        const diagonal = d8Order % 2 === 1;
        const gradient=drop/(diagonal?SQRT2:1);
        if (gradient > bestGradient + HYDROLOGY_EPSILON) { bestGradient=gradient; best=neighbor; }
      }
      if (best>=0) {
        lowerReceiver[index]=best;
        receiver[index]=best;
        rank[index]=0;
        queue.push(index);
      }
    }

    queue.sort((a,b)=>a-b);
    let head=0;
    while (head<queue.length) {
      const current=queue[head++]!;
      const currentElevation=conditionedElevation[current]!;
      for (const [neighbor] of neighbors(current,width,height)) {
        if (rank[neighbor]!==-1) continue;
        if (Math.abs(conditionedElevation[neighbor]!-currentElevation)>HYDROLOGY_EPSILON) continue;
        rank[neighbor]=rank[current]!+1;
        queue.push(neighbor);
      }
    }

    for (let index=0; index<count; index++) {
      if (explicitOutlet[index]! !== 0 || lowerReceiver[index]! >= 0) continue;
      const currentRank=rank[index]!;
      let chosen=-1;
      if (currentRank>0) {
        for (const [neighbor] of neighbors(index,width,height)) {
          if (Math.abs(conditionedElevation[neighbor]!-conditionedElevation[index]!)>HYDROLOGY_EPSILON) continue;
          if (rank[neighbor]===currentRank-1) { chosen=neighbor; break; }
        }
      }
      if (chosen<0) throw new Error(`conditioned terrain contains undrained flat at ${index}`);
      receiver[index]=chosen;
    }

    const indegree=new Int32Array(count);
    for (let index=0; index<count; index++) {
      const target=receiver[index] ?? null;
      if (target!==null) indegree[target] = indegree[target]! + 1;
    }
    const zero:number[]=[];
    for (let index=0; index<count; index++) if (indegree[index]===0) zero.push(index);
    zero.sort((a,b)=>a-b);
    const order:number[]=[];
    while (zero.length>0) {
      const current=zero.shift()!;
      order.push(current);
      const target=receiver[current] ?? null;
      if (target!==null) {
        indegree[target] = indegree[target]! - 1;
        if (indegree[target] === 0) {
          const position=zero.findIndex((value)=>value>target);
          if (position<0) zero.push(target); else zero.splice(position,0,target);
        }
      }
    }
    if (order.length!==count) throw new Error('drainage receiver cycle');
    const outlets:number[]=[];
    for (let index=0; index<count; index++) if (receiver[index]===null) outlets.push(index);
    return new DrainageGraph(width,height,Object.freeze(receiver.slice()),Object.freeze(outlets),Object.freeze(order));
  }

  receiverIndex(index:number): number|null {
    if (!Number.isInteger(index) || index<0 || index>=this.receiver.length) throw new Error('drainage index out of bounds');
    return this.receiver[index]!;
  }
  listOutlets(): readonly number[] { return Object.freeze(this.outlets.slice()); }
  topologicalOrder(): readonly number[] { return Object.freeze(this.order.slice()); }
  snapshotReceivers(): readonly (number|null)[] { return Object.freeze(this.receiver.slice()); }
}
