import { engineFailure, type EngineFailure } from "./EngineFailure.ts";

export class ReferenceIntegrityValidator {
  private readonly issues: EngineFailure[] = [];

  unique(entityType: string, ids: readonly string[]): void {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) {
        this.issues.push(
          engineFailure(
            {
              code: "duplicate-entity-id",
              category: "ReferenceIntegrityFailure",
              domain: entityType,
              operation: "validate-unique-id",
              tick: 0,
              entityIds: [id],
            },
            `duplicate ${entityType} id: ${id}`,
          ),
        );
        return;
      }
      seen.add(id);
    }
  }

  reference(
    ownerType: string,
    ownerId: string,
    field: string,
    targetType: string,
    targetId: string,
    exists: (targetId: string) => boolean,
  ): void {
    if (exists(targetId)) return;
    this.issues.push(
      engineFailure(
        {
          code: "dangling-reference",
          category: "ReferenceIntegrityFailure",
          domain: ownerType,
          operation: `validate-${field}`,
          tick: 0,
          entityIds: [ownerId, targetId],
        },
        `${ownerType} ${ownerId} references missing ${targetType} ${targetId} through ${field}`,
      ),
    );
  }

  revision(
    ownerType: string,
    ownerId: string,
    authority: string,
    expected: number,
    actual: number,
  ): void {
    if (expected === actual) return;
    this.issues.push(
      engineFailure(
        {
          code: "stale-reference-revision",
          category: "ReferenceIntegrityFailure",
          domain: ownerType,
          operation: `validate-${authority}-revision`,
          tick: 0,
          entityIds: [ownerId],
          revisions: { expected, actual },
        },
        `${ownerType} ${ownerId} expects ${authority} revision ${expected}, current ${actual}`,
      ),
    );
  }

  finite(
    entityType: string,
    entityId: string,
    field: string,
    value: number,
  ): void {
    if (Number.isFinite(value)) return;
    this.issues.push(
      engineFailure(
        {
          code: "non-finite-authoritative-state",
          category: "InvariantViolation",
          domain: entityType,
          operation: `validate-${field}`,
          tick: 0,
          entityIds: [entityId],
        },
        `${entityType} ${entityId} has non-finite ${field}`,
      ),
    );
  }

  failures(): readonly EngineFailure[] {
    return Object.freeze(this.issues.slice());
  }

  throwIfAny(operation: string): void {
    if (this.issues.length === 0) return;
    const first = this.issues[0]!;
    throw engineFailure(
      {
        code: "reference-integrity-failed",
        category: "ReferenceIntegrityFailure",
        domain: first.domain,
        operation,
        tick: first.tick,
        ...(first.entityIds === undefined ? {} : { entityIds: first.entityIds }),
      },
      `${this.issues.length} reference-integrity failure(s); first: ${first.message}`,
      first,
    );
  }
}
