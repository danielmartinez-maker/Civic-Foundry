import type { SimulationCore } from '../../simulation/core/SimulationCore.ts';
import type { CellSelection } from '../WorldRenderer.ts';
import { IsometricCamera } from '../isometric/IsometricCamera.ts';
import { fillCell, strokeCell } from '../isometric/IsometricOverlayPainter.ts';

export class SelectionRenderPass {
  draw(ctx: CanvasRenderingContext2D, core: SimulationCore, camera: IsometricCamera, selected: CellSelection, previewPath: readonly { x: number; y: number }[]): void {
    const size = { width: core.terrain.width, height: core.terrain.height };
    if (previewPath.length > 0) {
      for (const cell of previewPath) fillCell(ctx, camera, cell.x, cell.y, size, 'rgba(232,242,245,.38)');
    }
    if (selected) strokeCell(ctx, camera, selected.x, selected.y, size, '#ffffff', 2);
  }
}
