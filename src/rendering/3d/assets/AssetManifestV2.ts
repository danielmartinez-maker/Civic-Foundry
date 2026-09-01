export type AssetId = `cf_${string}_v${string}`;

export type AssetCategory =
  | 'building'
  | 'vehicle'
  | 'vegetation'
  | 'road'
  | 'civic'
  | 'industrial'
  | 'transit'
  | 'construction'
  | 'public_realm';

export type AssetModelReference = string;

export type AssetVector3 = Readonly<{
  x: number;
  y: number;
  z: number;
}>;

export type AssetSocket = Readonly<{
  id: string;
  position: AssetVector3;
  forward: AssetVector3;
}>;

export type AssetManifestV2Entry = Readonly<{
  assetId: AssetId;
  revision: number;
  category: AssetCategory;
  semanticFamily: string;
  geometry: Readonly<{
    lod0: AssetModelReference;
    lod1?: AssetModelReference;
    lod2?: AssetModelReference;
    impostor?: AssetModelReference;
    collision?: AssetModelReference;
  }>;
  dimensions: Readonly<{
    widthM: number;
    depthM: number;
    heightM: number;
  }>;
  pivot: Readonly<{
    convention: 'ground-center';
    forward: '-Z';
    up: '+Y';
  }>;
  placement: Readonly<{
    snapMode: 'parcel' | 'road' | 'socket' | 'free';
    zoneCompatibility?: readonly string[];
    density?: readonly string[];
  }>;
  sockets: readonly AssetSocket[];
  materials: readonly Readonly<{
    id: string;
    family: string;
  }>[];
  stateChannels: Readonly<{
    condition?: readonly string[];
    occupancy?: readonly string[];
    power?: readonly string[];
    construction?: readonly string[];
    night?: readonly string[];
  }>;
  runtime: Readonly<{
    instancing: 'thin' | 'hardware' | 'unique';
    streamingClass: 'critical' | 'near' | 'normal' | 'background';
    memoryClass: 'tiny' | 'small' | 'medium' | 'large';
    estimatedCpuGeometryBytes: number;
    estimatedGpuGeometryBytes: number;
    estimatedGpuMaterialBytes: number;
  }>;
  art: Readonly<{
    styleFamily: string;
    qualityTier: string;
    reviewImage?: string;
  }>;
}>;

export type AssetManifestV2 = Readonly<{
  schemaVersion: 2;
  entries: readonly AssetManifestV2Entry[];
}>;
