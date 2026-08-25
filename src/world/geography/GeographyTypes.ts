import type { Polygon2 } from '../geometry/GeometryTypes.ts';

export type GeographyKind = 'region' | 'municipality' | 'district' | 'neighborhood' | 'block';
export type GeographyId = string;
export type RegionId = GeographyId;
export type MunicipalityId = GeographyId;
export type DistrictId = GeographyId;
export type NeighborhoodId = GeographyId;
export type BlockId = GeographyId;

export type GeographyEntity = Readonly<{
  id: GeographyId;
  kind: GeographyKind;
  parentId: GeographyId | null;
  boundary: Polygon2;
  name?: string;
  sortKey: string;
}>;

export type GeographySnapshot = Readonly<{ entities: readonly GeographyEntity[] }>;
