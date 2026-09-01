import type { Node } from '@babylonjs/core/node.js';
import type { ProductionVisualState } from '../presentation/PresentationTypes.ts';

export type ProductionPickIdentity = Readonly<{
  presentationId: ProductionVisualState['presentationId'];
  canonicalId: string;
}>;

function frozenIdentity(identity: ProductionPickIdentity): ProductionPickIdentity {
  return Object.freeze({ presentationId: identity.presentationId, canonicalId: identity.canonicalId });
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
