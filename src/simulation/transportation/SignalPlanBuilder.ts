import type { JunctionConflictMatrix } from './ConflictMatrixBuilder.ts';
import type {
  PedestrianCrossingId,
  SignalPhase,
  SignalTimingPlan,
} from './IntersectionControlTypes.ts';
import type {
  JunctionId,
  TurnMovement,
  TurnMovementId,
} from './TransportNetworkTypes.ts';

export type FixedSignalPlanInput = Readonly<{
  junctionId: JunctionId;
  movements: readonly TurnMovement[];
  conflicts: JunctionConflictMatrix;
  pedestrianCrossingIds: readonly PedestrianCrossingId[];
  movementDemandPerMinute: Readonly<Record<TurnMovementId, number>>;
  protectedOnlyMovementIds?: readonly TurnMovementId[] | undefined;
  speedKph: number;
  junctionClearanceMeters: number;
  cycleTicks: number;
}>;

type MutablePhase = {
  protectedMovementIds: TurnMovementId[];
  permissiveMovementIds: TurnMovementId[];
  pedestrianCrossingIds: PedestrianCrossingId[];
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function requireFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be finite and non-negative`);
  }
}

function signature(phase: MutablePhase): string {
  return [
    [...phase.protectedMovementIds].sort((a, b) => a.localeCompare(b)).join(','),
    [...phase.permissiveMovementIds].sort((a, b) => a.localeCompare(b)).join(','),
    [...phase.pedestrianCrossingIds].sort((a, b) => a.localeCompare(b)).join(','),
  ].join('|');
}

function phaseDemand(
  phase: MutablePhase,
  demand: Readonly<Record<TurnMovementId, number>>,
): number {
  return [...phase.protectedMovementIds, ...phase.permissiveMovementIds]
    .reduce((sum, movementId) => sum + (demand[movementId] ?? 0), 0);
}

function validateInput(input: FixedSignalPlanInput): void {
  if (input.junctionId.length === 0) throw new Error('junctionId must not be empty');
  if (input.conflicts.junctionId !== input.junctionId) {
    throw new Error(`conflict matrix ${input.conflicts.junctionId} does not match ${input.junctionId}`);
  }
  requireFiniteNonNegative(input.speedKph, 'speedKph');
  requireFiniteNonNegative(input.junctionClearanceMeters, 'junctionClearanceMeters');
  requireFiniteNonNegative(input.cycleTicks, 'cycleTicks');
  if (!Number.isInteger(input.cycleTicks) || input.cycleTicks <= 0) {
    throw new Error('cycleTicks must be a positive integer');
  }

  const movementIds = new Set<TurnMovementId>();
  for (const movement of input.movements) {
    if (movement.junctionId !== input.junctionId) {
      throw new Error(`movement ${movement.id} belongs to another junction`);
    }
    if (movementIds.has(movement.id)) throw new Error(`duplicate movement ${movement.id}`);
    movementIds.add(movement.id);
    requireFiniteNonNegative(input.movementDemandPerMinute[movement.id] ?? 0, `movement demand ${movement.id}`);
  }

  for (const movementId of input.protectedOnlyMovementIds ?? []) {
    if (!movementIds.has(movementId)) throw new Error(`unknown protected-only movement ${movementId}`);
  }
}

function assertProtectedOnlyLeftCompatibility(
  protectedOnly: readonly TurnMovementId[],
  conflicts: JunctionConflictMatrix,
): void {
  const ids = [...new Set(protectedOnly)].sort((a, b) => a.localeCompare(b));
  for (let i = 0; i < ids.length; i += 1) {
    const a = ids[i];
    if (!a) continue;
    for (let j = i + 1; j < ids.length; j += 1) {
      const b = ids[j];
      if (!b) continue;
      if (conflicts.conflicts(a, b)) {
        throw new Error(`protected movement conflict between ${a} and ${b}`);
      }
    }
  }
}

function buildMovementPhases(input: FixedSignalPlanInput): MutablePhase[] {
  const protectedOnly = new Set(input.protectedOnlyMovementIds ?? []);
  assertProtectedOnlyLeftCompatibility([...protectedOnly], input.conflicts);

  const protectedCandidates = input.movements
    .filter((movement) => movement.allowed && (movement.turnKind !== 'left' || protectedOnly.has(movement.id)))
    .sort((a, b) => a.id.localeCompare(b.id));

  const phases: MutablePhase[] = [];
  for (const movement of protectedCandidates) {
    let target = phases.find((phase) => phase.protectedMovementIds.every(
      (movementId) => !input.conflicts.conflicts(movement.id, movementId),
    ));
    if (!target) {
      target = { protectedMovementIds: [], permissiveMovementIds: [], pedestrianCrossingIds: [] };
      phases.push(target);
    }
    target.protectedMovementIds.push(movement.id);
  }

  if (phases.length === 0 && input.movements.some((movement) => movement.allowed)) {
    phases.push({ protectedMovementIds: [], permissiveMovementIds: [], pedestrianCrossingIds: [] });
  }

  const permissiveLefts = input.movements
    .filter((movement) => movement.allowed && movement.turnKind === 'left' && !protectedOnly.has(movement.id))
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const movement of permissiveLefts) {
    const sameApproach = phases.find((phase) => phase.protectedMovementIds.some((movementId) => {
      const protectedMovement = input.movements.find((candidate) => candidate.id === movementId);
      return protectedMovement?.fromCarriagewayId === movement.fromCarriagewayId;
    }));
    const target = sameApproach ?? phases[0];
    if (target) target.permissiveMovementIds.push(movement.id);
  }

  const pedestrianIds = [...new Set(input.pedestrianCrossingIds)].sort((a, b) => a.localeCompare(b));
  for (const crossingId of pedestrianIds) {
    const target = phases.find((phase) => phase.protectedMovementIds.every(
      (movementId) => !input.conflicts.conflicts(crossingId, movementId),
    ));
    if (target) {
      target.pedestrianCrossingIds.push(crossingId);
    } else {
      phases.push({
        protectedMovementIds: [],
        permissiveMovementIds: [],
        pedestrianCrossingIds: [crossingId],
      });
    }
  }

  for (const phase of phases) {
    phase.protectedMovementIds.sort((a, b) => a.localeCompare(b));
    phase.permissiveMovementIds.sort((a, b) => a.localeCompare(b));
    phase.pedestrianCrossingIds.sort((a, b) => a.localeCompare(b));
  }

  return phases;
}

function allocateGreenTicks(
  phases: readonly MutablePhase[],
  totalGreenTicks: number,
  minimumGreenTicks: number,
  demand: Readonly<Record<TurnMovementId, number>>,
): readonly number[] {
  const minimumTotal = minimumGreenTicks * phases.length;
  if (totalGreenTicks < minimumTotal) {
    throw new Error(`cycle cannot provide minimum green of ${minimumGreenTicks} ticks to every phase`);
  }
  const extra = totalGreenTicks - minimumTotal;
  if (phases.length === 0) return Object.freeze([]);

  const phaseDemands = phases.map((phase) => phaseDemand(phase, demand));
  const totalDemand = phaseDemands.reduce((sum, value) => sum + value, 0);
  const exactShares = phaseDemands.map((value) => (
    totalDemand > 0 ? (extra * value) / totalDemand : extra / phases.length
  ));
  const extras = exactShares.map((value) => Math.floor(value));
  let remaining = extra - extras.reduce((sum, value) => sum + value, 0);

  const order = phases.map((phase, index) => ({
    index,
    remainder: (exactShares[index] ?? 0) - (extras[index] ?? 0),
    signature: signature(phase),
  })).sort((a, b) => {
    const remainderDelta = b.remainder - a.remainder;
    return remainderDelta !== 0 ? remainderDelta : a.signature.localeCompare(b.signature);
  });

  for (const entry of order) {
    if (remaining <= 0) break;
    extras[entry.index] = (extras[entry.index] ?? 0) + 1;
    remaining -= 1;
  }

  return Object.freeze(extras.map((value) => minimumGreenTicks + value));
}

export function buildFixedSignalPlan(input: FixedSignalPlanInput): SignalTimingPlan {
  validateInput(input);

  const yellowTicks = clamp(Math.round((3 + input.speedKph / 80) * 10), 30, 50);
  const allRedTicks = clamp(
    Math.round((input.junctionClearanceMeters / Math.max(input.speedKph / 3.6, 1)) * 10),
    10,
    30,
  );
  const minimumGreenTicks = 80;

  const phases = buildMovementPhases(input).sort((a, b) => {
    const demandDelta = phaseDemand(b, input.movementDemandPerMinute)
      - phaseDemand(a, input.movementDemandPerMinute);
    return demandDelta !== 0 ? demandDelta : signature(a).localeCompare(signature(b));
  });

  if (phases.length === 0) {
    throw new Error('signal plan requires at least one movement or pedestrian phase');
  }

  const clearanceTicks = phases.length * (yellowTicks + allRedTicks);
  const totalGreenTicks = input.cycleTicks - clearanceTicks;
  const greenTicks = allocateGreenTicks(
    phases,
    totalGreenTicks,
    minimumGreenTicks,
    input.movementDemandPerMinute,
  );

  const persistedPhases: SignalPhase[] = phases.map((phase, index) => Object.freeze({
    id: `sp:${input.junctionId}:${index}:${signature(phase)}`,
    protectedMovementIds: Object.freeze([...phase.protectedMovementIds]),
    permissiveMovementIds: Object.freeze([...phase.permissiveMovementIds]),
    pedestrianCrossingIds: Object.freeze([...phase.pedestrianCrossingIds]),
    greenTicks: greenTicks[index] ?? minimumGreenTicks,
    yellowTicks,
    allRedTicks,
  }));

  return Object.freeze({
    cycleTicks: input.cycleTicks,
    offsetTicks: 0,
    phases: Object.freeze(persistedPhases),
  });
}
