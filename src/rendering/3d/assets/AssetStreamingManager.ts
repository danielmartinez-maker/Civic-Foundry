import type { AssetId } from './AssetManifestV2.ts';
import { AssetCatalogV2, type AssetLod } from './AssetCatalogV2.ts';
import { AssetRequestBroker, type AssetRequestPriority } from './AssetRequestBroker.ts';
import { GLBResourceCache } from './GLBResourceCache.ts';
import { ScenePrototypeCache, type DisposableScenePrototype } from './ScenePrototypeCache.ts';

export type AssetLoadFailureKind = 'transient' | 'permanent';

export class AssetLoadError extends Error {
  readonly kind: AssetLoadFailureKind;

  constructor(message: string, kind: AssetLoadFailureKind, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AssetLoadError';
    this.kind = kind;
  }
}

export type AssetPrototypeLoadRequest = Readonly<{
  key: string;
  assetId: AssetId;
  lod: AssetLod;
  url: string;
}>;

export type AssetLease<T> = Readonly<{
  key: string;
  assetId: AssetId;
  lod: AssetLod;
  prototype: T;
  release(): void;
}>;

export type AssetStreamingDiagnostics = Readonly<{
  requestCount: number;
  cacheHits: number;
  cacheMisses: number;
  residentCount: number;
  queuedCount: number;
  activeLoads: number;
}>;

export type AssetStreamingManagerOptions<T extends DisposableScenePrototype> = Readonly<{
  catalog: AssetCatalogV2;
  loader: (request: AssetPrototypeLoadRequest) => Promise<T>;
  maxConcurrent?: number;
}>;

export type AssetStreamingRequest = Readonly<{
  assetId: AssetId;
  lod: AssetLod;
  priority: AssetRequestPriority;
  signal?: AbortSignal;
}>;

function abortError(): DOMException {
  return new DOMException('Asset request aborted', 'AbortError');
}

export class AssetStreamingManager<T extends DisposableScenePrototype> {
  private readonly catalog: AssetCatalogV2;
  private readonly loader: (request: AssetPrototypeLoadRequest) => Promise<T>;
  private readonly broker: AssetRequestBroker<T>;
  private readonly resources = new GLBResourceCache<T>();
  private readonly prototypes = new ScenePrototypeCache<T>();
  private readonly pendingConsumers = new Map<string, number>();
  private requestCount = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private disposed = false;

  constructor(options: AssetStreamingManagerOptions<T>) {
    this.catalog = options.catalog;
    this.loader = options.loader;
    this.broker = new AssetRequestBroker(options.maxConcurrent ?? 4);
  }

  async request(request: AssetStreamingRequest): Promise<AssetLease<T>> {
    this.assertAlive();
    this.requestCount += 1;
    if (request.signal?.aborted) throw abortError();

    const key = `${request.assetId}@${request.lod}`;
    if (this.resources.has(key)) {
      this.cacheHits += 1;
      return this.createLease(key, request.assetId, request.lod, this.resources.acquire(key));
    }

    this.cacheMisses += 1;
    this.incrementPending(key);
    try {
      const prototype = await this.broker.enqueue(key, request.priority, async () => {
        const loaded = await this.loadWithRetry({
          key,
          assetId: request.assetId,
          lod: request.lod,
          url: this.catalog.model(request.assetId, request.lod),
        });
        this.resources.set(key, loaded);
        this.prototypes.set(key, loaded);
        return loaded;
      });

      this.decrementPending(key);
      if (request.signal?.aborted || this.disposed) {
        this.disposeIfUnreferencedAndUnclaimed(key);
        throw abortError();
      }

      const resident = this.resources.get(key) ?? prototype;
      if (!this.resources.has(key)) {
        this.resources.set(key, resident);
        this.prototypes.set(key, resident);
      }
      return this.createLease(key, request.assetId, request.lod, this.resources.acquire(key));
    } catch (error) {
      if ((this.pendingConsumers.get(key) ?? 0) > 0) this.decrementPending(key);
      if (request.signal?.aborted) {
        this.disposeIfUnreferencedAndUnclaimed(key);
        throw abortError();
      }
      throw error;
    }
  }

  debugRefCount(key: string): number {
    return this.resources.refCount(key);
  }

  diagnostics(): AssetStreamingDiagnostics {
    return Object.freeze({
      requestCount: this.requestCount,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      residentCount: this.resources.size,
      queuedCount: this.broker.queuedCount,
      activeLoads: this.broker.activeLoads,
    });
  }

  evict(key: string): boolean {
    this.assertAlive();
    if (this.resources.refCount(key) !== 0) return false;
    const resource = this.resources.evict(key);
    if (!resource) return false;
    return this.prototypes.evict(key);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resources.clear();
    this.prototypes.clear();
    this.pendingConsumers.clear();
  }

  private async loadWithRetry(request: AssetPrototypeLoadRequest): Promise<T> {
    try {
      return await this.loader(request);
    } catch (error) {
      if (!(error instanceof AssetLoadError) || error.kind !== 'transient') throw error;
      return await this.loader(request);
    }
  }

  private createLease(key: string, assetId: AssetId, lod: AssetLod, prototype: T): AssetLease<T> {
    let released = false;
    return Object.freeze({
      key,
      assetId,
      lod,
      prototype,
      release: (): void => {
        if (released) throw new Error(`Asset lease '${key}' was already released`);
        released = true;
        this.resources.release(key);
      },
    });
  }

  private incrementPending(key: string): void {
    this.pendingConsumers.set(key, (this.pendingConsumers.get(key) ?? 0) + 1);
  }

  private decrementPending(key: string): void {
    const next = (this.pendingConsumers.get(key) ?? 0) - 1;
    if (next <= 0) this.pendingConsumers.delete(key);
    else this.pendingConsumers.set(key, next);
  }

  private disposeIfUnreferencedAndUnclaimed(key: string): void {
    if ((this.pendingConsumers.get(key) ?? 0) !== 0 || this.resources.refCount(key) !== 0) return;
    this.resources.evict(key);
    this.prototypes.evict(key);
  }

  private assertAlive(): void {
    if (this.disposed) throw new Error('AssetStreamingManager is disposed');
  }
}
