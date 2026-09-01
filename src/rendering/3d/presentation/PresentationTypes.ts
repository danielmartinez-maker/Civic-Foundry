import type { AssetId } from '../assets/AssetManifestV2.ts';
import type { PolygonRing } from '../../../world/cadastre/Geometry.ts';

export type PresentationEntityId =
  | `building:${string}`
  | `parcel:${string}`
  | `road:${string}`
  | `vehicle:${string}`
  | `facility:${string}`;

export type ProductionPresentationEntityId =
  | PresentationEntityId
  | `prop:${string}`
  | `transit:${string}`
  | `vegetation:${string}`
  | `construction:${string}`
  | `landmark:${string}`;

export type VisualCondition = 'excellent' | 'good' | 'worn' | 'distressed' | 'unsafe';
export type VisualOccupancy = 'occupied' | 'vacant';
export type VisualTime = 'day' | 'night';

export type SceneTransform = Readonly<{
  positionM: Readonly<{ x: number; y: number; z: number }>;
  rotationYRad: number;
  scale: Readonly<{ x: number; y: number; z: number }>;
}>;

export type ProductionVisualState = Readonly<{
  presentationId: ProductionPresentationEntityId;
  canonicalId: string;
  assetId: AssetId;
  transform: Readonly<{
    positionM: Readonly<{ x: number; y: number; z: number }>;
    rotationY: number;
    scale: Readonly<{ x: number; y: number; z: number }>;
  }>;
  variationSeed: number;
  structuralFingerprint: string;
  appearanceFingerprint: string;
}>;

export type BuildingVisualState = Readonly<{
  presentationId: `building:${string}`;
  canonicalBuildingId: string;
  assetId: AssetId | null;
  transform: SceneTransform;
  fallbackBoundsM: Readonly<{
    footprint: PolygonRing;
    heightM: number;
  }>;
  state: Readonly<{
    condition: VisualCondition;
    occupancy: VisualOccupancy;
    powered: boolean;
    construction: 'none' | 'active';
    constructionProgress: number;
    nightLighting: boolean;
  }>;
  variationSeed: number;
  structuralFingerprint: string;
  appearanceFingerprint: string;
}>;

export type PresentationRevision = Readonly<{
  world: number;
  buildings: number;
  environment: number;
}>;

export type PresentationDirtySets = Readonly<{
  structuralBuildings: readonly `building:${string}`[];
  appearanceBuildings: readonly `building:${string}`[];
  removedBuildings: readonly `building:${string}`[];
}>;

export type WorldPresentationSnapshot = Readonly<{
  revision: PresentationRevision;
  visualTime: VisualTime;
  buildings: readonly BuildingVisualState[];
  dirty: PresentationDirtySets;
}>;
