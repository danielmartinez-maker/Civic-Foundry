import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import '@babylonjs/core/Culling/ray.js';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Node } from '@babylonjs/core/node.js';
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
import type { MiniatureCameraState } from './MiniatureCameraController.ts';
import { MiniatureRenderPipeline } from './MiniatureRenderPipeline.ts';
import { buildStack3AcceptanceDistrict } from './presentation/Stack3AcceptanceDistrict.ts';
import type {
  ProductionPresentationEntityId,
  ProductionVisualState,
  VisualTime,
  WorldPresentationSnapshot,
} from './presentation/PresentationTypes.ts';
import { WorldPresentationSnapshotBuilder } from './presentation/WorldPresentationSnapshotBuilder.ts';
import type { ProductionPickIdentity } from './scene/BabylonProductionSceneAdapter.ts';
import { Civic3DBuildingRuntime } from './scene/Civic3DBuildingRuntime.ts';
import { Civic3DProductionRuntime } from './scene/Civic3DProductionRuntime.ts';
import type { ProductionSceneStats } from './scene/ProductionSceneLayer.ts';

const INITIAL_RADIUS_METERS = 900;
const PIXEL_PAN_SCALE = 0.0025;
const MAX_ASSET_DIAGNOSTICS = 32;
const PRESENTATION_ID_PATTERN = /^(building|parcel|road|vehicle|facility|prop|transit|vegetation|construction|landmark):.+$/;

type PointerGesture = Readonly<{
  pointerId: number;
  mode: 'orbit' | 'pan';
  x: number;
  y: number;
}>;

type EngineBackend = 'webgpu' | 'webgl';

