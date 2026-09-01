import { NativeEngineBridge } from './NativeEngineBridge.ts';
import type { NativeCommand, NativeDomainHash } from './NativeEngineTypes.ts';

export type ShadowReferenceRuntime = Readonly<{
  submit: (commands: readonly NativeCommand[]) => void;
  step: (ticks: number) => void;
  domainHash?: (domain: string) => bigint;
}>;

export type ShadowDomainComparison = Readonly<{
  domain: string;
  native: NativeDomainHash;
  reference?: bigint;
  matches?: boolean;
}>;

export class ShadowSimulationRunner {
  private readonly reference: ShadowReferenceRuntime;
  private readonly native: NativeEngineBridge;

  constructor(reference: ShadowReferenceRuntime, native: NativeEngineBridge) {
    this.reference = reference;
    this.native = native;
  }

  submit(commands: readonly NativeCommand[]): void {
    const normalized = this.native.submit(commands);
    this.reference.submit(normalized);
  }

  step(ticks = 1): void {
    this.native.step(ticks);
    this.reference.step(ticks);
  }

  compareDomains(domains: readonly string[]): readonly ShadowDomainComparison[] {
    return Object.freeze(domains.map((domain) => {
      const native = this.native.domainHash(domain);
      if (native.ownership === 'unowned' || !this.reference.domainHash) return Object.freeze({ domain, native });
      const reference = this.reference.domainHash(domain);
      return Object.freeze({ domain, native, reference, matches: reference === native.value });
    }));
  }
}
