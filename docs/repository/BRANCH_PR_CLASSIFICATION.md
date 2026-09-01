# Stack 7 Branch and PR Classification

**Repository:** `danielmartinez-maker/Civic-Foundry`
**Classification baseline:** `main@6e1b98704635c1c66927453f458cdc6b4ad6877b`
**Stack 7 PR:** #115

This file turns the repository-health inventory into an action matrix. Destructive cleanup remains conservative: an old name is not evidence that a ref can be deleted.

## Pull-request inventory and actions

There were 22 open pull requests before Stack 7 opened PR #115. Stack 7 therefore observed 23 open PRs during execution. Stack 7 itself closed five PRs whose own descriptions explicitly identified them as temporary, disposable, or not intended for merge: #97, #77, #75, #59, and #16. Their remote branches remain preserved.

PR #114 was closed separately while Stack 7 was executing. Stack 7 did not close or merge #114; `main` remained at the classification baseline afterward.

| Branch / PR | Purpose | Canonical stack / phase | Base | Head | Integrated? | CI | Classification | Final Stack 7 disposition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| #115 | Stack 7 repository health | Stack 7 | `main@6e1b9870` | `chore/stack-7-repository-health-hygiene` | No | Exact-head gate required | Active implementation | Keep draft until acceptance and explicit merge authorization |
| #114 | 3D presentation and asset scale-up | Stack 3 | `design/3d-presentation-asset-program` | `feature/stack-3-3d-presentation-asset-scaleup@1f7c1b32` | No | Accepted-head runs reported green in PR body | Historical accepted implementation, closed concurrently | Preserve branch; Stack 7 took no closure/merge action |
| #110 | Trip-demand conservation | Bug-fix tranche | `main@4e06d805` | `fix/trip-demand-conservation` | No | RED/GREEN branch | Active implementation | Preserve |
| #109 | Freight overflow conservation | Bug-fix tranche | `main@4e06d805` | `fix/conservation-state-loss` | No | RED/GREEN branch | Active implementation | Preserve |
| #106 | Prism P2A world/cadastre mirror | Prism | `main@6e1b9870` | `feature/prism-p2a` | No | Active branch CI | Active implementation | Preserve; remains non-authoritative |
| #104 | Cadastral integrity tranche | Bug-fix tranche | `main@815b1548` | `fix/cadastral-integrity-tranche-1` | No | Draft branch CI | Active implementation | Preserve |
| #103 | Specialized GPU overlays | Older presentation program | `feature/gpu-parity-retained-scene` | `feature/gpu-specialized-overlay-parity` | No | Historical branch CI | Accepted baseline / semantic donor | Preserve pending presentation-owner cleanup |
| #99 | Retained GPU scene | Older presentation program | `main@815b1548` | `feature/gpu-parity-retained-scene@3b4e08a8` | No | Run `33140360165` reported green | Accepted baseline / semantic donor | Preserve pending presentation-owner cleanup |
| #97 | Disposable main→Phase 0B sync | Phase 0B | `civic-2.0-phase-0b-forward-port` | `sync/main-into-phase-0b-forward-port` | No | Not acceptance-relevant | Superseded | **Closed by Stack 7; branch preserved** |
| #96 | Isometric B2 public realm | Older presentation program | `feature/isometric-pass-b1-urban-depth` | `feature/isometric-pass-b2-public-realm@67bbf1bd` | No | Run `33029642106` reported green | Accepted baseline / semantic donor | Preserve pending presentation-owner cleanup |
| #91 | Isometric B1 urban depth | Older presentation program | `main@ee296a98` | `feature/isometric-pass-b1-urban-depth@e1021ad4` | No | PR reports exact-head green | Accepted baseline / semantic donor | Preserve pending presentation-owner cleanup |
| #89 | Phase 0B forward-port | Phase 0B | `main@f8771e96` | `civic-2.0-phase-0b-forward-port` | No | Historical draft | Historical archive | Preserve pending EntityRegistry owner decision |
| #88 | 3R-B intersection control | Transportation 3R | `main@ee296a98` | `civic-2.0-3r-b-intersection-control` | No | Design/planning only | Active design | Reconcile stale Save assumptions before implementation; do not merge as-is |
| #77 | Disposable patch runner | Phase 0B | `phase0b-perf-base-anchor` | `phase0b-outer-noop-patch-runner` | No | Utility runner | Superseded | **Closed by Stack 7; branch preserved** |
| #75 | Disposable profiler | Phase 0B | `civic-2.0-phase-0b-inline` | `phase0b-validation-fastpath-profile` | No | Profiling-only | Superseded | **Closed by Stack 7; branch preserved** |
| #72 | Personhood Core mislabeled 3R | Human simulation | `civic-2.0-phase-0b-forward-port` | `feature/phase-3r-personhood-core` | No | Historical draft | Unknown — requires owner decision | Rename/reclassify before any integration; never treat as Transportation 3R |
| #71 | Personhood implementation plan | Human simulation | `design/full-individual-sim-roadmap` | `plan/phase-3r-personhood-core-final3` | No | Documentation-only | Historical archive | Preserve until roadmap owner chooses canonical plan |
| #69 | Full Individual Sim roadmap | Human simulation | `main@747b45fe` | `design/full-individual-sim-roadmap` | No | Design-only | Active design | Preserve |
| #59 | Disposable GREEN gate | Phase 0B | `phase0b-perf-base-anchor` | `phase0b-incremental-integrity-green-gate` | No | Verification-only | Superseded | **Closed by Stack 7; branch preserved** |
| #41 | Semantic Urban Depth B1 | Pre-accepted Urban Fabric history | `main@747b45fe` | `feature/urban-depth-b1` | No | Historical draft | Historical archive | Preserve as evidence; do not merge |
| #20 | Original Phase 0B registry | Phase 0B | `main@b063ef10` | `civic-2.0-phase-0b-inline` | No | Historical draft | Historical archive | Preserve until forward-port history is settled |
| #16 | Temporary Phase 0A browser smoke | Phase 0A | `civic-2.0-phase-0a-inline` | `verify-phase0a-browser-smoke` | No | Verification-only | Superseded | **Closed by Stack 7; branch preserved** |
| #14 | Legacy Phase 8A utilities | Legacy roadmap numbering | `main@22089f89` | `phase8a-utility-networks` | No | Historical draft | Unknown — requires owner decision | Preserve; reconcile against current roadmap before reuse |

