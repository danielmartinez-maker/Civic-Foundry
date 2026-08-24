import {
  canonicalHandleKey,
  ordinalCompare,
  type EntityHandle,
  type EntityReferenceSemantics,
} from './EntityTypes.ts';
import type { KnownEntityView } from './EntityRegistry.ts';

export type EntityReference = Readonly<{
  source: EntityHandle;
  target: EntityHandle;
  semantics: EntityReferenceSemantics;
  relation: string;
}>;

export type PreparedReferenceGraph = Readonly<{
  references: readonly EntityReference[];
}>;

export type EntityReferenceGraphSnapshot = Readonly<{
  references: readonly EntityReference[];
}>;

function cloneHandle(handle: EntityHandle): EntityHandle {
  return Object.freeze({ ...handle });
}

function cloneReference(reference: EntityReference): EntityReference {
  return Object.freeze({
    source: cloneHandle(reference.source),
    target: cloneHandle(reference.target),
    semantics: reference.semantics,
    relation: reference.relation,
  });
}

function encodePart(value: string): string {
  return `${value.length}:${value}`;
}

function requireRelation(relation: string): string {
  if (relation.trim().length === 0) throw new Error('entity reference relation must not be empty');
  return relation;
}

function canonicalReferenceKey(reference: EntityReference): string {
  return [
    encodePart(canonicalHandleKey(reference.source)),
    encodePart(reference.relation),
    encodePart(reference.semantics),
    encodePart(canonicalHandleKey(reference.target)),
  ].join('|');
}

function compareReference(a: EntityReference, b: EntityReference): number {
  return ordinalCompare(canonicalHandleKey(a.source), canonicalHandleKey(b.source))
    || ordinalCompare(a.relation, b.relation)
    || ordinalCompare(a.semantics, b.semantics)
    || ordinalCompare(canonicalHandleKey(a.target), canonicalHandleKey(b.target));
}

export class EntityReferenceGraph {
  private references: EntityReference[] = [];

  prepare(references: readonly EntityReference[], view: KnownEntityView): PreparedReferenceGraph {
    const normalized = references.map((reference) => {
      requireRelation(reference.relation);
      if (!view.isActive(reference.source)) {
        throw new Error(`entity reference source is not active: ${canonicalHandleKey(reference.source)}`);
      }
      if (reference.semantics === 'strong' || reference.semantics === 'owned') {
        if (!view.isActive(reference.target)) {
          throw new Error(`${reference.semantics} entity reference target is not active: ${canonicalHandleKey(reference.target)}`);
        }
      } else if (reference.semantics === 'weak') {
        if (!view.isKnown(reference.target)) {
          throw new Error(`weak entity reference target is not known: ${canonicalHandleKey(reference.target)}`);
        }
      } else {
        throw new Error('external entity references are diagnostic intents and cannot enter the entity reference graph');
      }
      return cloneReference(reference);
    }).sort(compareReference);

    for (let i = 1; i < normalized.length; i++) {
      if (canonicalReferenceKey(normalized[i - 1]!) === canonicalReferenceKey(normalized[i]!)) {
        throw new Error(`duplicate entity reference: ${canonicalReferenceKey(normalized[i]!)}`);
      }
    }

    return Object.freeze({ references: Object.freeze(normalized) });
  }

  commitPrepared(prepared: PreparedReferenceGraph): void {
    this.references = prepared.references.map(cloneReference).sort(compareReference);
  }

  outgoing(source: EntityHandle): readonly EntityReference[] {
    const sourceKey = canonicalHandleKey(source);
    return Object.freeze(this.references
      .filter((reference) => canonicalHandleKey(reference.source) === sourceKey)
      .map(cloneReference));
  }

  incoming(target: EntityHandle): readonly EntityReference[] {
    const targetKey = canonicalHandleKey(target);
    return Object.freeze(this.references
      .filter((reference) => canonicalHandleKey(reference.target) === targetKey)
      .map(cloneReference));
  }

  list(): readonly EntityReference[] {
    return Object.freeze(this.references.map(cloneReference));
  }

  snapshot(): EntityReferenceGraphSnapshot {
    return Object.freeze({ references: this.list() });
  }
}
