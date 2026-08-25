import type { AssetManifest } from './AssetTypes.ts';

export const PASS_A_ART_BIBLE = Object.freeze({
  grass: '#7f956e',
  forestGround: '#647d59',
  rock: '#7d7f7d',
  water: '#5f88a4',
  asphalt: '#3f454a',
  sidewalk: '#b9b1a5',
  concrete: '#aaa79f',
  laneWhite: '#e3e0d5',
  laneYellow: '#d9be69',
  shadow: 'rgba(38,45,48,.24)',
} as const);

export const PASS_A_ASSET_MANIFEST: AssetManifest = Object.freeze({
  schemaVersion: 1,
  atlases: Object.freeze([
    { atlasId: 'terrain', url: './assets/atlases/terrain.png', width: 1024, height: 64 },
    { atlasId: 'roads', url: './assets/atlases/roads.png', width: 2048, height: 192 },
    { atlasId: 'buildings', url: './assets/atlases/buildings.png', width: 4096, height: 2048 },
    { atlasId: 'construction', url: './assets/atlases/construction.png', width: 2048, height: 768 },
    { atlasId: 'civic', url: './assets/atlases/civic.png', width: 2048, height: 768 },
    { atlasId: 'utilities', url: './assets/atlases/utilities.png', width: 1024, height: 512 },
    { atlasId: 'vegetation', url: './assets/atlases/vegetation.png', width: 1024, height: 512 },
    { atlasId: 'vehicles', url: './assets/atlases/vehicles.png', width: 4096, height: 768 },
  ]),
  entries: Object.freeze([]),
});
