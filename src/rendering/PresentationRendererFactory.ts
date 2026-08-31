import { Civic3DWorldRenderer } from './3d/Civic3DWorldRenderer.ts';
import { GpuWorldRenderer } from './gpu/GpuWorldRenderer.ts';
import type { PresentationBackend, PresentationRenderer } from './PresentationRenderer.ts';

export type { PresentationBackend } from './PresentationRenderer.ts';

export function resolvePresentationBackend(search: string): PresentationBackend {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return params.get('renderer') === 'civic-3d' ? 'civic-3d' : 'legacy-gpu';
}

export function createPresentationRenderer(
  canvas: HTMLCanvasElement,
  backend: PresentationBackend,
): PresentationRenderer {
  return backend === 'civic-3d'
    ? new Civic3DWorldRenderer(canvas)
    : new GpuWorldRenderer(canvas);
}
