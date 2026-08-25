export const WORLD_FORM_PRESETS = Object.freeze(['plain','river_valley','basin','rolling_uplands','ridge_edge','coastal_lowland'] as const);
export type WorldFormPreset = typeof WORLD_FORM_PRESETS[number];
export type WorldGenerationConfig = Readonly<{ width:number; height:number; metersPerCell:number; preset:WorldFormPreset }>;

const PRESET_SET = new Set<WorldFormPreset>(WORLD_FORM_PRESETS);

export function resolveWorldGenerationConfig(input: Partial<WorldGenerationConfig> = {}): WorldGenerationConfig {
  const width = input.width ?? 40;
  const height = input.height ?? 24;
  const metersPerCell = input.metersPerCell ?? 30;
  const preset = input.preset ?? 'rolling_uplands';
  if (!Number.isInteger(width) || width <= 0) throw new Error('world width must be a positive integer');
  if (!Number.isInteger(height) || height <= 0) throw new Error('world height must be a positive integer');
  if (!Number.isFinite(metersPerCell) || metersPerCell <= 0) throw new Error('metersPerCell must be positive and finite');
  if (!PRESET_SET.has(preset)) throw new Error(`invalid world preset: ${String(preset)}`);
  return Object.freeze({ width, height, metersPerCell, preset });
}
