import type { EconomyWriteAuthority } from "../simulation/economy/EconomyScheduler.ts";

export const SOCIOECONOMIC_AUTHORITY_GATES = Object.freeze([
  "inventory_freight",
  "firms_production",
  "labor",
  "households_housing",
  "personhood_lifecycle",
] as const);

export type SocioeconomicAuthorityGate =
  (typeof SOCIOECONOMIC_AUTHORITY_GATES)[number];

export interface SocioeconomicAuthorityCutoverAdapter {
  disableTypescriptWrites(gate: SocioeconomicAuthorityGate): void;
  enableTypescriptWrites(gate: SocioeconomicAuthorityGate): void;
  typescriptWriteEnabled(gate: SocioeconomicAuthorityGate): boolean;
}

export interface LegacySocioeconomicCompatibilityRuntime {
  readonly economyDomain: Readonly<{
    setWriteAuthority(authority: EconomyWriteAuthority): void;
    getWriteAuthority(): EconomyWriteAuthority;
  }>;
  readonly population: Readonly<{
    setWriteEnabled(enabled: boolean): void;
    typescriptWriteEnabled(): boolean;
  }>;
  readonly housingRelocation: Readonly<{
    setWriteEnabled(enabled: boolean): void;
    typescriptWriteEnabled(): boolean;
  }>;
}

export class LegacySocioeconomicAuthorityCutover implements SocioeconomicAuthorityCutoverAdapter {
  private readonly nativeOwned = new Set<SocioeconomicAuthorityGate>();
  private readonly runtime: LegacySocioeconomicCompatibilityRuntime;

  constructor(runtime: LegacySocioeconomicCompatibilityRuntime) {
    this.runtime = runtime;
  }

  disableTypescriptWrites(gate: SocioeconomicAuthorityGate): void {
    this.nativeOwned.add(gate);
    this.applyWritePolicy();
  }

  enableTypescriptWrites(gate: SocioeconomicAuthorityGate): void {
    this.nativeOwned.delete(gate);
    this.applyWritePolicy();
  }

  typescriptWriteEnabled(gate: SocioeconomicAuthorityGate): boolean {
    switch (gate) {
      case "inventory_freight":
        return this.runtime.economyDomain.getWriteAuthority().inventoryFreight;
      case "firms_production":
        return this.runtime.economyDomain.getWriteAuthority().firmsProduction;
      case "labor":
        return this.runtime.economyDomain.getWriteAuthority().labor;
      case "households_housing":
        return this.runtime.housingRelocation.typescriptWriteEnabled();
      case "personhood_lifecycle":
        return this.runtime.population.typescriptWriteEnabled();
    }
  }

  nativeOwnedGates(): readonly SocioeconomicAuthorityGate[] {
    return Object.freeze(
      SOCIOECONOMIC_AUTHORITY_GATES.filter((gate) =>
        this.nativeOwned.has(gate),
      ),
    );
  }

  private applyWritePolicy(): void {
    this.runtime.economyDomain.setWriteAuthority({
      inventoryFreight: !this.nativeOwned.has("inventory_freight"),
      firmsProduction: !this.nativeOwned.has("firms_production"),
      labor: !this.nativeOwned.has("labor"),
    });
    this.runtime.housingRelocation.setWriteEnabled(
      !this.nativeOwned.has("households_housing"),
    );
    this.runtime.population.setWriteEnabled(
      !this.nativeOwned.has("personhood_lifecycle"),
    );
  }
}
