import '@babylonjs/loaders/glTF/index.js';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import type { Node } from '@babylonjs/core/node.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { AssetPrototypeLoadRequest } from './AssetStreamingManager.ts';

export type BabylonPrototypeInstance = Readonly<{
  rootNodes: readonly Node[];
  dispose(): void;
}>;

type Disposable = Readonly<{ dispose(): void }>;

type BabylonInstantiatedEntriesLike = Readonly<{
  rootNodes: readonly Node[];
  skeletons?: readonly Disposable[];
  animationGroups?: readonly Disposable[];
  dispose?: () => void;
}>;

type BabylonAssetContainerLike = Readonly<{
  instantiateModelsToScene(
    nameFunction?: (sourceName: string) => string,
    cloneMaterials?: boolean,
  ): BabylonInstantiatedEntriesLike;
  dispose(): void;
}>;

export type BabylonGlbLoaderAdapter = Readonly<{
  loadAssetContainerAsync(
    rootUrl: string,
    fileName: string,
    scene: Scene,
  ): Promise<BabylonAssetContainerLike>;
}>;

const DEFAULT_ADAPTER: BabylonGlbLoaderAdapter = Object.freeze({
  loadAssetContainerAsync: async (
    rootUrl: string,
    fileName: string,
    scene: Scene,
  ): Promise<BabylonAssetContainerLike> => await LoadAssetContainerAsync(fileName, scene, { rootUrl }),
});

function splitRuntimeUrl(url: string): Readonly<{ rootUrl: string; fileName: string }> {
  const normalized = url.trim();
  if (normalized.length === 0) throw new Error('GLB runtime URL must be non-empty');
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalized) || normalized.startsWith('/') || normalized.includes('..')) {
    throw new Error(`GLB runtime URL '${url}' must be runtime-relative`);
  }

  const slash = normalized.lastIndexOf('/');
  const rootUrl = slash >= 0 ? normalized.slice(0, slash + 1) : '';
  const fileName = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  if (fileName.length === 0) throw new Error(`GLB runtime URL '${url}' is missing a file name`);
  return Object.freeze({ rootUrl, fileName });
}

function disposeInstantiatedEntries(entries: BabylonInstantiatedEntriesLike): void {
  if (entries.dispose) {
    entries.dispose();
    return;
  }

  for (const group of [...(entries.animationGroups ?? [])].reverse()) group.dispose();
  for (const skeleton of [...(entries.skeletons ?? [])].reverse()) skeleton.dispose();
  for (const node of [...entries.rootNodes].reverse()) node.dispose();
}

export class BabylonGlbPrototype {
  readonly key: string;
  private readonly container: BabylonAssetContainerLike;
  private disposed = false;

  constructor(key: string, container: BabylonAssetContainerLike) {
    this.key = key;
    this.container = container;
  }

  instantiate(namePrefix: string): BabylonPrototypeInstance {
    if (this.disposed) throw new Error(`Babylon GLB prototype '${this.key}' is disposed`);
    const prefix = namePrefix.trim();
    if (prefix.length === 0) throw new Error('Babylon GLB instance name prefix must be non-empty');

    const entries = this.container.instantiateModelsToScene(
      (sourceName: string): string => `${prefix}:${sourceName}`,
      false,
    );
    let instanceDisposed = false;
    return Object.freeze({
      rootNodes: Object.freeze([...entries.rootNodes]),
      dispose: (): void => {
        if (instanceDisposed) return;
        instanceDisposed = true;
        disposeInstantiatedEntries(entries);
      },
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.container.dispose();
  }
}

export class BabylonGlbPrototypeLoader {
  private readonly scene: Scene;
  private readonly adapter: BabylonGlbLoaderAdapter;

  constructor(scene: Scene, adapter: BabylonGlbLoaderAdapter = DEFAULT_ADAPTER) {
    this.scene = scene;
    this.adapter = adapter;
  }

  async load(request: AssetPrototypeLoadRequest): Promise<BabylonGlbPrototype> {
    const { rootUrl, fileName } = splitRuntimeUrl(request.url);
    const container = await this.adapter.loadAssetContainerAsync(rootUrl, fileName, this.scene);
    return new BabylonGlbPrototype(request.key, container);
  }
}
