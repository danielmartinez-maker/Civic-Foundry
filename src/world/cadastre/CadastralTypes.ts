import type { PolygonRing, WorldPoint } from './Geometry.ts';

export type ParcelNode = Readonly<{
  id: string;
  point: WorldPoint;
}>;

export type ParcelEdgeKind =
  | 'property-boundary'
  | 'street-frontage'
  | 'water-boundary'
  | 'right-of-way'
  | 'easement-boundary';

export type ParcelEdge = Readonly<{
  id: string;
  fromNodeId: string;
  toNodeId: string;
  leftParcelId?: string;
  rightParcelId?: string;
  kind: ParcelEdgeKind;
  roadRef?: string;
}>;

export type Parcel = Readonly<{
  id: string;
  blockId: string;
  boundaryEdgeIds: readonly string[];
  areaM2: number;
  centroid: WorldPoint;
  frontageEdgeIds: readonly string[];
  accessEdgeIds: readonly string[];
  zoningDistrictId: string;
  ownerId?: string;
  historicalParentIds: readonly string[];
}>;

export type UrbanBlock = Readonly<{
  id: string;
  boundary: PolygonRing;
  parcelIds: readonly string[];
  roadEdgeIds: readonly string[];
}>;

export type EasementKind = 'access' | 'utility' | 'drainage' | 'pedestrian';

export type Easement = Readonly<{
  id: string;
  parcelIds: readonly string[];
  kind: EasementKind;
  geometry: readonly WorldPoint[];
}>;

export type ParcelLineageKind =
  | 'split'
  | 'assembly'
  | 'boundary-adjustment'
  | 'right-of-way'
  | 'easement';

export type ParcelLineageEvent = Readonly<{
  id: string;
  tick: number;
  kind: ParcelLineageKind;
  sourceParcelIds: readonly string[];
  resultingParcelIds: readonly string[];
}>;

export type CadastralSnapshot = Readonly<{
  nodes: readonly ParcelNode[];
  edges: readonly ParcelEdge[];
  blocks: readonly UrbanBlock[];
  parcels: readonly Parcel[];
  easements: readonly Easement[];
  lineage: readonly ParcelLineageEvent[];
}>;

export type CadastralValidationErrorCode =
  | 'duplicate-id'
  | 'missing-node'
  | 'missing-edge'
  | 'missing-parcel'
  | 'missing-block'
  | 'zero-length-edge'
  | 'duplicate-shared-boundary'
  | 'parcel-boundary-invalid'
  | 'parcel-self-intersection'
  | 'parcel-area-mismatch'
  | 'parcel-overlap'
  | 'parcel-block-mismatch'
  | 'frontage-invalid'
  | 'access-invalid'
  | 'road-reference-missing'
  | 'orphan-node'
  | 'easement-reference-invalid'
  | 'lineage-cycle';

export type CadastralValidationError = Readonly<{
  code: CadastralValidationErrorCode;
  message: string;
  entityId?: string;
}>;

export type CadastralValidationResult = Readonly<{
  valid: boolean;
  errors: readonly CadastralValidationError[];
}>;
