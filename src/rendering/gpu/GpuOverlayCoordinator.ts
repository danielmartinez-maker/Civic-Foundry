import { Container, Graphics, Text } from 'pixi.js';
import type { SimulationCore } from '../../simulation/core/SimulationCore.ts';
import { LEGACY_CELL_SIZE_METERS } from '../../world/cadastre/Geometry.ts';
import type { EconomyOverlayMode } from '../EconomyOverlayLayer.ts';
import type { ServiceOverlayMode } from '../ServiceOverlayLayer.ts';
import type { TrafficOverlayMode } from '../TrafficOverlayLayer.ts';
import type { TransitOverlayMode } from '../TransitOverlayLayer.ts';
import type { UrbanFabricOverlayMode } from '../CadastralOverlayLayer.ts';
import type { IsometricCamera } from '../isometric/IsometricCamera.ts';
import {
  buildCadastralOverlayCommands,
  buildEconomyOverlayCommands,
  buildServiceOverlayCommands,
  buildTrafficOverlayCommands,
  buildTransitOverlayCommands,
  buildZoningEnvelopeCommands,
} from './GpuOverlayCommands.ts';
import type { GpuOverlayCommand, GpuOverlayPoint } from './GpuOverlayTypes.ts';

export type RetainedOverlayFamilyOptions<T> = Readonly<{
  maxPoolSize: number;
  create: (command: GpuOverlayCommand) => T;
  apply: (value: T, command: GpuOverlayCommand) => void;
  release?: (value: T) => void;
  dispose?: (value: T) => void;
  fingerprint?: (command: GpuOverlayCommand) => string;
}>;

export type RetainedOverlayEntry<T> = Readonly<{
  command: GpuOverlayCommand;
  value: T;
}>;

export type RetainedOverlayFamilyStats = Readonly<{
  active: number;
  created: number;
  updated: number;
  recycled: number;
  pooled: number;
}>;

type ActiveEntry<T> = {
  command: GpuOverlayCommand;
  fingerprint: string;
  value: T;
};

export class RetainedOverlayFamily<T> {
  private options: RetainedOverlayFamilyOptions<T>;
  private activeByKey = new Map<string, ActiveEntry<T>>();
  private pool: T[] = [];
  private createdCount = 0;
  private updatedCount = 0;
  private recycledCount = 0;

  constructor(options: RetainedOverlayFamilyOptions<T>) {
    if (!Number.isInteger(options.maxPoolSize) || options.maxPoolSize < 0) {
      throw new Error(`Overlay pool size must be a non-negative integer, got ${options.maxPoolSize}`);
    }
    this.options = options;
  }

  sync(
    commands: readonly GpuOverlayCommand[],
    fingerprintSalt = '',
  ): readonly RetainedOverlayEntry<T>[] {
    const commandKeys = new Set<string>();
    for (const command of commands) {
      if (commandKeys.has(command.key)) {
        throw new Error(`Duplicate retained overlay key: ${command.key}`);
      }
      commandKeys.add(command.key);
    }

    for (const [key, entry] of this.activeByKey) {
      if (commandKeys.has(key)) continue;
      this.activeByKey.delete(key);
      this.options.release?.(entry.value);
      if (this.pool.length < this.options.maxPoolSize) {
        this.pool.push(entry.value);
      } else {
        this.options.dispose?.(entry.value);
      }
    }

    const result: RetainedOverlayEntry<T>[] = [];
    for (const command of commands) {
      const fingerprint = `${fingerprintSalt}|${this.fingerprint(command)}`;
      const existing = this.activeByKey.get(command.key);
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          this.options.apply(existing.value, command);
          existing.command = command;
          existing.fingerprint = fingerprint;
          this.updatedCount += 1;
        }
        result.push({ command, value: existing.value });
        continue;
      }

