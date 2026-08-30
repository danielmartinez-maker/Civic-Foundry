# Civic Foundry — Prism Engine Status

## Current status

**Prism Engine is not currently an accepted repository runtime module or authority name on the documented mainline.**

The current accepted engine/runtime vocabulary is built around:

- `GameApp`;
- `SimulationCore`;
- `SimulationKernel`;
- domain owners such as `WorldFoundation` and `CadastralGraph`;
- current simulation compatibility domains;
- `GpuWorldRenderer`;
- PixiJS/WebGL;
- Electron as a desktop host.

This file exists because “Prism Engine” may be used as a conceptual or future name in design discussions. Contributors must not assume a detailed Prism Engine proposal has already replaced the current architecture unless that proposal is explicitly committed, accepted and integrated.

## How to interpret Prism Engine proposals

A Prism Engine specification should be treated as **Target** until it passes the same progressive-replacement process as every other Civic Foundry subsystem.

A sophisticated design document can describe:

- ECS/data-oriented storage;
- heterogeneous memory layouts;
- multithreaded scheduling;
- GPU compute;
- multi-scale simulation;
- neural/ML integration;
- advanced temporal compression;
- quantum-inspired or other experimental algorithms;

without those capabilities being current runtime truth.

Implementation status comes from accepted code, architecture, tests and merge evidence.

## Relationship to current architecture

If the project formally adopts “Prism Engine” as the name of the underlying simulation fabric, it should normally encompass or evolve the existing architecture rather than become a second competing engine.

A coherent mapping could look conceptually like:

```text
Prism Engine (product/engine umbrella, if formally adopted)
  ├─ deterministic execution fabric
  │    └─ current SimulationKernel evolution
  ├─ domain state/authority
  │    ├─ WorldFoundation
  │    ├─ CadastralGraph
  │    └─ later transport/economy/etc owners
  ├─ spatial/data-oriented infrastructure
  ├─ persistence/replay/invariants
  └─ presentation bridge
       └─ GpuWorldRenderer / future renderer evolution
```

This is a compatibility interpretation, not a claim that such a namespace/class exists today.

## Non-negotiable compatibility requirements

Any future Prism Engine implementation must preserve Civic Foundry’s accepted architectural promises unless an explicit approved redesign replaces them:

1. deterministic authoritative outcomes;
2. one authoritative owner per domain;
3. explicit simulation cadence independent of render frames;
4. conservation/invariant validation;
5. stable entity/reference semantics;
6. deliberate save migration;
7. no fabricated history;
8. presentation cannot manufacture simulation state;
9. performance gates;
10. progressive authority transfer instead of an uncontrolled clean-slate rewrite.

## Data-oriented/ECS evolution

A data-oriented or ECS architecture can be valuable for hot simulation domains, but adoption should be evidence-driven.

Questions to answer before converting a domain:

- Which workload is actually CPU/cache bound?
- What entity/component cardinality justifies the change?
- Does ECS clarify or obscure domain authority?
- How are stable IDs and save migrations preserved?
- How are cross-domain references validated?
- Can deterministic iteration/order be guaranteed?
- What benchmark demonstrates improvement?

Avoid replacing clear domain models with ECS solely because the engine concept sounds more advanced.

## GPU and heterogeneous compute

GPU compute can be appropriate for high-volume derived calculations such as fields, visualization, some spatial kernels or parallel numerical workloads.

Authoritative GPU simulation requires stricter proof because hardware/driver numerical variation can undermine deterministic replay.

Before moving authoritative logic to GPU/heterogeneous compute, define:

- determinism tolerance/bitwise requirements;
- cross-GPU reproducibility strategy;
- fallback CPU behavior;
- serialization boundaries;
- synchronization/order rules;
- benchmark and correctness evidence.

## ML/neural systems

Machine-learning components should not become opaque authoritative decision makers without a deterministic and inspectable contract.

Potential safer uses include:

- offline content generation;
- bounded approximation with deterministic frozen models;
- player-facing forecasting/advisory tools;
- acceleration of derived analytics.

If ML affects authoritative simulation decisions, its model version, inputs, deterministic inference behavior and persistence implications must be explicit.

## Multi-scale simulation

Prism-style multi-scale simulation is consistent with the Civic Foundry fidelity-tier philosophy:

- explicit agents where sequence matters;
- weighted cohorts where heterogeneity matters;
- regional aggregates outside the detailed city.

Any temporal/spatial compression must conserve relevant quantities and preserve causal continuity when entities/flows cross fidelity boundaries.

## Adoption checklist

Before documentation may describe Prism Engine as Implemented:

- an accepted architecture/spec defines its exact role;
- current code contains the runtime components or formal namespace/umbrella;
- existing domain authority is mapped without duplication;
- persistence/migration implications are accepted;
- deterministic tests pass;
- performance benchmarks justify major architectural changes;
- root README and `docs/ARCHITECTURE.md` adopt the terminology;
- `CURRENT_STATE.md` and `STATUS_AND_AUTHORITY.md` are updated.

Until then, use Prism Engine as a **Target/conceptual design label**, not as evidence about the current runtime.