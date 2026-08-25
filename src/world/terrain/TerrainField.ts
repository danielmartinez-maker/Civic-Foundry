import type { SoilClass, SurfaceWaterClass, TerrainFieldSnapshot, TerrainPhysicalSample, VegetationClass } from './TerrainTypes.ts';

const SOILS = new Set<SoilClass>(['rock','gravel','sand','loam','clay','alluvium','peat','fill_disturbed']);
const VEGETATION = new Set<VegetationClass>(['none','grass','forest','scrub','wetland']);
const WATER = new Set<SurfaceWaterClass>(['none','lake','river','coast']);
const MAX_BUILDABLE_SLOPE = 0.70;

function validDimension(value: number): boolean { return Number.isInteger(value) && Number.isFinite(value) && value > 0; }
function requireFinite(name: string, value: number): void { if (!Number.isFinite(value)) throw new Error(`${name} must be finite`); }
function deriveBuildable(sample: TerrainPhysicalSample): boolean {
  return sample.buildable && sample.surfaceWater === 'none' && sample.slope <= MAX_BUILDABLE_SLOPE;
}
function normalizeSample(sample: TerrainPhysicalSample): TerrainPhysicalSample {
  const numeric: Array<readonly [string, number]> = [
    ['elevationMeters', sample.elevationMeters], ['slope', sample.slope], ['aspectRadians', sample.aspectRadians],
    ['soilDepthMeters', sample.soilDepthMeters], ['bearingCapacityKpa', sample.bearingCapacityKpa],
    ['bedrockDepthMeters', sample.bedrockDepthMeters], ['groundwaterDepthMeters', sample.groundwaterDepthMeters],
    ['contaminationIndex', sample.contaminationIndex], ['landPreparationMultiplier', sample.landPreparationMultiplier],
  ];
  for (const [name, value] of numeric) requireFinite(name, value);
  if (!SOILS.has(sample.soilClass)) throw new Error('invalid soil class');
  if (!VEGETATION.has(sample.vegetationClass)) throw new Error('invalid vegetation class');
  if (!WATER.has(sample.surfaceWater)) throw new Error('invalid surface water class');
  if (sample.slope < 0 || sample.soilDepthMeters < 0 || sample.bearingCapacityKpa <= 0 || sample.bedrockDepthMeters < 0 || sample.groundwaterDepthMeters < 0) throw new Error('invalid terrain physical value');
  if (sample.contaminationIndex < 0 || sample.contaminationIndex > 1) throw new Error('contaminationIndex must be within [0, 1]');
  if (sample.landPreparationMultiplier <= 0) throw new Error('landPreparationMultiplier must be positive');
  return Object.freeze({ ...sample, buildable: deriveBuildable(sample) });
}

export class TerrainField {
  readonly width: number;
  readonly height: number;
  readonly metersPerCell: number;
  private readonly samples: readonly TerrainPhysicalSample[];

  private constructor(width: number, height: number, metersPerCell: number, samples: readonly TerrainPhysicalSample[]) {
    this.width = width; this.height = height; this.metersPerCell = metersPerCell; this.samples = samples;
  }

  static fromSamples(width: number, height: number, metersPerCell: number, samples: readonly TerrainPhysicalSample[]): TerrainField {
    if (!validDimension(width) || !validDimension(height)) throw new Error('invalid terrain dimensions');
    if (!Number.isFinite(metersPerCell) || metersPerCell <= 0) throw new Error('metersPerCell must be positive and finite');
    if (samples.length !== width * height) throw new Error('terrain sample count does not match dimensions');
    return new TerrainField(width, height, metersPerCell, Object.freeze(samples.map(normalizeSample)));
  }

  inBounds(x: number, y: number): boolean { return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < this.width && y < this.height; }
  getPhysical(x: number, y: number): TerrainPhysicalSample {
    if (!this.inBounds(x,y)) throw new Error(`terrain coordinate out of bounds: ${x},${y}`);
    return this.samples[y * this.width + x]!;
  }
  isBuildable(x: number, y: number): boolean { return this.inBounds(x,y) && this.getPhysical(x,y).buildable; }
  preparationMultiplierAt(x: number, y: number): number { return this.getPhysical(x,y).landPreparationMultiplier; }
  snapshotAuthoritative(): TerrainFieldSnapshot {
    return Object.freeze({ width:this.width, height:this.height, metersPerCell:this.metersPerCell, samples:Object.freeze(this.samples.map((sample) => ({ ...sample }))) });
  }
  static restore(snapshot: TerrainFieldSnapshot): TerrainField { return TerrainField.fromSamples(snapshot.width, snapshot.height, snapshot.metersPerCell, snapshot.samples); }
}
