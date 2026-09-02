import { engineFailure } from "../diagnostics/EngineFailure.ts";

export type TransactionParticipant<TSnapshot = unknown> = Readonly<{
  id: string;
  snapshot: () => TSnapshot;
  restore: (snapshot: TSnapshot) => void;
}>;

export type TransactionCheckpoint = readonly Readonly<{
  id: string;
  snapshot: unknown;
}>[];

export class TransactionCoordinator {
  private readonly participants = new Map<string, TransactionParticipant>();

  register<TSnapshot>(participant: TransactionParticipant<TSnapshot>): void {
    if (!participant.id || participant.id.trim().length === 0) {
      throw new Error("transaction participant id must not be empty");
    }
    if (this.participants.has(participant.id)) {
      throw new Error(`duplicate transaction participant: ${participant.id}`);
    }
    this.participants.set(
      participant.id,
      participant as TransactionParticipant,
    );
  }

  listParticipantIds(): readonly string[] {
    return Object.freeze(
      [...this.participants.keys()].sort((a, b) => a.localeCompare(b)),
    );
  }

  capture(): TransactionCheckpoint {
    return Object.freeze(
      this.listParticipantIds().map((id) => {
        const participant = this.participants.get(id)!;
        return Object.freeze({ id, snapshot: participant.snapshot() });
      }),
    );
  }

  rollback(checkpoint: TransactionCheckpoint): void {
    for (const saved of [...checkpoint].reverse()) {
      const participant = this.participants.get(saved.id);
      if (participant === undefined) {
        throw engineFailure(
          {
            code: "transaction-rollback-failed",
            category: "TransactionFailure",
            domain: "transaction",
            operation: "rollback",
            tick: 0,
            entityIds: [saved.id],
          },
          `missing transaction participant during rollback: ${saved.id}`,
        );
      }
      try {
        participant.restore(saved.snapshot);
      } catch (error) {
        throw engineFailure(
          {
            code: "transaction-rollback-failed",
            category: "TransactionFailure",
            domain: "transaction",
            operation: "rollback",
            tick: 0,
            entityIds: [saved.id],
          },
          `transaction participant rollback failed: ${saved.id}`,
          error,
        );
      }
    }
  }
}
