import type { BuildingVisualState, VisualCondition } from '../presentation/PresentationTypes.ts';

export type BuildingAppearance = Readonly<{
  baseTint: Readonly<{ r: number; g: number; b: number }>;
  roughnessMultiplier: number;
  grimeAmount: number;
  windowsEmissive: boolean;
  scaffoldVisible: boolean;
  constructionProgress: number;
}>;

type ConditionProfile = Readonly<{
  baseTint: Readonly<{ r: number; g: number; b: number }>;
  roughnessMultiplier: number;
  grimeAmount: number;
}>;

const CONDITION_PROFILES: Readonly<Record<VisualCondition, ConditionProfile>> = Object.freeze({
  excellent: Object.freeze({
    baseTint: Object.freeze({ r: 1, g: 1, b: 1 }),
    roughnessMultiplier: 1,
    grimeAmount: 0.02,
  }),
  good: Object.freeze({
    baseTint: Object.freeze({ r: 0.97, g: 0.96, b: 0.94 }),
    roughnessMultiplier: 1.05,
    grimeAmount: 0.08,
  }),
  worn: Object.freeze({
    baseTint: Object.freeze({ r: 0.9, g: 0.87, b: 0.82 }),
    roughnessMultiplier: 1.15,
    grimeAmount: 0.2,
  }),
  distressed: Object.freeze({
    baseTint: Object.freeze({ r: 0.78, g: 0.73, b: 0.66 }),
    roughnessMultiplier: 1.3,
    grimeAmount: 0.38,
  }),
  unsafe: Object.freeze({
    baseTint: Object.freeze({ r: 0.64, g: 0.58, b: 0.5 }),
    roughnessMultiplier: 1.5,
    grimeAmount: 0.6,
  }),
});

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function resolveBuildingAppearance(
  state: BuildingVisualState['state'],
): BuildingAppearance {
  const profile = CONDITION_PROFILES[state.condition];
  return Object.freeze({
    baseTint: profile.baseTint,
    roughnessMultiplier: profile.roughnessMultiplier,
    grimeAmount: profile.grimeAmount,
    windowsEmissive:
      state.nightLighting && state.occupancy === 'occupied' && state.powered,
    scaffoldVisible: state.construction === 'active',
    constructionProgress: clamp01(state.constructionProgress),
  });
}
