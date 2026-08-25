import { D8_CLOCKWISE } from './HydrologyTypes.ts';

type HeapEntry = Readonly<{ elevation: number; index: number }>;

function validateInputs(width:number, height:number, elevation:Float64Array, water:Uint8Array): void {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) throw new Error('invalid hydrology dimensions');
  if (elevation.length !== width * height || water.length !== width * height) throw new Error('hydrology field length mismatch');
  for (const value of elevation) if (!Number.isFinite(value)) throw new Error('elevation must be finite');
}

function less(a:HeapEntry, b:HeapEntry): boolean {
  return a.elevation < b.elevation || (a.elevation === b.elevation && a.index < b.index);
}

class MinHeap {
  private readonly items: HeapEntry[] = [];
  push(entry:HeapEntry): void {
    this.items.push(entry);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!less(this.items[index]!, this.items[parent]!)) break;
      [this.items[index], this.items[parent]] = [this.items[parent]!, this.items[index]!];
      index = parent;
    }
  }
  pop(): HeapEntry | undefined {
    if (this.items.length === 0) return undefined;
    const root = this.items[0]!;
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < this.items.length && less(this.items[left]!, this.items[smallest]!)) smallest = left;
        if (right < this.items.length && less(this.items[right]!, this.items[smallest]!)) smallest = right;
        if (smallest === index) break;
        [this.items[index], this.items[smallest]] = [this.items[smallest]!, this.items[index]!];
        index = smallest;
      }
    }
    return root;
  }
}

export function resolveDepressions(width:number, height:number, rawElevation:Float64Array, permanentWater:Uint8Array): Float64Array {
  validateInputs(width, height, rawElevation, permanentWater);
  const conditioned = new Float64Array(rawElevation);
  const visited = new Uint8Array(rawElevation.length);
  const heap = new MinHeap();
  const seed = (index:number): void => {
    if (visited[index]) return;
    visited[index] = 1;
    heap.push({ elevation: conditioned[index]!, index });
  };
  for (let y=0; y<height; y++) {
    for (let x=0; x<width; x++) {
      const index = y * width + x;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1 || permanentWater[index] !== 0) seed(index);
    }
  }
  for (let entry = heap.pop(); entry !== undefined; entry = heap.pop()) {
    const x = entry.index % width;
    const y = Math.floor(entry.index / width);
    for (const [dx,dy] of D8_CLOCKWISE) {
      const nx = x + dx; const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const neighbor = ny * width + nx;
      if (visited[neighbor]) continue;
      visited[neighbor] = 1;
      conditioned[neighbor] = Math.max(rawElevation[neighbor]!, entry.elevation);
      heap.push({ elevation: conditioned[neighbor]!, index: neighbor });
    }
  }
  return conditioned;
}
