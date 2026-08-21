export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = (seed >>> 0) || 0x6d2b79f5;
  }

  next(): number {
    let x = this.state >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 0x100000000;
  }

  nextInt(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new Error('maxExclusive must be a positive integer');
    }
    return Math.floor(this.next() * maxExclusive);
  }

  getState(): number {
    return this.state >>> 0;
  }

  setState(state: number): void {
    this.state = (state >>> 0) || 0x6d2b79f5;
  }
}