      let value: T;
      const pooled = this.pool.pop();
      if (pooled !== undefined) {
        value = pooled;
        this.recycledCount += 1;
      } else {
        value = this.options.create(command);
        this.createdCount += 1;
      }
      this.options.apply(value, command);
      this.activeByKey.set(command.key, { command, fingerprint, value });
      result.push({ command, value });
    }

    return result;
  }

  stats(): RetainedOverlayFamilyStats {
    return {
      active: this.activeByKey.size,
      created: this.createdCount,
      updated: this.updatedCount,
      recycled: this.recycledCount,
      pooled: this.pool.length,
    };
  }

  clear(): void {
    for (const entry of this.activeByKey.values()) {
      this.options.dispose?.(entry.value);
    }
    for (const value of this.pool) {
      this.options.dispose?.(value);
    }
    this.activeByKey.clear();
    this.pool = [];
  }

  private fingerprint(command: GpuOverlayCommand): string {
    return this.options.fingerprint?.(command) ?? JSON.stringify(command);
  }
}

type OverlayWorldSize = Readonly<{ width: number; height: number }>;
type ProjectionContext = Readonly<{
  camera: IsometricCamera;
  size: OverlayWorldSize;
}>;

export type GpuOverlayLayerStats = RetainedOverlayFamilyStats;

export type GpuOverlayCoordinatorStats = Readonly<{
  traffic: GpuOverlayLayerStats;
  service: GpuOverlayLayerStats;
  transit: GpuOverlayLayerStats;
  economy: GpuOverlayLayerStats;
  cadastre: GpuOverlayLayerStats;
  zoningEnvelope: GpuOverlayLayerStats;
}>;

export type GpuOverlaySyncOptions = Readonly<{
  core: SimulationCore;
  camera: IsometricCamera;
  size: OverlayWorldSize;
  trafficMode: TrafficOverlayMode;
  serviceMode: ServiceOverlayMode;
  transitMode: TransitOverlayMode;
  economyMode: EconomyOverlayMode;
  urbanFabricMode: UrbanFabricOverlayMode;
  selectedParcelId: string | null;
}>;

class OverlayDisplayFamily {
  readonly container = new Container();
  private readonly graphicsContainer = new Container();
  private readonly textContainer = new Container();
  private readonly graphicsFamily: RetainedOverlayFamily<Graphics>;
  private readonly textFamily: RetainedOverlayFamily<Text>;
  private context: ProjectionContext | null = null;

  constructor(maxGraphicsPool = 512, maxTextPool = 128) {
    this.container.addChild(this.graphicsContainer, this.textContainer);
    this.graphicsFamily = new RetainedOverlayFamily<Graphics>({
      maxPoolSize: maxGraphicsPool,
      create: () => {
        const graphics = new Graphics();
        this.graphicsContainer.addChild(graphics);
        return graphics;
      },
      apply: (graphics, command) => this.applyGraphics(graphics, command),
      release: (graphics) => {
        graphics.visible = false;
      },
      dispose: (graphics) => {
        graphics.parent?.removeChild(graphics);
        graphics.destroy();
      },
    });
    this.textFamily = new RetainedOverlayFamily<Text>({
      maxPoolSize: maxTextPool,
      create: () => {
        const text = new Text({
          text: '',
          style: {
            fontFamily: 'system-ui, sans-serif',
            fontSize: 14,
            fontWeight: '700',
            fill: '#f4fbff',
            stroke: { color: '#11171b', width: 3 },
          },
        });
        text.anchor.set(0.5);
        this.textContainer.addChild(text);
        return text;
      },
      apply: (text, command) => this.applyText(text, command),
      release: (text) => {
        text.visible = false;
      },
      dispose: (text) => {
        text.parent?.removeChild(text);
        text.destroy();
      },
    });
  }

  sync(commands: readonly GpuOverlayCommand[], context: ProjectionContext, salt: string): void {
    this.context = context;
    this.graphicsFamily.sync(
      commands.filter((command) => command.kind !== 'label'),
      salt,
    );
    this.textFamily.sync(
      commands.filter((command) => command.kind === 'label'),
      salt,
    );
  }

  stats(): GpuOverlayLayerStats {
    return combineStats(this.graphicsFamily.stats(), this.textFamily.stats());
  }

