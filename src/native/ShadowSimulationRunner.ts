import {
  NativeEngineBridge,
  nativeShadowEnabledFromGlobal,
} from "./NativeEngineBridge.ts";
import type {
  NativeCommand,
  NativeDomainHash,
  NativeEngineAddon,
} from "./NativeEngineTypes.ts";

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

export type ShadowSimulationSession = Readonly<{
  runner: ShadowSimulationRunner;
  dispose: () => void;
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

  compareDomains(
    domains: readonly string[],
  ): readonly ShadowDomainComparison[] {
    return Object.freeze(
      domains.map((domain) => {
        const native = this.native.domainHash(domain);
        if (native.ownership === "unowned" || !this.reference.domainHash)
          return Object.freeze({ domain, native });
        const reference = this.reference.domainHash(domain);
        return Object.freeze({
          domain,
          native,
          reference,
          matches: reference === native.value,
        });
      }),
    );
  }
}

export function createShadowSimulationSessionIfEnabled(
  reference: ShadowReferenceRuntime,
  addon: NativeEngineAddon,
  config: Readonly<{
    seed?: number;
    startTick?: number;
    speed?: 0 | 1 | 2 | 4;
  }> = {},
  scope: unknown = globalThis,
): ShadowSimulationSession | null {
  if (!nativeShadowEnabledFromGlobal(scope)) return null;

  const bridge = new NativeEngineBridge(addon, config);
  const runner = new ShadowSimulationRunner(reference, bridge);
  return Object.freeze({
    runner,
    dispose: () => bridge.dispose(),
  });
}
