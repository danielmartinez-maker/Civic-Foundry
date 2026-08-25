import type { AssetResolution } from './AssetTypes.ts';

export class SpritePainter {
  draw(
    ctx: CanvasRenderingContext2D,
    resolution: AssetResolution,
    anchor: Readonly<{ x: number; y: number }>,
    displayScale: number,
    fallback: Readonly<{ footprintWidth: number; footprintHeight: number; label?: string }>,
  ): void {
    if (resolution.kind === 'sprite') {
      const { entry, image } = resolution;
      const source = entry.sourceRect;
      const dx = anchor.x - entry.anchor.x * displayScale;
      const dy = anchor.y - entry.anchor.y * displayScale;
      ctx.drawImage(image, source.x, source.y, source.width, source.height, dx, dy, source.width * displayScale, source.height * displayScale);
      return;
    }

    const halfW = 64 * displayScale * Math.max(1, fallback.footprintWidth);
    const halfH = 32 * displayScale * Math.max(1, fallback.footprintHeight);
    ctx.save();
    ctx.fillStyle = 'rgba(92,104,111,.72)';
    ctx.strokeStyle = 'rgba(235,241,243,.86)';
    ctx.lineWidth = Math.max(1, 2 * displayScale);
    ctx.beginPath();
    ctx.moveTo(anchor.x, anchor.y - halfH);
    ctx.lineTo(anchor.x + halfW, anchor.y);
    ctx.lineTo(anchor.x, anchor.y + halfH);
    ctx.lineTo(anchor.x - halfW, anchor.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (fallback.label && displayScale >= 0.35) {
      ctx.fillStyle = '#f2f5f6';
      ctx.font = `${Math.max(8, 18 * displayScale)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(fallback.label.slice(0, 2).toUpperCase(), anchor.x, anchor.y);
    }
    ctx.restore();
  }
}
