# Stack 7 Dead Code and Compatibility Debt Audit

**Baseline:** `main@6e1b98704635c1c66927453f458cdc6b4ad6877b`

Stack 7 applies the specification's conservative removal rule: source is removed only when current reference evidence proves it is definitely dead and no compatibility, historical, or active-stack role remains.

## Classification

| Candidate / family | Classification | Evidence / rationale | Stack 7 action |
| --- | --- | --- | --- |
| `LotSystem` compatibility projection | **2. Compatibility-critical** | Current authority docs define it as the derived facade used by inherited cell-based systems while `CadastralGraph` remains legal-land authority | Retain |
| Legacy building records alongside `BuildingV2` | **2. Compatibility-critical** | Current architecture intentionally maintains separate inherited and canonical stores during progressive replacement | Retain |
| Current transportation/economy/housing/service compatibility systems | **2. Compatibility-critical** | Playable transitional authority remains required until replacement phases pass acceptance | Retain |
| Legacy Canvas2D renderer/pass sources that serve presentation migration/donor work | **3. Historical but harmless / active semantic donor** | Current presentation docs say production uses GPU rendering while legacy sources remain migration references; active Stack 3/donor PRs still exist | Retain |
| Old Phase 0B profiling/gate/synchronization branches | **3. Historical repository evidence** at source level; **5. Superseded** at branch classification level | Large temporary branch family, several PR descriptions explicitly say disposable | Close only explicitly disposable PRs; retain branches pending owner cleanup |
| Prism native/runtime code absent from `main` | **4. Future-planned** | No `Cargo.toml` is present on current `main`; active Prism branches are non-authoritative mirror work | Do not create/remove Prism runtime in Stack 7 |
| Personhood branches labeled as Phase/Transportation 3R | **5. Unclear ownership/roadmap conflict** | Current canonical roadmap defines 3R as Transportation Engine 2.0 | Preserve and require owner reclassification |
| `metropolitan-era`, `rebuild-phase3` branch purposes | **5. Unclear** | Inventory does not prove a canonical active purpose or safe replacement | Preserve; owner decision required |

## Definitely dead and removable

Stack 7 found no production source module, compatibility path, or package script that met the proof threshold for category 1 removal without crossing into an active compatibility or historical-evidence role. Therefore **no source/runtime code is deleted**.

The only destructive cleanup performed is reversible PR state cleanup for five PRs whose own descriptions explicitly identified them as disposable/temporary/do-not-merge. Their branch refs remain preserved.

## Npm scripts

Every script retained in `package.json` has a current repository role:

- test/typecheck/lint/policy/architecture/format scripts feed Tier 1;
- asset scripts feed deterministic build/acceptance;
- build/dev/desktop remain current developer/runtime commands;
- browser smoke scripts feed Tier 2;
- `security:audit` is the Stack 7 supply-chain check.

No npm script is removed.

## Workflow scripts

The repository retains one permanent GitHub Actions workflow. Stack 7 consolidates existing permanent acceptance into that workflow rather than deleting browser/visual coverage or creating stack-specific permanent workflow drift.

## Follow-up rule

A future dead-code cleanup may promote a candidate to category 1 only after repository-wide reference search, active PR/base dependency review, replacement identification, and fresh verification prove removal is safe. Authority cutovers must occur in their owning simulation/presentation stack, not through repository hygiene.