function presentationIdFromNode(start: Node | null): ProductionPresentationEntityId | null {
  let node = start;
  while (node) {
    const metadata = node.metadata as Readonly<{
      presentationEntityId?: unknown;
      presentationId?: unknown;
    }> | null | undefined;
    const candidate = metadata?.presentationEntityId ?? metadata?.presentationId;
    if (typeof candidate === 'string' && PRESENTATION_ID_PATTERN.test(candidate)) {
      return candidate as ProductionPresentationEntityId;
    }
    node = node.parent;
  }
  return null;
}

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
  private engineBackend: EngineBackend | null = null;
  private scene: Scene | null = null;
  private camera: ArcRotateCamera | null = null;
  private renderPipeline: MiniatureRenderPipeline | null = null;
  private buildingRuntime: Civic3DBuildingRuntime | null = null;
  private productionRuntime: Civic3DProductionRuntime | null = null;
  private disposePromise: Promise<void> | null = null;
  private pointerGesture: PointerGesture | null = null;
  private visualTime: VisualTime = 'day';
  private lastSnapshot: WorldPresentationSnapshot | null = null;
  private centeredOnWorld = false;
  private productionDistrictCentered = false;
  private reviewCameraExplicitlySet = false;
  private disposed = false;
  private urbanFabricOverlayMode: UrbanFabricOverlayMode = 'none';
  private urbanFabricSelectedParcelId: string | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.readyPromise = this.initialize().catch((error: unknown) => {
      this.pushDiagnostic(
        `3D renderer initialization failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  get cellSize(): number { return LEGACY_CELL_SIZE_METERS; }
  get tileWidth(): number { return LEGACY_CELL_SIZE_METERS; }
  get tileHeight(): number { return LEGACY_CELL_SIZE_METERS; }
  get zoom(): number { return 120 / this.controller.snapshot().radius; }
  get quarterTurns(): number { return this.controller.quarterTurns; }
  get currentUrbanFabricOverlayMode(): UrbanFabricOverlayMode { return this.urbanFabricOverlayMode; }
  get currentUrbanFabricSelectedParcelId(): string | null { return this.urbanFabricSelectedParcelId; }
  get reviewCameraState(): MiniatureCameraState {
    return this.controller.snapshot();
  }

  setReviewCamera(state: MiniatureCameraState): void {
    this.reviewCameraExplicitlySet = true;
    this.controller.setState(state);
    this.applyCameraState();
  }

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

  pickPresentationEntity(clientX: number, clientY: number): ProductionPresentationEntityId | null {
    const engine = this.engine;
    const scene = this.scene;
    const camera = this.camera;
    if (!engine || !scene || !camera || this.disposed) return null;

    this.applyCameraState();
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const renderX = (clientX - rect.left) * (engine.getRenderWidth() / rect.width);
    const renderY = (clientY - rect.top) * (engine.getRenderHeight() / rect.height);
    const hit = scene.pick(renderX, renderY, undefined, false, camera);
    if (!hit?.hit || !hit.pickedMesh) return null;
    return presentationIdFromNode(hit.pickedMesh);
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

  async whenBuildingSceneIdle(): Promise<void> {
    await this.readyPromise;
    await this.buildingRuntime?.whenIdle();
  }

  assetDiagnostics(): readonly string[] {
    return Object.freeze([...this.diagnostics]);
  }

  debugEngineBackend(): EngineBackend | null {
    return this.engineBackend;
  }

  debugBuildingState(presentationId: `building:${string}`) {
    return this.buildingRuntime?.debugBuildingState(presentationId) ?? null;
  }

  async loadStack3AcceptanceDistrict(scale: 'block' | 'neighborhood'): Promise<void> {
    await this.readyPromise;
    if (this.disposed || !this.scene || !this.camera) {
      throw new Error('Civic3DWorldRenderer is not available for Stack 3 production presentation');
    }

    const states = buildStack3AcceptanceDistrict(scale);
    if (!this.productionDistrictCentered && !this.reviewCameraExplicitlySet) {
      this.frameProductionDistrict(states);
    }
    this.productionDistrictCentered = true;
    this.applyCameraState();
    this.camera.getViewMatrix();

    const runtime = await this.ensureProductionRuntime();
    await runtime.apply(states, this.controller.position());
    this.renderPipeline?.setVisualTime(this.visualTime);
    this.renderPipeline?.updateFocusDistance(this.controller.snapshot().radius);
    this.scene.render();
  }

  debugProductionSceneStats(): ProductionSceneStats {
    return this.productionRuntime?.debugStats() ?? Object.freeze({
      active: 0,
      created: 0,
      updated: 0,
      removed: 0,
      unchanged: 0,
      replaced: 0,
      uniquePrototypes: 0,
      estimatedCpuBytes: 0,
      estimatedGpuBytes: 0,
    });
  }

  debugProductionReconstructionDigest(): string {
    return this.productionRuntime?.debugReconstructionDigest() ?? '';
  }

  debugProductionPickIdentities(): readonly ProductionPickIdentity[] {
    return this.productionRuntime?.debugPickIdentities() ?? Object.freeze([]);
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
    this.camera.getViewMatrix();
    this.buildingRuntime?.submit(this.lastSnapshot, Object.freeze({
      x: this.camera.position.x,
      y: this.camera.position.y,
      z: this.camera.position.z,
    }));
    this.renderPipeline?.setVisualTime(this.visualTime);
    this.renderPipeline?.updateFocusDistance(this.controller.snapshot().radius);
    this.scene.render();
  }

  debugSceneStats(): PresentationSceneStats {
    const runtime = this.buildingRuntime?.diagnostics();
    return Object.freeze({
      backend: 'civic-3d',
      loadedPrototypes: runtime?.loadedPrototypes ?? 0,
      buildingInstances: runtime?.buildingInstances ?? 0,
      fallbackBuildings: runtime?.fallbackBuildings ?? (this.lastSnapshot?.buildings.length ?? 0),
      assetRequests: runtime?.assetRequests ?? 0,
      cacheHits: runtime?.cacheHits ?? 0,
      cacheMisses: runtime?.cacheMisses ?? 0,
    });
  }

  dispose(): void {
    if (this.disposePromise) return;
    this.disposed = true;
    for (const cleanup of this.inputCleanups.splice(0)) cleanup();
    this.pointerGesture = null;
    this.disposePromise = this.disposeInternal();
  }

  async whenDisposed(): Promise<void> {
    if (!this.disposePromise) return;
    await this.disposePromise;
  }

  private async initialize(): Promise<void> {
    const result = await createBabylonEngine(this.canvas);
    if (this.disposed) {
      result.engine.dispose();
      return;
    }
    this.engine = result.engine;
    this.engineBackend = result.backend;
    this.diagnostics.push(...result.diagnostics);
    if (result.backend === 'webgl') this.pushDiagnostic('Babylon renderer running on WebGL fallback.');

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

    this.renderPipeline = new MiniatureRenderPipeline(scene, camera, {
      enableDepthOfField: result.backend === 'webgpu',
      enablePostProcessing: result.backend === 'webgpu',
    });
    this.renderPipeline.setVisualTime(this.visualTime);
    this.buildingRuntime = await Civic3DBuildingRuntime.create(scene, {
      onDiagnostic: (message): void => this.pushDiagnostic(message),
    });
    if (this.disposed) return;

    this.attachInput();
    this.resize();
    this.applyCameraState();
  }

  private async ensureProductionRuntime(): Promise<Civic3DProductionRuntime> {
    if (this.productionRuntime) return this.productionRuntime;
    const scene = this.scene;
    if (!scene || this.disposed) {
      throw new Error('Civic3DWorldRenderer cannot create a production runtime after disposal');
    }
    const runtime = await Civic3DProductionRuntime.create(scene);
    if (this.disposed) {
      runtime.dispose();
      throw new Error('Civic3DWorldRenderer was disposed while creating the production runtime');
    }
    this.productionRuntime = runtime;
    return runtime;
  }

  private frameProductionDistrict(states: readonly ProductionVisualState[]): void {
    if (states.length === 0) return;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (const state of states) {
      minX = Math.min(minX, state.transform.positionM.x);
      maxX = Math.max(maxX, state.transform.positionM.x);
      minZ = Math.min(minZ, state.transform.positionM.z);
      maxZ = Math.max(maxZ, state.transform.positionM.z);
    }
    const span = Math.max(maxX - minX, maxZ - minZ);
    const current = this.controller.snapshot();
    this.controller.setState({
      ...current,
      target: { x: (minX + maxX) / 2, y: 0, z: (minZ + maxZ) / 2 },
      radius: Math.max(90, span * 1.55),
    });
  }

  private async disposeInternal(): Promise<void> {
    await this.readyPromise;
    try {
      this.productionRuntime?.dispose();
      await this.buildingRuntime?.dispose();
    } finally {
      this.productionRuntime = null;
      this.buildingRuntime = null;
      this.renderPipeline?.dispose();
      this.renderPipeline = null;
      this.scene?.dispose();
      this.scene = null;
      this.camera = null;
      this.engine?.dispose();
      this.engine = null;
      this.engineBackend = null;
      this.lastSnapshot = null;
      this.centeredOnWorld = false;
      this.productionDistrictCentered = false;
    }
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

  private pushDiagnostic(message: string): void {
    this.diagnostics.push(message);
    if (this.diagnostics.length > MAX_ASSET_DIAGNOSTICS) this.diagnostics.shift();
  }

  private canvasCenter(): RenderPoint {
    const rect = this.canvas.getBoundingClientRect();
    return Object.freeze({ x: rect.width * 0.5, y: rect.height * 0.5 });
  }
}
