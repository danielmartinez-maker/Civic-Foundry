import type { SimulationCore } from '../simulation/core/SimulationCore.ts';
import type { TrafficOverlayMode } from './TrafficOverlayLayer.ts';
import type { ServiceOverlayMode } from './ServiceOverlayLayer.ts';
import type { TransitOverlayMode } from './TransitOverlayLayer.ts';
import type { EconomyOverlayMode } from './EconomyOverlayLayer.ts';
import { VehicleRenderer } from './VehicleRenderer.ts';
import { ServiceVehicleRenderer } from './ServiceVehicleRenderer.ts';
import { TransitVehicleRenderer } from './TransitVehicleRenderer.ts';
import { FreightVehicleRenderer } from './FreightVehicleRenderer.ts';
import { AssetRegistry } from './assets/AssetRegistry.ts';
import { PASS_A_ASSET_MANIFEST } from './assets/PassAAssetManifest.ts';
import { IsometricCamera } from './isometric/IsometricCamera.ts';
import { GroundRenderPass } from './passes/GroundRenderPass.ts';
import { ObjectRenderPass } from './passes/ObjectRenderPass.ts';
import { OverlayRenderPass } from './passes/OverlayRenderPass.ts';
import { SelectionRenderPass } from './passes/SelectionRenderPass.ts';

export type CanvasPoint = Readonly<{ x: number; y: number }>;
export type CellSelection = Readonly<{ x: number; y: number }> | null;

// Presentation-only facade: authoritative state remains entirely inside SimulationCore.
export class WorldRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly camera = new IsometricCamera();
  private readonly assets = new AssetRegistry(PASS_A_ASSET_MANIFEST);
  private readonly ground = new GroundRenderPass(this.assets);
  private readonly objects = new ObjectRenderPass(this.assets);
  private readonly overlays = new OverlayRenderPass();
  private readonly selection = new SelectionRenderPass();
  private readonly vehicles = new VehicleRenderer(this.assets);
  private readonly serviceVehicles = new ServiceVehicleRenderer(this.assets);
  private readonly transitVehicles = new TransitVehicleRenderer(this.assets);
  private readonly freightVehicles = new FreightVehicleRenderer(this.assets);
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is unavailable');
    this.ctx = ctx;
    void this.preloadAssets();
  }

  get cellSize(): number { return this.camera.tileWidth; }
  get tileWidth(): number { return this.camera.tileWidth; }
  get tileHeight(): number { return this.camera.tileHeight; }
  get zoom(): number { return this.camera.zoom; }
  get quarterTurns(): number { return this.camera.quarterTurns; }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * this.dpr));
    const height = Math.max(1, Math.round(rect.height * this.dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  pan(dx: number, dy: number): void { this.camera.pan(dx, dy); }
  zoomBy(factor: number, anchorX: number, anchorY: number): void { this.camera.zoomBy(factor, anchorX, anchorY); }
  rotate(direction: -1 | 1): void { this.camera.rotate(direction); }

  worldToCanvas(x: number, y: number, core: SimulationCore): CanvasPoint {
    return this.camera.worldToCanvas(x, y, this.worldSize(core));
  }

  canvasToCell(clientX: number, clientY: number, core: SimulationCore): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    return this.camera.canvasToCell(clientX - rect.left, clientY - rect.top, this.worldSize(core));
  }

  tilePolygon(x: number, y: number, core: SimulationCore): readonly CanvasPoint[] {
    return this.camera.tilePolygon(x, y, this.worldSize(core));
  }

  async preloadAssets(): Promise<void> { await this.assets.preload(); }
  assetDiagnostics(): readonly string[] { return this.assets.diagnostics(); }

  draw(
    core: SimulationCore,
    overlayMode: TrafficOverlayMode,
    selected: CellSelection,
    previewPath: readonly { x: number; y: number }[] = [],
    serviceOverlayMode: ServiceOverlayMode = 'none',
    transitOverlayMode: TransitOverlayMode = 'none',
    economyOverlayMode: EconomyOverlayMode = 'none',
  ): void {
    this.resize();
    const rect = this.canvas.getBoundingClientRect();
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.clearRect(0, 0, rect.width, rect.height);
    this.ctx.fillStyle = '#11171b';
    this.ctx.fillRect(0, 0, rect.width, rect.height);

    const viewport = { width: rect.width, height: rect.height };
    const worldSize = this.worldSize(core);
    this.ground.draw(this.ctx, core, this.camera, viewport);
    this.objects.draw(this.ctx, core, this.camera, viewport);

    this.vehicles.draw(this.ctx, core.transportationGraph, core.traffic, this.camera, worldSize);
    const travelTicks = new Map(core.traffic.edgeMetrics.map((metric) => [metric.edgeId, metric.travelTimeTicks]));
    this.serviceVehicles.draw(this.ctx, core.transportationGraph, core.serviceVehicles, travelTicks, this.camera, worldSize);
    this.transitVehicles.draw(this.ctx, core.transit, core.transportationGraph, core.mobility.vehicles, travelTicks, this.camera, worldSize);
    this.freightVehicles.draw(this.ctx, core.transportationGraph, core.economyDomain.freightVehicles, travelTicks, this.camera, worldSize);

    this.overlays.draw(this.ctx, core, this.camera, overlayMode, serviceOverlayMode, transitOverlayMode, economyOverlayMode);
    this.selection.draw(this.ctx, core, this.camera, selected, previewPath);
  }

  private worldSize(core: SimulationCore): Readonly<{ width: number; height: number }> {
    return { width: core.terrain.width, height: core.terrain.height };
  }
}
