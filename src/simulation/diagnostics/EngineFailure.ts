export type EngineFailureCategory =
  | "InvariantViolation"
  | "ReferenceIntegrityFailure"
  | "TransactionFailure"
  | "HydrationFailure"
  | "DeterminismFailure"
  | "SchedulingFailure"
  | "TopologyReconciliationFailure"
  | "ConservationFailure"
  | "RendererSynchronizationFailure"
  | "AssetRuntimeFailure"
  | "CompatibilityBoundaryFailure"
  | "ExternalRuntimeFailure";

export type EngineFailureMetadata = Readonly<{
  code: string;
  category: EngineFailureCategory;
  domain: string;
  operation: string;
  tick: number;
  commandId?: string;
  entityIds?: readonly string[];
  revisions?: Readonly<Record<string, number>>;
  saveVersion?: number;
  parentOperation?: string;
}>;

function sortedRecord(
  values: Readonly<Record<string, number>> | undefined,
): Readonly<Record<string, number>> | undefined {
  if (values === undefined) return undefined;
  return Object.freeze(
    Object.fromEntries(
      Object.entries(values).sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
}

export class EngineFailure extends Error {
  readonly code: string;
  readonly category: EngineFailureCategory;
  readonly domain: string;
  readonly operation: string;
  readonly tick: number;
  readonly commandId?: string;
  readonly entityIds?: readonly string[];
  readonly revisions?: Readonly<Record<string, number>>;
  readonly saveVersion?: number;
  readonly parentOperation?: string;

  constructor(
    metadata: EngineFailureMetadata,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "EngineFailure";
    this.code = metadata.code;
    this.category = metadata.category;
    this.domain = metadata.domain;
    this.operation = metadata.operation;
    this.tick = metadata.tick;
    this.commandId = metadata.commandId;
    this.entityIds =
      metadata.entityIds === undefined
        ? undefined
        : Object.freeze([...metadata.entityIds]);
    this.revisions = sortedRecord(metadata.revisions);
    this.saveVersion = metadata.saveVersion;
    this.parentOperation = metadata.parentOperation;
  }

  toJSON(): Readonly<Record<string, unknown>> {
    const value: Record<string, unknown> = {
      name: this.name,
      message: this.message,
      code: this.code,
      category: this.category,
      domain: this.domain,
      operation: this.operation,
      tick: this.tick,
    };
    if (this.commandId !== undefined) value.commandId = this.commandId;
    if (this.entityIds !== undefined) value.entityIds = this.entityIds;
    if (this.revisions !== undefined) value.revisions = this.revisions;
    if (this.saveVersion !== undefined) value.saveVersion = this.saveVersion;
    if (this.parentOperation !== undefined) {
      value.parentOperation = this.parentOperation;
    }
    return Object.freeze(value);
  }
}

export function engineFailure(
  metadata: EngineFailureMetadata,
  message: string,
  cause?: unknown,
): EngineFailure {
  return new EngineFailure(metadata, message, cause === undefined ? undefined : { cause });
}

export function normalizeEngineFailure(
  error: unknown,
  metadata: EngineFailureMetadata,
): EngineFailure {
  if (error instanceof EngineFailure) return error;
  const message = error instanceof Error ? error.message : String(error);
  return engineFailure(metadata, message, error);
}
