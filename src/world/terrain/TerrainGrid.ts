import { SeededRandom } from '../../simulation/core/SeededRandom.ts';

export type TerrainCell = Readonly<{
  elevation: number;
  water: boolean;
  buildable: boolean;
  biome: 'grass' | 'forest' | 'rock' | 'water';
}>;

function validDimension(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

export class TerrainGrid {
  readonly width: number;
  readonly height: number;
  private readonly cells: TerrainCell[];

  constructor(width: number, height: number, cells: TerrainCell[]) {
    if (!validDimension(width) || !validDimension(height) || cells.length !== width * height) throw new Error('invalid terrain dimensions');
    this.width = width;
    this.height = height;
    this.cells = cells.map((cell) => Object.freeze({ ...cell }));
  }

  static generate(width: number, height: number, seed: number): TerrainGrid {
    if (!validDimension(width) || !validDimension(height)) throw new Error('invalid terrain dimensions');
    const rng = new SeededRandom(seed ^ 0x91e10da5);
    const cells: TerrainCell[] = [];
    const cx = (width - 1) / 2;
    const cy = (height - 1) / 2;
    const scale = Math.max(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const radial = Math.hypot(x - cx, y - cy) / scale;
        const wave = Math.sin((x + seed * 0.01) * 0.53) * 0.12 + Math.cos((y - seed * 0.01) * 0.47) * 0.1;
        const elevation = Number((0.47 + wave + (rng.next() - 0.5) * 0.16 - radial * 0.12).toFixed(5));
        const water = elevation < 0.31;
        const rock = elevation > 0.68;
        const buildable = !water && !rock;
        const biome: TerrainCell['biome'] = water ? 'water' : rock ? 'rock' : rng.next() < 0.18 ? 'forest' : 'grass';
        cells.push({ elevation, water, buildable, biome });
      }
    }
    return new TerrainGrid(width, height, cells);
  }

  get(x: number, y: number): TerrainCell {
    if (!this.inBounds(x, y)) throw new Error(`terrain coordinate out of bounds: ${x},${y}`);
    const cell = this.cells[y * this.width + x];
    if (!cell) throw new Error('terrain cell missing');
    return cell;
  }

  isBuildable(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.get(x, y).buildable;
  }

  inBounds(x: number, y: number): boolean {
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  snapshot(): TerrainCell[] {
    return this.cells.map((cell) => ({ ...cell }));
  }
}
