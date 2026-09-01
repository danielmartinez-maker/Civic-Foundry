import type { EasementKind } from "../../world/cadastre/CadastralTypes.ts";
import type { PolygonRing, WorldPoint } from "../../world/cadastre/Geometry.ts";

export type P2AMutationCommand =
  | Readonly<{
      kind: "split";
      parcelId: string;
      cutLine: readonly WorldPoint[];
    }>
  | Readonly<{ kind: "assemble"; parcelIds: readonly string[] }>
  | Readonly<{
      kind: "create-easement";
      parcelIds: readonly string[];
      easementKind: EasementKind;
      geometry: readonly WorldPoint[];
    }>
  | Readonly<{ kind: "remove-easement"; easementId: string }>
  | Readonly<{ kind: "right-of-way"; parcelId: string; geometry: PolygonRing }>;
