export type UseType =
  | 'residential'
  | 'retail'
  | 'office'
  | 'hospitality'
  | 'light-industrial'
  | 'heavy-industrial'
  | 'logistics'
  | 'civic';

export type ZoningDistrict = Readonly<{
  id: string;
  permittedUses: readonly UseType[];
  conditionalUses: readonly UseType[];
  maxFAR: number;
  maxHeightMeters: number;
  maxStories?: number;
  maxCoverageRatio: number;
  frontSetbackMeters: number;
  rearSetbackMeters: number;
  sideSetbackMeters: number;
  minParcelAreaM2: number;
  minFrontageMeters: number;
  maxResidentialUnitsPerHectare?: number;
}>;

export type ZoningOverlayKind =
  | 'floodplain'
  | 'historic'
  | 'airport-height'
  | 'transit-oriented'
  | 'waterfront'
  | 'environmental'
  | 'downtown-bonus'
  | 'affordable-housing-bonus';

export type ZoningOverlay = Readonly<{
  id: string;
  kind: ZoningOverlayKind;
  parcelIds: readonly string[];
  maxFARMultiplier?: number;
  maxHeightMeters?: number;
  maxCoverageRatio?: number;
  additionalFrontSetbackMeters?: number;
  additionalRearSetbackMeters?: number;
  additionalSideSetbackMeters?: number;
  permittedUseAdditions?: readonly UseType[];
  prohibitedUses?: readonly UseType[];
}>;

export type ParcelZoningAssignment = Readonly<{
  parcelId: string;
  districtId: string;
  overlayIds: readonly string[];
}>;

export type ZoningConstraintCode =
  | 'use'
  | 'far'
  | 'height'
  | 'stories'
  | 'coverage'
  | 'front-setback'
  | 'rear-setback'
  | 'side-setback'
  | 'minimum-area'
  | 'minimum-frontage'
  | 'overlay';

export type ZoningConstraint = Readonly<{
  code: ZoningConstraintCode;
  limit: number | string;
  actual?: number | string;
  sourceId?: string;
}>;
