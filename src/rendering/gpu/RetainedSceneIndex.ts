export type RetainedDescriptor = Readonly<{
  key: string;
  fingerprint: string;
}>;

export type RetainedHooks<T> = Readonly<{
  create: (descriptor: RetainedDescriptor) => T;
  update: (value: T, descriptor: RetainedDescriptor, previousFingerprint: string) => void;
  destroy: (value: T, key: string) => void;
}>;

export type RetainedEntry<T> = Readonly<{
  key: string;
  fingerprint: string;
  value: T;
}>;

export type RetainedDelta = Readonly<{
  created: number;
  updated: number;
  removed: number;
}>;

export type RetainedTotals = Readonly<{
  active: number;
  created: number;
  updated: number;
  removed: number;
}>;

export type RetainedSyncResult<T> = Readonly<{
  entries: readonly RetainedEntry<T>[];
  delta: RetainedDelta;
  totals: RetainedTotals;
}>;

type MutableRetainedEntry<T> = {
  fingerprint: string;
  value: T;
};

/**
 * Presentation-only keyed lifecycle bookkeeping.
 *
 * The index knows only presentation keys/fingerprints and owns no simulation
 * state. Callers supply lifecycle hooks for concrete display objects.
 */
export class RetainedSceneIndex<T> {
  private readonly entriesByKey = new Map<string, MutableRetainedEntry<T>>();
  private createdTotal = 0;
  private updatedTotal = 0;
  private removedTotal = 0;

  sync(
    descriptors: readonly RetainedDescriptor[],
    hooks: RetainedHooks<T>,
  ): RetainedSyncResult<T> {
    const seen = new Set<string>();
    const orderedEntries: RetainedEntry<T>[] = [];
    let created = 0;
    let updated = 0;
    let removed = 0;

    for (const descriptor of descriptors) {
      if (seen.has(descriptor.key)) {
        throw new Error(`duplicate retained key: ${descriptor.key}`);
      }
      seen.add(descriptor.key);

      let current = this.entriesByKey.get(descriptor.key);
      if (!current) {
        current = {
          fingerprint: descriptor.fingerprint,
          value: hooks.create(descriptor),
        };
        this.entriesByKey.set(descriptor.key, current);
        created += 1;
        this.createdTotal += 1;
      } else if (current.fingerprint !== descriptor.fingerprint) {
        const previousFingerprint = current.fingerprint;
        hooks.update(current.value, descriptor, previousFingerprint);
        current.fingerprint = descriptor.fingerprint;
        updated += 1;
        this.updatedTotal += 1;
      }

      orderedEntries.push(Object.freeze({
        key: descriptor.key,
        fingerprint: current.fingerprint,
        value: current.value,
      }));
    }

    for (const [key, current] of [...this.entriesByKey]) {
      if (seen.has(key)) continue;
      hooks.destroy(current.value, key);
      this.entriesByKey.delete(key);
      removed += 1;
      this.removedTotal += 1;
    }

    return Object.freeze({
      entries: Object.freeze(orderedEntries),
      delta: Object.freeze({ created, updated, removed }),
      totals: Object.freeze({
        active: this.entriesByKey.size,
        created: this.createdTotal,
        updated: this.updatedTotal,
        removed: this.removedTotal,
      }),
    });
  }
}
