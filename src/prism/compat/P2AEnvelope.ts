import type { CadastralSnapshot } from "../../world/cadastre/CadastralTypes.ts";
import type { WorldFoundationSnapshot } from "../../world/foundation/WorldFoundationTypes.ts";

export const PRISM_P2A_SCHEMA_VERSION = 1 as const;
export const PRISM_P2A_SOURCE_SAVE_VERSION = 9 as const;
export const PRISM_P2A_SOURCE_GAME_VERSION = "0.9.0-urban-fabric" as const;

export type PrismP2AImportEnvelopeV1 = Readonly<{
  schemaVersion: typeof PRISM_P2A_SCHEMA_VERSION;
  sourceSaveVersion: typeof PRISM_P2A_SOURCE_SAVE_VERSION;
  sourceGameVersion: typeof PRISM_P2A_SOURCE_GAME_VERSION;
  world: WorldFoundationSnapshot;
  cadastre: CadastralSnapshot;
}>;
