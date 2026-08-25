import {
  DEFAULT_ISO_METRICS,
  diamondContains,
  inverseProjectPoint,
  inverseRotateWorldPoint,
  projectRotatedPoint,
  rotateWorldPoint,
  rotatedWorldSize,
  type IsoMetrics,
  type Point,
  type QuarterTurn,
  type WorldSize,
} from './IsometricProjection.ts';

export class IsometricCamera {
  private readonly metrics: IsoMetrics;
  private zoomValue = 1;
  private quarterTurnValue: QuarterTurn = 0;
  private panX = 36;
  private panY = 36;

  constructor(metrics: IsoMetrics = DEFAULT_ISO_METRICS) {
    if (!(metrics.tileWidth > 0) || !(metrics.tileHeight > 0)) throw new Error('isometric tile metrics must be positive');
    this.metrics = metrics;
  }

  get zoom(): number { return this.zoomValue; }
  get quarterTurns(): QuarterTurn { return this.quarterTurnValue; }
  get tileWidth(): number { return this.metrics.tileWidth * this.zoomValue; }
  get tileHeight(): number { return this.metrics.tileHeight * this.zoomValue; }

  pan(dx: number, dy: number): void {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    this.panX += dx;
    this.panY += dy;
  }

  zoomBy(factor: number, anchorX: number, anchorY: number): void {
    if (!(factor > 0) || !Number.isFinite(factor) || !Number.isFinite(anchorX) || !Number.isFinite(anchorY)) return;
    const before = this.zoomValue;
    const next = Math.max(0.45, Math.min(2.5, before * factor));
    if (next === before) return;
    const ratio = next / before;
    this.zoomValue = next;
    this.panX = anchorX - (anchorX - this.panX) * ratio;
    this.panY = anchorY - (anchorY - this.panY) * ratio;
  }

  rotate(direction: -1 | 1): void {
    this.quarterTurnValue = (((this.quarterTurnValue + direction) % 4 + 4) % 4) as QuarterTurn;
  }

  rotateAroundCanvasPoint(direction: -1 | 1, size: WorldSize, anchor: Point): void {
    if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
      this.rotate(direction);
      return;
    }
    const worldAnchor = this.canvasToWorldPoint(anchor.x, anchor.y, size);
    this.rotate(direction);
    const after = this.worldToCanvas(worldAnchor.x, worldAnchor.y, size);
    this.panX += anchor.x - after.x;
    this.panY += anchor.y - after.y;
  }

  worldToCanvas(x: number, y: number, size: WorldSize): Point {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: Number.NaN, y: Number.NaN };
    const rotated = rotateWorldPoint(x, y, size, this.quarterTurnValue);
    const projected = projectRotatedPoint(rotated.x, rotated.y, this.metrics);
    const offset = this.logicalMapOffset(size);
    return {
      x: this.panX + (offset.x + projected.x) * this.zoomValue,
      y: this.panY + (offset.y + projected.y) * this.zoomValue,
    };
  }

  canvasToCell(canvasX: number, canvasY: number, size: WorldSize): { x: number; y: number } | null {
    if (!Number.isFinite(canvasX) || !Number.isFinite(canvasY)) return null;
    const offset = this.logicalMapOffset(size);
    const logicalX = (canvasX - this.panX) / this.zoomValue - offset.x;
    const logicalY = (canvasY - this.panY) / this.zoomValue - offset.y;
    const continuous = inverseProjectPoint(logicalX, logicalY, this.metrics);
    const rx = Math.floor(continuous.x + 0.5);
    const ry = Math.floor(continuous.y + 0.5);
    const rotatedSize = rotatedWorldSize(size, this.quarterTurnValue);
    if (rx < 0 || ry < 0 || rx >= rotatedSize.width || ry >= rotatedSize.height) return null;

    const center = projectRotatedPoint(rx, ry, this.metrics);
    if (!diamondContains(logicalX - center.x, logicalY - center.y, this.metrics)) return null;
    const world = inverseRotateWorldPoint(rx, ry, size, this.quarterTurnValue);
    const x = Math.round(world.x);
    const y = Math.round(world.y);
    return x >= 0 && y >= 0 && x < size.width && y < size.height ? { x, y } : null;
  }

  tileCenter(x: number, y: number, size: WorldSize): Point {
    return this.worldToCanvas(x, y, size);
  }

  tilePolygon(x: number, y: number, size: WorldSize): readonly Point[] {
    const center = this.tileCenter(x, y, size);
    const halfW = this.tileWidth / 2;
    const halfH = this.tileHeight / 2;
    return Object.freeze([
      { x: center.x, y: center.y - halfH },
      { x: center.x + halfW, y: center.y },
      { x: center.x, y: center.y + halfH },
      { x: center.x - halfW, y: center.y },
    ]);
  }

  private canvasToWorldPoint(canvasX: number, canvasY: number, size: WorldSize): Point {
    const offset = this.logicalMapOffset(size);
    const logicalX = (canvasX - this.panX) / this.zoomValue - offset.x;
    const logicalY = (canvasY - this.panY) / this.zoomValue - offset.y;
    const rotated = inverseProjectPoint(logicalX, logicalY, this.metrics);
    return inverseRotateWorldPoint(rotated.x, rotated.y, size, this.quarterTurnValue);
  }

  private logicalMapOffset(size: WorldSize): Point {
    const rotated = rotatedWorldSize(size, this.quarterTurnValue);
    return {
      x: rotated.height * this.metrics.tileWidth / 2,
      y: this.metrics.tileHeight / 2,
    };
  }
}
