import type { SimulationKernel, KernelSchedulerManifestEntry } from "../kernel/SimulationKernel.ts";
import { CausalTraceBuffer } from "./CausalTrace.ts";
import { deterministicHash } from "./DeterministicDiagnostics.ts";

export type SimulationDomainDiagnostics = Readonly<{
  world: Readonly<{
    nodes: number;
    edges: number;
    blocks: number;
    parcels: number;
    easements: number;
    lineage: number;
    topologyRevision: number;
  }>;
  buildings: Readonly<{
    canonical: number;
    legacy: number;
  }>;
  transport: Readonly<{
    segments: number;
    activeVehicles: number;
    completedTrips: number;
    failedTrips: number;
    congestionEpoch: number;
  }>;
  transit: Readonly<{
    lines: number;
    stops: number;
    vehicles: number;
  }>;
  economy: Readonly<{
    firms: number;
    freightVehicles: number;
  }>;
  services: Readonly<{
    facilities: number;
    activeJobs: number;
  }>;
}>;

export type SimulationDiagnosticsSource = Readonly<{
  kernel: SimulationKernel;
  captureAuthority: () => unknown;
  captureDomains: () => SimulationDomainDiagnostics;
  revisions: () => Readonly<Record<string, number>>;
}>;

export type RuntimeDiagnosticsSnapshot = Readonly<{
  simulation: Readonly<{
    tick: number;
    faulted: boolean;
    commandQueueDepth: number;
    retainedEvents: number;
    transactionRollbacks: number;
    registeredSystems: readonly KernelSchedulerManifestEntry[];
    invariantFailures: number;
  }>;
  world: SimulationDomainDiagnostics["world"];
  buildings: SimulationDomainDiagnostics["buildings"];
  transport: SimulationDomainDiagnostics["transport"];
  transit: SimulationDomainDiagnostics["transit"];
  economy: SimulationDomainDiagnostics["economy"];
  services: SimulationDomainDiagnostics["services"];
  performance: ReturnType<SimulationKernel["performance"]["snapshot"]>;
  revisions: Readonly<Record<string, number>>;
  determinism: Readonly<{
    authorityHash: string;
  }>;
}>;

export class SimulationDiagnosticsService {
  readonly trace: CausalTraceBuffer;

  constructor(
    private readonly source: SimulationDiagnosticsSource,
    traceCapacity = 512,
  ) {
    this.trace = new CausalTraceBuffer(traceCapacity);
  }

  authorityHash(): string {
    return deterministicHash(this.source.captureAuthority());
  }

  snapshot(): RuntimeDiagnosticsSnapshot {
    const kernel = this.source.kernel.diagnosticSnapshot();
    const domains = this.source.captureDomains();
    const revisions = Object.freeze(
      Object.fromEntries(
        Object.entries(this.source.revisions()).sort(([a], [b]) => a.localeCompare(b)),
      ),
    );
    return Object.freeze({
      simulation: Object.freeze({
        tick: kernel.tick,
        faulted: kernel.faulted,
        commandQueueDepth: kernel.pendingCommands,
        retainedEvents: kernel.retainedEvents,
        transactionRollbacks: kernel.transactionRollbacks,
        registeredSystems: this.source.kernel.schedulerManifest(),
        invariantFailures: kernel.lastFailure?.category === "InvariantViolation" ? 1 : 0,
      }),
      world: domains.world,
      buildings: domains.buildings,
      transport: domains.transport,
      transit: domains.transit,
      economy: domains.economy,
      services: domains.services,
      performance: kernel.performance,
      revisions,
      determinism: Object.freeze({ authorityHash: this.authorityHash() }),
    });
  }
}
