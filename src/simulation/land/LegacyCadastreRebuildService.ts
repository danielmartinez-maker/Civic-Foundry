import type { ZoneType } from '../core/types.ts';
import type { CadastralSnapshot, Parcel } from '../../world/cadastre/CadastralTypes.ts';
import type { CadastralGraph } from '../../world/cadastre/CadastralGraph.ts';
import type { LotSystem } from '../../world/lots/LotSystem.ts';

export type LegacyCadastreRebuildResult = Readonly<{
  committed: boolean;
  changed: boolean;
  rejectionReason?: string;
}>;

export type LegacyCadastreRebuildDependencies = Readonly<{
  cadastre: CadastralGraph;
  lots: LotSystem;
  legacyZoneResolver: (parcel: Parcel) => ZoneType | undefined;
}>;

export class LegacyCadastreRebuildService {
  private readonly deps: LegacyCadastreRebuildDependencies;
  private legacyProjectionFingerprint: string | null = null;

  constructor(deps: LegacyCadastreRebuildDependencies) {
    this.deps = deps;
  }

  rebuild(
    candidate: CadastralSnapshot,
    _tick: number,
    commitChangedProjection: () => void,
  ): LegacyCadastreRebuildResult {
    const fingerprint = projectionFingerprint(candidate);
    if (this.legacyProjectionFingerprint === fingerprint) {
      // The legacy road/zoning projection did not change. Canonical legal-land
      // mutations may legitimately diverge from that projection, so preserve
      // the live cadastre and only restore the derived compatibility lots that
      // inherited legacy edit paths may have rebuilt.
      this.deps.lots.rebuildFromCadastre(this.deps.cadastre, this.deps.legacyZoneResolver);
      return Object.freeze({ committed: true, changed: false });
    }

    commitChangedProjection();
    this.legacyProjectionFingerprint = fingerprint;
    return Object.freeze({ committed: true, changed: true });
  }
}

function projectionFingerprint(snapshot: CadastralSnapshot): string {
  return JSON.stringify(snapshot);
}
