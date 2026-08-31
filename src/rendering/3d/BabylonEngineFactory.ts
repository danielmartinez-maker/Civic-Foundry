import { Engine } from '@babylonjs/core/Engines/engine.js';
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine.js';

export type BabylonEngineBackend = 'webgpu' | 'webgl';

export type BabylonEngineAdapters<TWebGpu, TWebGl> = Readonly<{
  webGpuSupported: () => Promise<boolean>;
  createWebGpu: (canvas: HTMLCanvasElement) => Promise<TWebGpu>;
  createWebGl: (canvas: HTMLCanvasElement) => TWebGl;
}>;

export type BabylonEngineResult<TEngine> = Readonly<{
  engine: TEngine;
  backend: BabylonEngineBackend;
  diagnostics: readonly string[];
}>;

const defaultAdapters: BabylonEngineAdapters<WebGPUEngine, Engine> = Object.freeze({
  webGpuSupported: async (): Promise<boolean> => await WebGPUEngine.IsSupportedAsync,
  createWebGpu: async (canvas: HTMLCanvasElement): Promise<WebGPUEngine> => {
    const engine = new WebGPUEngine(canvas, {
      antialias: true,
      adaptToDeviceRatio: true,
    });
    await engine.initAsync();
    return engine;
  },
  createWebGl: (canvas: HTMLCanvasElement): Engine =>
    new Engine(canvas, true, {
      preserveDrawingBuffer: false,
      stencil: true,
      adaptToDeviceRatio: true,
      powerPreference: 'high-performance',
    }),
});

function diagnosticMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function createBabylonEngine<TWebGpu = WebGPUEngine, TWebGl = Engine>(
  canvas: HTMLCanvasElement,
  adapters: BabylonEngineAdapters<TWebGpu, TWebGl> = defaultAdapters as BabylonEngineAdapters<TWebGpu, TWebGl>,
): Promise<BabylonEngineResult<TWebGpu | TWebGl>> {
  const diagnostics: string[] = [];
  let webGpuSupported = false;

  try {
    webGpuSupported = await adapters.webGpuSupported();
  } catch (error) {
    diagnostics.push(`WebGPU support check failed: ${diagnosticMessage(error)}`);
  }

  if (webGpuSupported) {
    try {
      const engine = await adapters.createWebGpu(canvas);
      return Object.freeze({
        engine,
        backend: 'webgpu' as const,
        diagnostics: Object.freeze(diagnostics),
      });
    } catch (error) {
      diagnostics.push(`WebGPU initialization failed: ${diagnosticMessage(error)}`);
    }
  }

  return Object.freeze({
    engine: adapters.createWebGl(canvas),
    backend: 'webgl' as const,
    diagnostics: Object.freeze(diagnostics),
  });
}