  private applyGraphics(graphics: Graphics, command: GpuOverlayCommand): void {
    const context = this.requireContext();
    graphics.clear();
    graphics.visible = true;

    if (command.kind === 'cell') {
      const points = context.camera.tilePolygon(command.x, command.y, context.size);
      graphics.poly(points.flatMap((point) => [point.x, point.y])).fill({
        color: command.fill,
        alpha: command.alpha,
      });
      return;
    }

    if (command.kind === 'segment') {
      const from = projectPoint(command.from, command.key, context);
      const to = projectPoint(command.to, command.key, context);
      const width = command.key.startsWith('cadastre:')
        ? command.widthFactor
        : Math.max(2, context.camera.tileWidth * command.widthFactor);
      drawSegment(graphics, from, to, command.color, width, command.dash);
      return;
    }

    if (command.kind === 'ring') {
      const points = command.points.map((point) => projectPoint(point, command.key, context));
      if (points.length < 3) return;
      const flat = points.flatMap((point) => [point.x, point.y]);
      if (command.fill) {
        graphics.poly(flat).fill({ color: command.fill, alpha: command.fillAlpha ?? 1 });
      }
      if (command.stroke && command.strokeWidth > 0) {
        const closed = [...points, points[0]!];
        graphics
          .poly(closed.flatMap((point) => [point.x, point.y]))
          .stroke({ color: command.stroke, width: command.strokeWidth, alpha: 1 });
      }
      return;
    }

    if (command.kind === 'marker') {
      const point = projectPoint({ x: command.x, y: command.y }, command.key, context);
      const radius = Math.max(3, context.camera.tileWidth * 0.08);
      if (command.marker === 'gateway') {
        graphics
          .poly([
            point.x,
            point.y - radius,
            point.x + radius,
            point.y,
            point.x,
            point.y + radius,
            point.x - radius,
            point.y,
          ])
          .fill({ color: command.color, alpha: 0.92 })
          .stroke({ color: '#182126', width: 1.5, alpha: 0.9 });
        return;
      }
      if (command.marker === 'metro-station') {
        graphics
          .rect(point.x - radius, point.y - radius, radius * 2, radius * 2)
          .fill({ color: command.color, alpha: 0.92 })
          .stroke({ color: '#182126', width: 1.5, alpha: 0.9 });
        return;
      }
      graphics
        .circle(point.x, point.y, radius)
        .fill({ color: command.color, alpha: 0.92 })
        .stroke({ color: '#182126', width: 1.5, alpha: 0.9 });
    }
  }

  private applyText(text: Text, command: GpuOverlayCommand): void {
    if (command.kind !== 'label') return;
    const context = this.requireContext();
    const point = projectPoint({ x: command.x, y: command.y }, command.key, context);
    text.text = command.text;
    text.position.set(point.x, point.y);
    text.visible = context.camera.tileWidth >= command.minTileWidth;
    const targetSize = command.key.startsWith('zoning-envelope:')
      ? Math.max(10, context.camera.tileWidth * 0.16)
      : Math.max(8, context.camera.tileWidth * 0.14);
    const scale = targetSize / 14;
    text.scale.set(scale);
  }

  private requireContext(): ProjectionContext {
    if (!this.context) throw new Error('Overlay projection context is unavailable');
    return this.context;
  }
}

export class GpuOverlayCoordinator {
  readonly container = new Container();
  private readonly transit = new OverlayDisplayFamily(256, 128);
  private readonly service = new OverlayDisplayFamily(512, 256);
  private readonly traffic = new OverlayDisplayFamily(1024, 0);
  private readonly economy = new OverlayDisplayFamily(1024, 256);
  private readonly cadastre = new OverlayDisplayFamily(2048, 0);
  private readonly zoningEnvelope = new OverlayDisplayFamily(64, 16);

  constructor() {
    this.container.addChild(
      this.transit.container,
      this.service.container,
      this.traffic.container,
      this.economy.container,
      this.cadastre.container,
      this.zoningEnvelope.container,
    );
  }

