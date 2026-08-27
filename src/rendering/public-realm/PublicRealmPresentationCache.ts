import type { SimulationCore } from '../../simulation/core/SimulationCore.ts';
import type { PublicRealmContext, PublicRealmDescriptor } from './PublicRealmTypes.ts';
import { resolvePublicRealmDescriptor } from './PublicRealmVisualResolver.ts';
import { buildPublicRealmContextIndex } from './PublicRealmContextIndex.ts';
import { publicRealmRevisionFingerprint } from './PublicRealmRevisionFingerprint.ts';

export type PublicRealmPresentationSnapshot = Readonly<{
  fingerprint: string;
  contexts: readonly PublicRealmContext[];
  descriptors: readonly PublicRealmDescriptor[];
}>;

type ContextBuilder = (core: SimulationCore) => readonly PublicRealmContext[];

export class PublicRealmPresentationCache {
  private fingerprintValue: string | undefined;
  private snapshotValue: PublicRealmPresentationSnapshot | undefined;
  private readonly buildIndex: ContextBuilder;

  constructor(buildIndex: ContextBuilder = buildPublicRealmContextIndex) {
    this.buildIndex = buildIndex;
  }

  resolve(core: SimulationCore): PublicRealmPresentationSnapshot {
    const fingerprint = publicRealmRevisionFingerprint(core);
    if (this.snapshotValue && this.fingerprintValue === fingerprint) return this.snapshotValue;

    const contexts = Object.freeze([...this.buildIndex(core)]);
    const descriptors = Object.freeze(contexts.flatMap((context) => {
      const descriptor = resolvePublicRealmDescriptor(context);
      return descriptor ? [descriptor] : [];
    }));
    this.fingerprintValue = fingerprint;
    this.snapshotValue = Object.freeze({ fingerprint, contexts, descriptors });
    return this.snapshotValue;
  }
}
