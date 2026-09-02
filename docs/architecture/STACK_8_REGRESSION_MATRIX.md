# Stack 8 — Permanent Cross-Domain Regression Matrix

This matrix is the machine-test ownership index for Civic Foundry integration boundaries. A new cross-domain mutation should add or extend a row here in the same tranche.

| Boundary | Mutation | Expected invariant | Test file / suite | Owner | Failure code / class | Transaction expectation | Replay expectation |
|---|---|---|---|---|---|---|---|
| Cadastre ↔ BuildingV2 | road/cadastral change | surviving valid building identity/history is preserved or mutation rejects atomically | cadastral runtime mutation suites; Stack 0 authoritative-state tests | cadastre + building domain owner | topology/reference failure; protected canonical rejection | all-or-nothing | same mutation sequence → same authority hash |
| Parcel ↔ Property | split/assembly/ROW | no dangling current holding; historical retired IDs require lineage | cadastral runtime mutation + Save V9 tests | cadastre/property | `ReferenceIntegrityFailure` substrate | all-or-nothing | same parcel rewrite → same holdings/history hash |
| Cadastre ↔ legacy lots | topology change | legacy lots are derived from committed cadastre and never become authority | cadastral runtime mutation tests | cadastre; lot compatibility adapter | `CompatibilityBoundaryFailure` substrate | rebuild only after accepted commit; rollback derives from restored cadastre | deterministic projection |
| Development ↔ Building | award | canonical project/building state materializes exactly once | Stack 0 transaction tests | development/building | `TransactionFailure` on rollback failure | all-or-nothing | same inputs → same project/building state |
| Development ↔ Economy | award | capital/economic state and building materialization agree | Stack 0 development rollback tests | development/economy | transaction/conservation failure | all-or-nothing | same pre-state/command → same hash |
| Development ↔ Housing | award/redevelopment | relocation/displacement state consistent with committed project | existing land/housing transaction tests | development/housing | invariant/transaction failure | all-or-nothing | deterministic continuation |
| Freight ↔ Inventory | failed/full delivery | cargo is neither duplicated nor destroyed | freight conservation tests | freight/inventory | `ConservationFailure` category | conservation-safe commit/cancel | same route/failure → same inventory/cargo state |
| Transit ↔ Passenger queue | vehicle failure | onboard passenger weight is recovered/accounted; no silent deletion | transit failure/recovery tests | transit/mobility | conservation/invariant failure | recovery must be atomic enough to conserve cohort weight | same failure tick → same queue/vehicle result |
| Save ↔ Runtime | invalid payload | reject before returned live core contains malformed state | `save-v9-adversarial.test.ts` | persistence + domain validators | hydration/reference failure | candidate-first hydration | same payload → same rejection seam |
| Save ↔ Runtime | save/load/continue | continuation preserves deterministic authoritative state | `stack8-fuzz-soak.test.ts`, Save V9 suites | persistence | `DeterminismFailure` on diagnostic mismatch | N/A | required equality |
| Transport ↔ Transit | topology invalidation | stale route references cannot silently survive; response deterministic | transport/transit suites | transport/transit | scheduling/reference/topology category | domain-specific | required |
| Traffic ↔ numeric input | submit/load step | NaN/Infinity rejected before traffic mutation | `stack8-numeric-safety.test.ts` | traffic | `traffic-non-finite-*` | reject-before-mutate | same malformed input → same code |
| Kernel ↔ authoritative domains | system exception | clock/commands/events/RNG/domain state restore to pre-tick checkpoint | `stack0-kernel-rollback.test.ts`, `stack8-debugging-architecture.test.ts` | kernel + participants | `kernel-step-failed`; rollback fail-stop | reverse deterministic rollback | same injected failure → same pre-failure hash |
| Kernel ↔ scheduler | registration/order | ambiguous write/write or read/write conflicts rejected; order stable | kernel scheduler suites + Stack 8 contracts | kernel | `SchedulingFailure` at orchestration boundary | N/A | manifest stable |
| Revision ↔ derived cache | semantic mutation | only dependent caches become stale; no-op does not churn revisions | `stack8-debugging-architecture.test.ts` | source authority + cache owner | stable invalidation reason | N/A | same mutation sequence → same revision vector |
| Simulation ↔ Renderer | authority change | renderer may update presentation but cannot import mutation internals/write simulation | `architecture_policy.test.ts` + browser/visual smokes | simulation authority / renderer presentation | architecture rule `presentation-no-authoritative-mutation` | renderer excluded | renderer state not required for simulation replay |
| Diagnostics ↔ Simulation | trace/perf/hash read | diagnostics do not change authoritative hash or consume RNG | `stack8-core-diagnostics.test.ts` | diagnostics | invariant/determinism failure substrate | never participates in gameplay commit | diagnostics may be regenerated; authority hash must match |
| RNG ↔ authoritative code | new randomness | direct `Math.random()` forbidden; named streams required | `architecture_policy.test.ts`, `architecture:check` | owning domain + kernel RNG registry | architecture rule `authoritative-no-math-random` | N/A | named stream state captured in repro bundle |
| Repro bundle ↔ replay | failing operation | same failure code + pre-failure authority hash | `stack8-debugging-architecture.test.ts` | diagnostics/replay | `repro-failure-code-mismatch`, `repro-authority-hash-mismatch` | N/A | required equality |
| Reference owner ↔ target | validation/hydration/commit seam | duplicate/dangling/stale/non-finite facts are detectable with owner+target context | `stack8-debugging-architecture.test.ts` + Save V9 adversarial suites | caller’s domain owner | `duplicate-entity-id`, `dangling-reference`, `stale-reference-revision`, `non-finite-authoritative-state` | validate before commit where applicable | deterministic failure order |

## Rule for new rows

A cross-domain regression row must identify:

1. the authoritative owner on each side of the seam;
2. the mutation or hydration path that can invalidate the relationship;
3. the invariant that must remain true;
4. the focused regression suite;
5. stable failure classification where machine-readable diagnostics are useful;
6. whether a transaction is required and what must roll back;
7. whether deterministic replay/equality is required.

A compatibility adapter may be a participant or read model, but the matrix must not describe it as the canonical owner of the underlying fact.