  sync(options: GpuOverlaySyncOptions): void {
    const context = { camera: options.camera, size: options.size };
    const salt = cameraFingerprint(options.camera, options.size);

    this.transit.sync(
      buildTransitOverlayCommands(options.core, options.transitMode),
      context,
      salt,
    );
    this.service.sync(
      options.serviceMode === 'none'
        ? []
        : buildServiceOverlayCommands(options.core, options.serviceMode),
      context,
      salt,
    );
    this.traffic.sync(
      options.trafficMode === 'none'
        ? []
        : buildTrafficOverlayCommands(options.core, options.trafficMode),
      context,
      salt,
    );
    this.economy.sync(
      options.economyMode === 'none'
        ? []
        : buildEconomyOverlayCommands(options.core, options.economyMode),
      context,
      salt,
    );
    this.cadastre.sync(
      options.urbanFabricMode === 'cadastre'
        ? buildCadastralOverlayCommands(options.core, options.selectedParcelId)
        : [],
      context,
      salt,
    );
    this.zoningEnvelope.sync(
      options.urbanFabricMode === 'zoning-envelope'
        ? buildZoningEnvelopeCommands(options.core, options.selectedParcelId)
        : [],
      context,
      salt,
    );
  }

  stats(): GpuOverlayCoordinatorStats {
    return Object.freeze({
      traffic: this.traffic.stats(),
      service: this.service.stats(),
      transit: this.transit.stats(),
      economy: this.economy.stats(),
      cadastre: this.cadastre.stats(),
      zoningEnvelope: this.zoningEnvelope.stats(),
    });
  }
}

function combineStats(
  first: RetainedOverlayFamilyStats,
  second: RetainedOverlayFamilyStats,
): RetainedOverlayFamilyStats {
  return Object.freeze({
    active: first.active + second.active,
    created: first.created + second.created,
    updated: first.updated + second.updated,
    recycled: first.recycled + second.recycled,
    pooled: first.pooled + second.pooled,
  });
}

function cameraFingerprint(camera: IsometricCamera, size: OverlayWorldSize): string {
  const origin = camera.worldToCanvas(0, 0, size);
  const far = camera.worldToCanvas(size.width, size.height, size);
  return [
    camera.tileWidth.toFixed(4),
    camera.quarterTurns,
    origin.x.toFixed(3),
    origin.y.toFixed(3),
    far.x.toFixed(3),
    far.y.toFixed(3),
  ].join(':');
}

function projectPoint(
  point: GpuOverlayPoint,
  key: string,
  context: ProjectionContext,
): GpuOverlayPoint {
  const meterBased = key.startsWith('cadastre:') || key.startsWith('zoning-envelope:');
  const x = meterBased ? point.x / LEGACY_CELL_SIZE_METERS : point.x;
  const y = meterBased ? point.y / LEGACY_CELL_SIZE_METERS : point.y;
  return context.camera.worldToCanvas(x, y, context.size);
}

function drawSegment(
  graphics: Graphics,
  from: GpuOverlayPoint,
  to: GpuOverlayPoint,
  color: string,
  width: number,
  dash: readonly number[] | undefined,
): void {
  if (!dash || dash.length === 0) {
    graphics.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke({ color, width, alpha: 0.9 });
    return;
  }

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length <= 0) return;
  const unitX = dx / length;
  const unitY = dy / length;
  let distance = 0;
  let dashIndex = 0;
  let drawing = true;
  while (distance < length) {
    const span = Math.max(0.1, dash[dashIndex % dash.length] ?? 1);
    const next = Math.min(length, distance + span);
    if (drawing) {
      graphics
        .moveTo(from.x + unitX * distance, from.y + unitY * distance)
        .lineTo(from.x + unitX * next, from.y + unitY * next);
    }
    distance = next;
    dashIndex += 1;
    drawing = !drawing;
  }
  graphics.stroke({ color, width, alpha: 0.9 });
}
