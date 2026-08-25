import { IsometricCamera } from './IsometricCamera.ts';
import type { WorldSize } from './IsometricProjection.ts';

export function fillCell(ctx: CanvasRenderingContext2D, camera: IsometricCamera, x: number, y: number, worldSize: WorldSize, fillStyle: string): void {
  const points = camera.tilePolygon(x, y, worldSize);
  ctx.save();
  ctx.fillStyle = fillStyle;
  ctx.beginPath();
  ctx.moveTo(points[0]!.x, points[0]!.y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i]!.x, points[i]!.y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function strokeCell(ctx: CanvasRenderingContext2D, camera: IsometricCamera, x: number, y: number, worldSize: WorldSize, strokeStyle: string, lineWidth: number): void {
  const points = camera.tilePolygon(x, y, worldSize);
  ctx.save();
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(points[0]!.x, points[0]!.y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i]!.x, points[i]!.y);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

export function strokeWorldSegment(
  ctx: CanvasRenderingContext2D,
  camera: IsometricCamera,
  a: Readonly<{ x: number; y: number }>,
  b: Readonly<{ x: number; y: number }>,
  worldSize: WorldSize,
  strokeStyle: string,
  lineWidth: number,
  dash: readonly number[] = [],
): void {
  const pa = camera.worldToCanvas(a.x, a.y, worldSize);
  const pb = camera.worldToCanvas(b.x, b.y, worldSize);
  ctx.save();
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash([...dash]);
  ctx.beginPath();
  ctx.moveTo(pa.x, pa.y);
  ctx.lineTo(pb.x, pb.y);
  ctx.stroke();
  ctx.restore();
}

export function drawLabelAtCell(ctx: CanvasRenderingContext2D, camera: IsometricCamera, x: number, y: number, worldSize: WorldSize, label: string, font: string): void {
  const point = camera.tileCenter(x, y, worldSize);
  ctx.save();
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = 'rgba(0,0,0,.72)';
  ctx.lineWidth = 2;
  ctx.fillStyle = '#ffffff';
  ctx.strokeText(label, point.x, point.y);
  ctx.fillText(label, point.x, point.y);
  ctx.restore();
}
