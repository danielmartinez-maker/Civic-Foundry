import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import type { Node } from '@babylonjs/core/node.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { AssetLod } from '../assets/AssetCatalogV2.ts';
import type { AssetId } from '../assets/AssetManifestV2.ts';
import type {
  BabylonGlbPrototype,
  BabylonPrototypeInstance,
} from '../assets/BabylonGlbPrototypeLoader.ts';
import type { ProductionVisualState } from '../presentation/PresentationTypes.ts';
import type { ProductionSceneAdapter } from './ProductionSceneLayer.ts';

export type ProductionPickIdentity = Readonly<{
  presentationId: ProductionVisualState['presentationId'];
  canonicalId: string;
}>;

export type BabylonProductionHandle = Readonly<{
  presentationId: ProductionVisualState['presentationId'];
  root: TransformNode;
}>;

type InternalProductionHandle = {
  presentationId: ProductionVisualState['presentationId'];
  root: TransformNode;
  instance: BabylonPrototypeInstance;
  identity: ProductionPickIdentity;
  disposed: boolean;
};

export type BabylonProductionPrototypeResolver = (
  assetId: AssetId,
  lod: AssetLod,
) => BabylonGlbPrototype;

function frozenIdentity(identity: ProductionPickIdentity): ProductionPickIdentity {
  return Object.freeze({ presentationId: identity.presentationId, canonicalId: identity.canonicalId });
}

function identityFor(state: ProductionVisualState): ProductionPickIdentity {
  return frozenIdentity({ presentationId: state.presentationId, canonicalId: state.canonicalId });
}

export function bindProductionPickIdentity(root: Node, identity: ProductionPickIdentity): void {
  const metadata = frozenIdentity(identity);
  root.metadata = metadata;
  for (const descendant of root.getDescendants(false)) {
    descendant.metadata = metadata;
  }
}

export function resolveProductionPresentationId(node: Node | null | undefined): ProductionVisualState['presentationId'] | null {
  let cursor: Node | null | undefined = node;
  while (cursor) {
    const metadata = cursor.metadata as Partial<ProductionPickIdentity> | null | undefined;
    if (metadata && typeof metadata.presentationId === 'string') {
      return metadata.presentationId as ProductionVisualState['presentationId'];
    }
    cursor = cursor.parent;
  }
  return null;
}

export class BabylonProductionSceneAdapter implements ProductionSceneAdapter<BabylonProductionHandle> {
  private readonly scene: Scene;
  private readonly resolvePrototype: BabylonProductionPrototypeResolver;
  private readonly handles = new Map<ProductionVisualState['presentationId'], InternalProductionHandle>();

  constructor(scene: Scene, resolvePrototype: BabylonProductionPrototypeResolver) {
    this.scene = scene;
    this.resolvePrototype = resolvePrototype;
  }

  create(input: Parameters<ProductionSceneAdapter<BabylonProductionHandle>['create']>[0]): BabylonProductionHandle {
    const { state, asset, lod } = input;
    const prototype = this.resolvePrototype(asset.assetId, lod);
    const root = new TransformNode(`${state.presentationId}:production-root`, this.scene);
    root.position.set(state.transform.positionM.x, state.transform.positionM.y, state.transform.positionM.z);
    root.rotation.y = state.transform.rotationY;
    root.scaling.set(state.transform.scale.x, state.transform.scale.y, state.transform.scale.z);

    let instance: BabylonPrototypeInstance | null = null;
    try {
      instance = prototype.instantiate(state.presentationId);
      for (const instanceRoot of instance.rootNodes) instanceRoot.parent = root;
      const identity = identityFor(state);
      bindProductionPickIdentity(root, identity);
      const handle: InternalProductionHandle = {
        presentationId: state.presentationId,
        root,
        instance,
        identity,
        disposed: false,
      };
      this.handles.set(state.presentationId, handle);
      return handle;
    } catch (error) {
      instance?.dispose();
      root.dispose(false, false);
      throw error;
    }
  }

  updateAppearance(handle: BabylonProductionHandle, state: ProductionVisualState): void {
    const internal = handle as InternalProductionHandle;
    if (internal.disposed) return;
    internal.identity = identityFor(state);
    bindProductionPickIdentity(internal.root, internal.identity);
  }

  destroy(handle: BabylonProductionHandle): void {
    const internal = handle as InternalProductionHandle;
    if (internal.disposed) return;
    internal.disposed = true;
    this.handles.delete(internal.presentationId);
    internal.instance.dispose();
    internal.root.dispose(false, false);
  }

  debugPickIdentities(): readonly ProductionPickIdentity[] {
    return Object.freeze(
      [...this.handles.values()]
        .filter((handle) => !handle.disposed)
        .sort((left, right) => left.presentationId.localeCompare(right.presentationId))
        .map((handle) => frozenIdentity(handle.identity)),
    );
  }
}
