import type { SimulationCore } from "../../simulation/core/SimulationCore.ts";
import type { CadastralSnapshot } from "../../world/cadastre/CadastralTypes.ts";
import type { WorldFoundationSnapshot } from "../../world/foundation/WorldFoundationTypes.ts";
import {
  PRISM_P2A_SCHEMA_VERSION,
  PRISM_P2A_SOURCE_GAME_VERSION,
  PRISM_P2A_SOURCE_SAVE_VERSION,
  type PrismP2AImportEnvelopeV1,
} from "./P2AEnvelope.ts";

export function exportPrismP2AEnvelope(
  core: Pick<SimulationCore, "world" | "cadastre">,
): PrismP2AImportEnvelopeV1 {
  if (!Number.isSafeInteger(core.world.seed))
    throw new Error("P2A world seed must be a safe integer");

  const world = structuredClone(
    core.world.snapshotAuthoritative(),
  ) as WorldFoundationSnapshot;
  const cadastre = structuredClone(
    core.cadastre.snapshot(),
  ) as CadastralSnapshot;

  return Object.freeze({
    schemaVersion: PRISM_P2A_SCHEMA_VERSION,
    sourceSaveVersion: PRISM_P2A_SOURCE_SAVE_VERSION,
    sourceGameVersion: PRISM_P2A_SOURCE_GAME_VERSION,
    world,
    cadastre,
  });
}
