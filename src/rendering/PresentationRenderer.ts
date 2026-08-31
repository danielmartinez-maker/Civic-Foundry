import type { SimulationCore } from '../simulation/core/SimulationCore.ts';
import type { WorldPoint } from '../world/cadastre/Geometry.ts';
import type { EconomyOverlayMode } from './EconomyOverlayLayer.ts';
import type { ServiceOverlayMode } from './ServiceOverlayLayer.ts';
import type { TrafficOverlayMode } from './TrafficOverlayLayer.ts';
import type { TransitOverlayMode } from './TransitOverlayLayer.ts';
import type { UrbanFabricOverlayMode } from './CadastralOverlayLayer.ts';

export type PresentationBackend = 'legacy-gpu' | 'civic-3d';
export type RendererCameraInputOwner = 'app' | 'renderer';
export type RenderPoint = Readonly<{ x: number; y: number }>;
export type CellSelection = Readonly<{ x: number; y: number }> | null;

export type PresentationSceneStats = Readonly<{
  backend: PresentationBackend;
  loadedPrototypes: number;
  buildingInstances: number;
  fallbackBuildings: number;
  assetRequests: number;
  cacheHits: number;
  cacheMisses: number;
}>;

export interface PresentationRenderer {
  readonly backend: PresentationBackend;
  readonly cameraInputOwner: RendererCameraInputOwner;
  readonly canvas: HTMLCanvasElement;
  readonly cellSize: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly zoom: number;
  readonly quarterTurns: number;
  readonly currentUrbanFabricOverlayMode: UrbanFabricOverlayMode;
  readonly currentUrbanFabricSelectedParcelId: string | null;

  setUrbanFabricOverlay(mode: UrbanFabricOverlayMode, selectedParcelId?: string | null): void;
  pan(dx: number, dy: number): void;
  zoomBy(factor: number, anchorX: number, anchorY: number): void;
  rotate(direction: -1 | 1): void;
  worldToCanvas(x: number, y: number, core: SimulationCore): RenderPoint;
  worldMetersToCanvas(point: WorldPoint, core: SimulationCore): RenderPoint;
  canvasToCell(clientX: number, clientY: number, core: SimulationCore): CellSelection;
  tilePolygon(x: number, y: number, core: SimulationCore): readonly RenderPoint[];
  preloadAssets(): Promise<void>;
  assetDiagnostics(): readonly string[];
  resize(): void;
  draw(
    core: SimulationCore,
    overlayMode: TrafficOverlayMode,
    selected: CellSelection,
    previewPath?: readonly Readonly<{ x: number; y: number }>[],
    serviceOverlayMode?: ServiceOverlayMode,
    transitOverlayMode?: TransitOverlayMode,
    economyOverlayMode?: EconomyOverlayMode,
    urbanFabricOverlayMode?: UrbanFabricOverlayMode,
    selectedParcelId?: string | null,
  ): void;
  debugSceneStats(): PresentationSceneStats;
  dispose(): void;
}
