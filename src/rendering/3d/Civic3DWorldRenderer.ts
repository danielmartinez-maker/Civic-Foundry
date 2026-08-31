import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import '@babylonjs/core/Culling/ray.js';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Scene } from '@babylonjs/core/scene.js';
import type { SimulationCore } from '../../simulation/core/SimulationCore.ts';
import { LEGACY_CELL_SIZE_METERS, type WorldPoint } from '../../world/cadastre/Geometry.ts';
import type { UrbanFabricOverlayMode } from '../CadastralOverlayLayer.ts';
import type { EconomyOverlayMode } from '../EconomyOverlayLayer.ts';
import type {
  CellSelection,
  PresentationRenderer,
  PresentationSceneStats,
  RenderPoint,
} from '../PresentationRenderer.ts';
import type { ServiceOverlayMode } from '../ServiceOverlayLayer.ts';
import type { TrafficOverlayMode } from '../TrafficOverlayLayer.ts';
import type { TransitOverlayMode } from '../TransitOverlayLayer.ts';
import { createBabylonEngine } from './BabylonEngineFactory.ts';
import { MiniatureCameraController } from './MiniatureCameraController.ts';
import { MiniatureRenderPipeline } from './MiniatureRenderPipeline.ts';
import type { VisualTime, WorldPresentationSnapshot } from './presentation/PresentationTypes.ts';
import { WorldPresentationSnapshotBuilder } from './presentation/WorldPresentationSnapshotBuilder.ts';

const INITIAL_RADIUS_METERS = 900;
const PIXEL_PAN_SCALE = 0.0025;

type PointerGesture = Readonly<{
  pointerId: number;
  mode: 'orbit' | 'pan';
  x: number;
  y: number;
}>;

export class Civic3DWorldRenderer implements PresentationRenderer {
  readonly backend = 'civic-3d' as const;
  readonly cameraInputOwner = 'renderer' as const;
  readonly canvas: HTMLCanvasElement;

  private readonly controller = new MiniatureCameraController({
    target: { x: 0, y: 0, z: 0 },
    radius: INITIAL_RADIUS_METERS,
    azimuthRad: Math.PI / 4,
    elevationRad: 0.82,
  });
  private readonly snapshotBuilder = new WorldPresentationSnapshotBuilder();
  private readonly diagnostics: string[] = [];
  private readonly readyPromise: Promise<void>;
  private readonly inputCleanups: Array<() => void> = [];