## Remote branch classification

The baseline inventory found 176 remote branches including `main`; therefore 175 non-`main` branches required classification. The exact branch-name inventory and family membership are recorded in `docs/repository/STACK_7_HEALTH_BASELINE.md`. Those groups map to the required Stack 7 categories as follows:

| Baseline group | Stack 7 classification | Default action |
| --- | --- | --- |
| Active implementation | **1. Active implementation** | Preserve and keep stack ownership explicit |
| Active design | **2. Active design** | Preserve; no implementation claim |
| Accepted baseline required by an active stack | **3. Accepted baseline required by an active stack** | Preserve until dependent stack accepts/rebases |
| Historical archive / explicit backup | **4. Historical archive** | Preserve; consider archive tags only after owner review |
| Historical implementation branches retained pending owner decision | **4. Historical archive** unless the named owner reactivates them | Preserve |
| Superseded / disposable verification families | **5. Superseded** | Eligible for later deletion only after PR/dependency/reference proof |
| Merged and candidate for safe deletion after merge/dependency proof | **6. Merged and safely deletable** only after final reference checks are completed | Do not delete from this tranche without proof |
| Repeated obsolete synchronization/temporary refs with an explicit backup already listed | **7. Backup with no remaining value** only when owner/history review proves no unique evidence remains | Preserve for now |
| `metropolitan-era`, `rebuild-phase3`, and any branch whose purpose cannot be proved from accepted history | **8. Unknown — requires owner decision** | Preserve |

No remote branch is deleted by Stack 7. Several live or recently accepted stacks still depend on historical presentation, Prism, Phase 0B, or backup refs as bases, semantic donors, or recovery evidence. Branch deletion therefore remains a separate owner-reviewed maintenance action.

## Branch naming policy

New branches should use purpose-first names:

- `feature/...`
- `fix/...`
- `design/...`
- `docs/...`
- `chore/...`
- `archive/...`

Do not reuse legacy phase numbers when the number no longer matches the canonical roadmap. A branch name is descriptive metadata; it must not imply that a target architecture is current authority.

## Destructive-cleanup decision

Stack 7 performed only reversible PR closure for five explicitly disposable/temporary PRs and preserved every associated branch. No remote branch was deleted. Candidate branch deletion remains documented maintenance work because the repository contains stacked bases, semantic donors, backups, and historical implementation evidence whose removal requires stronger proof than naming conventions provide.
