import { SeededRandom } from '../core/SeededRandom.ts';

export type RandomStreamSnapshot = Readonly<Record<string, number>>;

function ordinalCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function validateName(name: string): void {
  if (name.trim().length === 0) throw new Error('random stream name must not be empty');
}

function hashName(name: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < name.length; index++) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function mix32(value: number): number {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return (x >>> 0) || 0x6d2b79f5;
}

export class RandomStreamRegistry {
  private readonly rootSeed: number;
  private readonly streams = new Map<string, SeededRandom>();

  constructor(rootSeed: number) {
    if (!Number.isInteger(rootSeed)) throw new Error('root seed must be an integer');
    this.rootSeed = rootSeed >>> 0;
  }

  stream(name: string): SeededRandom {
    validateName(name);
    let stream = this.streams.get(name);
    if (!stream) {
      stream = new SeededRandom(mix32(this.rootSeed ^ hashName(name)));
      this.streams.set(name, stream);
    }
    return stream;
  }

  snapshot(): RandomStreamSnapshot {
    const output: Record<string, number> = {};
    for (const name of this.listNames()) output[name] = this.streams.get(name)!.getState();
    return Object.freeze(output);
  }

  restore(snapshot: RandomStreamSnapshot): void {
    const names = Object.keys(snapshot).sort(ordinalCompare);
    const restored = new Map<string, SeededRandom>();
    for (const name of names) {
      validateName(name);
      const state = snapshot[name];
      if (!Number.isInteger(state) || state! < 0 || state! > 0xffffffff) {
        throw new Error(`invalid random stream state: ${name}`);
      }
      const stream = new SeededRandom(mix32(this.rootSeed ^ hashName(name)));
      stream.setState(state!);
      restored.set(name, stream);
    }
    this.streams.clear();
    for (const [name, stream] of restored) this.streams.set(name, stream);
  }

  listNames(): readonly string[] {
    return Object.freeze([...this.streams.keys()].sort(ordinalCompare));
  }
}