  private engine: AbstractEngine | null = null;
  private scene: Scene | null = null;
  private camera: ArcRotateCamera | null = null;
  private renderPipeline: MiniatureRenderPipeline | null = null;
  private pointerGesture: PointerGesture | null = null;
  private visualTime: VisualTime = 'day';
  private lastSnapshot: WorldPresentationSnapshot | null = null;
  private centeredOnWorld = false;
  private disposed = false;
  private urbanFabricOverlayMode: UrbanFabricOverlayMode = 'none';
  private urbanFabricSelectedParcelId: string | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.readyPromise = this.initialize().catch((error: unknown) => {
      this.diagnostics.push(`3D renderer initialization failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  get cellSize(): number { return LEGACY_CELL_SIZE_METERS; }
  get tileWidth(): number { return LEGACY_CELL_SIZE_METERS; }
  get tileHeight(): number { return LEGACY_CELL_SIZE_METERS; }
  get zoom(): number { return 120 / this.controller.snapshot().radius; }
  get quarterTurns(): number { return this.controller.quarterTurns; }
  get currentUrbanFabricOverlayMode(): UrbanFabricOverlayMode { return this.urbanFabricOverlayMode; }
  get currentUrbanFabricSelectedParcelId(): string | null { return this.urbanFabricSelectedParcelId; }

  setVisualTime(visualTime: VisualTime): void {
    if (this.visualTime === visualTime) return;
    this.visualTime = visualTime;
    this.renderPipeline?.setVisualTime(visualTime);
  }

  setUrbanFabricOverlay(mode: UrbanFabricOverlayMode, selectedParcelId: string | null = null): void {
    this.urbanFabricOverlayMode = mode;
    this.urbanFabricSelectedParcelId = selectedParcelId;
  }

  pan(dx: number, dy: number): void {
    const scale = this.controller.snapshot().radius * PIXEL_PAN_SCALE;
    this.controller.pan(-dx * scale, dy * scale);
    this.applyCameraState();
  }

  zoomBy(factor: number, _anchorX: number, _anchorY: number): void {
    this.controller.zoomBy(factor);
    this.applyCameraState();
  }

  rotate(direction: -1 | 1): void {
    this.controller.rotateQuarterTurn(direction);
    this.applyCameraState();
  }

  worldToCanvas(xMeters: number, zMeters: number, _core: SimulationCore): RenderPoint {
    const engine = this.engine;
    const scene = this.scene;
    const camera = this.camera;
    if (!engine || !scene || !camera) return this.canvasCenter();

    this.applyCameraState();
    const renderWidth = Math.max(1, engine.getRenderWidth());
    const renderHeight = Math.max(1, engine.getRenderHeight());
    const projected = Vector3.Project(
      new Vector3(xMeters, 0, zMeters),
      Matrix.IdentityReadOnly,
      scene.getTransformMatrix(),
      camera.viewport.toGlobal(renderWidth, renderHeight),
    );
    const rect = this.canvas.getBoundingClientRect();
    return Object.freeze({
      x: projected.x * (rect.width / renderWidth),
      y: projected.y * (rect.height / renderHeight),
    });
  }

  worldMetersToCanvas(point: WorldPoint, core: SimulationCore): RenderPoint {
    return this.worldToCanvas(point.x, point.y, core);
  }

  canvasToCell(clientX: number, clientY: number, core: SimulationCore): CellSelection {
    const engine = this.engine;
    const scene = this.scene;
    const camera = this.camera;
    if (!engine || !scene || !camera) return null;

    this.applyCameraState();
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const renderX = (clientX - rect.left) * (engine.getRenderWidth() / rect.width);
    const renderY = (clientY - rect.top) * (engine.getRenderHeight() / rect.height);
    const ray = scene.createPickingRay(renderX, renderY, Matrix.Identity(), camera);
    if (Math.abs(ray.direction.y) < 1e-8) return null;
    const distance = -ray.origin.y / ray.direction.y;
    if (distance < 0) return null;

    const hitX = ray.origin.x + ray.direction.x * distance;
    const hitZ = ray.origin.z + ray.direction.z * distance;
    const x = Math.floor(hitX / LEGACY_CELL_SIZE_METERS);
    const y = Math.floor(hitZ / LEGACY_CELL_SIZE_METERS);
    if (x < 0 || y < 0 || x >= core.terrain.width || y >= core.terrain.height) return null;
    return Object.freeze({ x, y });
  }

  tilePolygon(x: number, y: number, core: SimulationCore): readonly RenderPoint[] {
    const x0 = x * LEGACY_CELL_SIZE_METERS;
    const z0 = y * LEGACY_CELL_SIZE_METERS;
    const x1 = x0 + LEGACY_CELL_SIZE_METERS;
    const z1 = z0 + LEGACY_CELL_SIZE_METERS;
    return Object.freeze([
      this.worldToCanvas(x0, z0, core),
      this.worldToCanvas(x1, z0, core),
      this.worldToCanvas(x1, z1, core),
      this.worldToCanvas(x0, z1, core),
    ]);
  }

  async preloadAssets(): Promise<void> {
    await this.readyPromise;
  }

  assetDiagnostics(): readonly string[] {
    return Object.freeze([...this.diagnostics]);
  }

  resize(): void {
    this.engine?.resize();
  }

  draw(
    core: SimulationCore,
    _overlayMode: TrafficOverlayMode,
    _selected: CellSelection,
    _previewPath: readonly Readonly<{ x: number; y: number }>[] = [],
    _serviceOverlayMode: ServiceOverlayMode = 'none',
    _transitOverlayMode: TransitOverlayMode = 'none',
    _economyOverlayMode: EconomyOverlayMode = 'none',
    urbanFabricOverlayMode?: UrbanFabricOverlayMode,
    selectedParcelId?: string | null,
  ): void {
    if (urbanFabricOverlayMode !== undefined) this.urbanFabricOverlayMode = urbanFabricOverlayMode;
    if (selectedParcelId !== undefined) this.urbanFabricSelectedParcelId = selectedParcelId;

    this.lastSnapshot = this.snapshotBuilder.build(core, this.visualTime);
    if (!this.centeredOnWorld) {
      this.controller.focus({
        x: core.terrain.width * LEGACY_CELL_SIZE_METERS * 0.5,
        y: 0,
        z: core.terrain.height * LEGACY_CELL_SIZE_METERS * 0.5,
      });
      this.centeredOnWorld = true;
    }

    if (!this.scene || !this.camera || this.disposed) return;
    this.applyCameraState();
    this.renderPipeline?.setVisualTime(this.visualTime);
    this.renderPipeline?.updateFocusDistance(this.controller.snapshot().radius);
    this.scene.render();
  }

  debugSceneStats(): PresentationSceneStats {
    return Object.freeze({
      backend: 'civic-3d',
      loadedPrototypes: 0,
      buildingInstances: 0,
      fallbackBuildings: this.lastSnapshot?.buildings.length ?? 0,
      assetRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const cleanup of this.inputCleanups.splice(0)) cleanup();
    this.pointerGesture = null;
    this.renderPipeline?.dispose();
    this.renderPipeline = null;
    this.scene?.dispose();
    this.scene = null;
    this.camera = null;
    this.engine?.dispose();
    this.engine = null;
  }

  private async initialize(): Promise<void> {
    const result = await createBabylonEngine(this.canvas);
    if (this.disposed) {
      result.engine.dispose();
      return;
    }
    this.engine = result.engine;
    this.diagnostics.push(...result.diagnostics);
    if (result.backend === 'webgl') this.diagnostics.push('Babylon renderer running on WebGL fallback.');

    const scene = new Scene(result.engine);
    this.scene = scene;
    const state = this.controller.snapshot();
    const camera = new ArcRotateCamera(
      'civic-miniature-camera',
      Math.PI / 2 - state.azimuthRad,
      Math.PI / 2 - state.elevationRad,
      state.radius,
      new Vector3(state.target.x, 0, state.target.z),
      scene,
    );
    camera.minZ = 0.5;
    camera.maxZ = 20_000;
    camera.lowerRadiusLimit = 12;
    camera.upperRadiusLimit = 5000;
    scene.activeCamera = camera;
    this.camera = camera;

    this.renderPipeline = new MiniatureRenderPipeline(scene, camera);
    this.renderPipeline.setVisualTime(this.visualTime);
    this.attachInput();
    this.resize();
    this.applyCameraState();
  }

  private attachInput(): void {
    const onContextMenu = (event: MouseEvent): void => event.preventDefault();
    const onPointerDown = (event: PointerEvent): void => {
      const mode = event.button === 2 ? 'orbit' : event.button === 1 ? 'pan' : null;
      if (!mode) return;
      event.preventDefault();
      this.pointerGesture = { pointerId: event.pointerId, mode, x: event.clientX, y: event.clientY };
      this.canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent): void => {
      const gesture = this.pointerGesture;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (gesture.mode === 'orbit') {
        this.controller.orbit(dx, dy);
      } else {
        const scale = this.controller.snapshot().radius * PIXEL_PAN_SCALE;
        this.controller.pan(-dx * scale, dy * scale);
      }
      this.pointerGesture = { ...gesture, x: event.clientX, y: event.clientY };
      this.applyCameraState();
    };
    const endGesture = (event: PointerEvent): void => {
      if (!this.pointerGesture || this.pointerGesture.pointerId !== event.pointerId) return;
      this.pointerGesture = null;
      if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    };
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      this.controller.zoomBy(Math.exp(event.deltaY * 0.0012));
      this.applyCameraState();
    };

    this.canvas.addEventListener('contextmenu', onContextMenu);
    this.canvas.addEventListener('pointerdown', onPointerDown);
    this.canvas.addEventListener('pointermove', onPointerMove);
    this.canvas.addEventListener('pointerup', endGesture);
    this.canvas.addEventListener('pointercancel', endGesture);
    this.canvas.addEventListener('wheel', onWheel, { passive: false });

    this.inputCleanups.push(
      () => this.canvas.removeEventListener('contextmenu', onContextMenu),
      () => this.canvas.removeEventListener('pointerdown', onPointerDown),
      () => this.canvas.removeEventListener('pointermove', onPointerMove),
      () => this.canvas.removeEventListener('pointerup', endGesture),
      () => this.canvas.removeEventListener('pointercancel', endGesture),
      () => this.canvas.removeEventListener('wheel', onWheel),
    );
  }

  private applyCameraState(): void {
    const camera = this.camera;
    if (!camera) return;
    const state = this.controller.snapshot();
    camera.alpha = Math.PI / 2 - state.azimuthRad;
    camera.beta = Math.PI / 2 - state.elevationRad;
    camera.radius = state.radius;
    camera.target.copyFromFloats(state.target.x, 0, state.target.z);
  }

  private canvasCenter(): RenderPoint {
    const rect = this.canvas.getBoundingClientRect();
    return Object.freeze({ x: rect.width * 0.5, y: rect.height * 0.5 });
  }
}
