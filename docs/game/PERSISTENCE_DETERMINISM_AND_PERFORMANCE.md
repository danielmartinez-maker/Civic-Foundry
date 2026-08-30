# Civic Foundry — Persistence, Determinism & Performance

## Why these are game-design requirements

Persistence, determinism and performance are not only engineering concerns. They define whether Civic Foundry can sustain a long-lived city whose outcomes are trustworthy, reproducible and inspectable.

Detailed authority:

- persistence: [`../SAVE_FORMAT.md`](../SAVE_FORMAT.md)
- simulation: [`../SIMULATION.md`](../SIMULATION.md)
- testing: [`../TESTING.md`](../TESTING.md)
- engineering policy: [`../ENGINEERING_STANDARDS.md`](../ENGINEERING_STANDARDS.md)

## Determinism

Core promise:

> Same authoritative state + same seed/random-stream state + same ordered commands must produce the same authoritative future.

This enables:

- reliable tests;
- reproducible bugs;
- deterministic save/load continuation;
- migration verification;
- future replay/scenario validation;
- meaningful causal comparison between interventions.

## Simulation time

Authoritative simulation time is explicit and independent of render frames.

Different domains may use different cadences. Examples conceptually:

- traffic: fine cadence;
- service operations: operational cadence;
- markets: daily/weekly/monthly cadence;
- budgets/demographics: slower cadence.

A fast monitor or dropped render frame must not alter economic or demographic outcomes.

## Deterministic ordering

When several systems or commands could affect shared state, ordering must be explicit and stable.

`SimulationKernel` is responsible for deterministic orchestration infrastructure. It should enforce declared dependencies rather than letting incidental JavaScript iteration or UI timing choose outcomes.

## Randomness

Randomness must be reproducible and namespaced.

Conceptual streams include domains such as:

- world generation;
- demographics;
- firms;
- incidents;
- traffic;
- development;
- finance;
- weather;
- politics;
- regional flows.

Adding a new random draw in one domain should not perturb unrelated domains merely by advancing one global random sequence.

## Conservation

Systems should identify quantities that must reconcile.

Examples:

- population/cohort weight;
- housing occupancy;
- money/cash transfers;
- inventory;
- cargo/freight orders;
- transit passenger weight;
- developer capital;
- debt principal;
- infrastructure capacity/load where applicable.

A conservation invariant is usually more valuable than a cosmetic “looks plausible” test.

## Current persistence — Save V9

Current default envelope:

```text
saveVersion: 9
gameVersion: 0.9.0-urban-fabric
```

V9 contains the accepted V8 World Foundation state plus current Urban Fabric state, including:

- cadastral snapshot;
- parcel zoning assignments;
- canonical `BuildingV2` state;
- property-market state.

The exact schema and validation rules are defined in [`../SAVE_FORMAT.md`](../SAVE_FORMAT.md).

## Save V8 historical role

Save V8 is the explicit World Foundation 2.0 format.

Current V9 loading restores/migrates the inherited V8 candidate first so physical world authority exists before terrain-dependent compatibility systems are constructed. Urban Fabric state is then established/validated.

V8 is not silently repurposed as V9.

## Migration philosophy

A migration must:

1. validate source state;
2. preserve existing authoritative facts;
3. initialize genuinely new state transparently;
4. avoid fabricated historical transactions/events;
5. rebuild derived state where possible;
6. validate new references/invariants;
7. prove save → load → continue equivalence for relevant scenarios.

### No fabricated history

If a new feature tracks transactions, incidents or time-series data that older saves never recorded, migration should begin that history at the migration boundary unless the past can be reconstructed exactly.

Do not create invented past events just to fill a chart.

## Authoritative vs derived state

Persist authoritative state when rebuilding it would lose information.

Typical derived/rebuildable state includes:

- route caches;
- spatial indexes;
- render geometry;
- heatmaps;
- accessibility surfaces;
- some analytical rollups;
- legacy projections that can be derived from canonical state.

Persisting derived data can be acceptable for performance only if divergence is impossible or validated. It must never create a second authority.

## Identity stability

Long-lived simulation requires stable entity identity.

Examples:

- canonical parcels keep/retire IDs through explicit cadastral lineage;
- historical property records may reference retired parcels only when lineage validates them;
- save migrations must not randomly regenerate IDs and break cross-domain references;
- derived legacy lot identity remains distinct from canonical parcel identity.

## Atomic mutations

Cross-domain transactions should either fully succeed or fully fail.

Urban Fabric cadastral mutation is the current model: candidate geometry is validated, dependent references are staged, authorities commit in a fixed order, and rollback restores original state on failure.

Future property transfers, finance, construction and infrastructure changes should follow the same conservation/atomicity philosophy when multiple owners are affected.

## Testing layers

### Unit tests

Pure geometry, formulas, state transitions, finance, deterministic decision logic.

### Integration tests

Cross-domain chains such as:

```text
road closure
→ commute delay
→ labor matching decline
→ firm margin pressure
```

or:

```text
transit improvement
→ accessibility gain
→ land/development response
```

### Invariant tests

Check conservation and impossible states.

Examples:

- no negative population weight;
- occupancy does not exceed capacity;
- no negative inventory;
- cargo delivered/cancelled once;
- cash transfers reconcile;
- no duplicate housing occupancy;
- no conflicting ownership;
- no vehicle on deleted topology;
- no utility capacity from disconnected assets.

### Deterministic replay/continuation

Same snapshot and commands should produce identical authoritative results. Cross-version migration fixtures should remain deterministic after upgrade.

### Fuzz/property tests

Useful for cadastral geometry, network mutations, saves, ledgers and generated command sequences.

## Long-run simulation

City sims fail in ways short unit tests cannot expose. The verification program should include deterministic long-run horizons such as days, months, years and multi-decade runs.

Watch for:

- NaN/Infinity;
- runaway population or economic drift from numerical defects;
- phantom money/inventory;
- orphan references;
- stuck queues;
- broken route caches;
- save divergence;
- memory growth;
- system-order dependence not declared in architecture.

## Performance philosophy

Performance is part of feature acceptance.

Every major phase should know its scale behavior in terms of:

- simulation milliseconds by cadence/system;
- entity/cohort counts;
- route/pathfinding volume and cache hit rate;
- memory;
- save size and load/save cost;
- browser/desktop frame time.

## Scaling tools

Preferred techniques include:

- tiered fidelity;
- weighted cohorts;
- bounded decision cadence;
- deterministic spatial indexes;
- revisioned/invalidation-aware caches;
- batching and data-oriented hot paths where measured;
- derived-state rebuilding;
- GPU presentation/LOD independent from simulation authority.

Avoid “optimizing” by silently removing the causal connection that makes a system meaningful.

## Performance budgets and replacement phases

A new 2.0 replacement cannot claim success because it is more detailed. It must also meet scale and long-run budgets representative of mature cities.

If a system is too expensive, first ask:

- Does every entity need explicit fidelity?
- Can decisions run less frequently?
- Can spatial queries be indexed?
- Can stable results be cached by revision?
- Can cohorts preserve the behavior?
- Can rendering reduce LOD without changing simulation?

## Debugging principle

A deterministic city should be explainable from state plus ordered events/commands. When a bug appears, prefer reproducing the exact state transition rather than adding hidden corrective clamps that mask the source.

Civic Foundry’s technical quality depends on the simulator remaining a coherent dynamical system across thousands of ticks and many save versions.