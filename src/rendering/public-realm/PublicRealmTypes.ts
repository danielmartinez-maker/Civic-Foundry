import type { ServiceFacilityType } from '../../data/services.ts';
import type { RoadType } from '../../data/roads.ts';
import type { UseType } from '../../simulation/zoning/ZoningTypes.ts';
import type { AssetOrientation } from '../assets/AssetTypes.ts';

export type PublicRealmProfile =
  | 'urban-core'
  | 'main-street'
  | 'residential-green'
  | 'suburban-auto-oriented'
  | 'industrial-logistics'
  | 'civic-public-space';

export type ParkingForm =
  | 'none'
  | 'driveway'
  | 'surface-lot-edge'
  | 'garage-entry'
  | 'curbside-dressing';

export type WorldFacing = AssetOrientation;
export type RealmAnchor = Readonly<{ x: number; y: number }>;

export type PublicRealmBuildingContext = Readonly<{
  kind: 'building';
  stableId: string;
  selectionKey: string;
  typologyId: string;
  stories: number;
  realizedFAR: number;
  coverageRatio: number;
  uses: readonly UseType[];
  roadType?: RoadType;
  hasAccessEdge: boolean;
  atIntersection: boolean;
  curbsideSuppressedByGeometry: boolean;
  worldFacing: WorldFacing;
  siteAnchor: RealmAnchor;
  frontageAnchor: RealmAnchor;
}>;

export type PublicRealmFacilityContext = Readonly<{
  kind: 'facility';
  stableId: string;
  selectionKey: string;
  facilityType: ServiceFacilityType;
  roadType?: RoadType;
  worldFacing: WorldFacing;
  siteAnchor: RealmAnchor;
  frontageAnchor: RealmAnchor;
}>;

export type PublicRealmContext = PublicRealmBuildingContext | PublicRealmFacilityContext;

export type PublicRealmChannelKeys = Readonly<{
  surface: string;
  access: string;
  vegetation: string;
  furniture: string;
  parking: string;
  accent: string;
}>;

export type PublicRealmDescriptor = Readonly<{
  context: PublicRealmContext;
  profile: PublicRealmProfile;
  parkingForm: ParkingForm;
  channelKeys: PublicRealmChannelKeys;
}>;
