# Civic Foundry — Content, Scenarios & Modding

## Status summary

- Current data/assets/build pipeline: **Implemented repository infrastructure**.
- Authored world/scenario inputs: **Implemented in limited/current forms where supported**.
- Full scenario editor, deterministic replay/challenge framework and general content modding: **Target Phase 20**.
- Executable scripting/mod API: **Deferred Target** until sandbox/security/determinism rules are explicit.

## Content philosophy

Civic Foundry should move static definitions into data when doing so improves authoring, balancing and extensibility without weakening type safety or deterministic behavior.

Good data-driven candidates include:

- world/scenario configuration;
- building archetypes;
- road types;
- industries/products;
- service definitions;
- policy definitions;
- transit vehicle/service definitions;
- economic parameters;
- art/asset references.

Core simulation algorithms and authority rules should remain code, not opaque arbitrary script files.

## Current asset pipeline

The repository contains source assets and deterministic/generated runtime outputs governed by repository asset policy and the art bible.

Use [`../art/ASSET_BIBLE.md`](../art/ASSET_BIBLE.md) for the exact art-production contract.

General principles:

- source assets and runtime/generated assets have explicit roles;
- deterministic generation/validation is preferred where the pipeline supports it;
- simulation code references stable asset identifiers/metadata rather than inventing file paths throughout domains;
- visual variants must not accidentally alter simulation properties;
- generated atlases should be reproducible from accepted inputs/tooling.

## Data definitions

Data should be validated at load/build time rather than trusted as arbitrary objects.

A robust definition normally needs:

- stable ID;
- schema/type;
- units for numerical values;
- version/migration strategy when persistence references the ID;
- validation of cross-references;
- deterministic ordering when iteration affects outcomes.

## Units and meaning

Avoid “magic data” whose unit or interpretation is unclear.

Examples:

- money should specify currency/unit conventions used by the sim;
- speed should use an explicit internal unit;
- area and length should respect canonical geometry units;
- cadence/rates should state the time basis;
- probabilities should define when they are evaluated.

The balancing layer can expose friendly values while preserving clear internal semantics.

## World/scenario authoring

World Foundation already supports seeded generation and scenario-authored physical overrides.

An authored scenario should be able to control relevant starting facts such as:

- world seed/preset or explicit geography;
- terrain/water/physical conditions;
- starting city/network state where supported;
- treasury and policy setup;
- population/economic starting conditions;
- challenge objectives;
- external/regional conditions in later phases.

Authored overrides must not invent hidden contamination/history or bypass authoritative validation.

## Scenario goals — Target expansion

Scenarios can provide structured problems rather than only sandbox starts.

Examples:

- revive a declining industrial city;
- grow while maintaining housing affordability;
- recover after a flood/disaster;
- balance a transit expansion with fiscal limits;
- decarbonize infrastructure;
- redevelop a constrained central district;
- manage rapid population growth;
- stabilize a debt/maintenance crisis.

Objectives should evaluate actual system state rather than bespoke scenario-only scores where possible.

## Deterministic challenge design

Challenge scenarios benefit from deterministic simulation because two runs can be compared meaningfully.

A challenge definition may eventually include:

- fixed seed/starting save;
- allowed/disallowed actions;
- objective metrics;
- time horizon;
- success/failure conditions;
- scoring formula if needed;
- deterministic external events.

## Phase 20 — Scenario Editor — Target

The editor should author validated data, not bypass the simulation.

Potential editor capabilities:

- generate/select physical world presets;
- draw/adjust administrative boundaries;
- place initial roads/infrastructure;
- define parcels/zoning where permitted;
- seed districts/buildings/industry;
- configure fiscal/economic conditions;
- define goals/events;
- validate the complete scenario before export.

Editor output should use the same runtime schemas/validators wherever practical.

## Replay — Target

Deterministic replay should be based on authoritative initial state plus ordered commands/events needed to reproduce the run.

Replay is useful for:

- debugging;
- regression fixtures;
- challenge verification;
- comparing policies/interventions;
- future player sharing.

A replay log should not replace save authority; it is a reproducibility tool.

## Modding direction — Target

Preferred first mod layer: **content-first modding**.

Safer categories include:

- building definitions/assets;
- road/vehicle/service definitions;
- industry/product data;
- scenarios;
- policy/economic parameter packs;
- cosmetic themes.

Benefits:

- easier validation;
- better deterministic guarantees;
- lower security risk;
- lower save-compatibility risk;
- simpler cross-platform distribution.

## Executable scripting — Deferred

Arbitrary code/script mods should not be enabled until Civic Foundry explicitly defines:

- sandbox/security model;
- allowed APIs;
- deterministic execution rules;
- performance budgets;
- save compatibility/versioning;
- multiplayer/replay implications if those ever apply;
- error isolation.

A powerful scripting API that can mutate internal objects directly would undermine one-authority architecture and deterministic replay.

## Stable IDs and mod persistence

If a save references modded content, the system eventually needs policies for:

- missing mods/content IDs;
- version changes;
- migration;
- fallback behavior;
- whether a save is considered valid/degraded.

Do not silently replace a missing mod building/industry with an unrelated base-game definition.

## Content validation

Build/runtime validation should catch:

- duplicate IDs;
- missing cross-references;
- invalid ranges/units;
- malformed geometry/footprints;
- impossible production recipes;
- invalid network/service definitions;
- nondeterministic ordering assumptions.

## Balance vs content

Data-driven definitions make balancing easier, but balance values still need causal meaning. Avoid using arbitrary multipliers to compensate for a broken underlying system.

See [`../BALANCING.md`](../BALANCING.md) for current balancing conventions.

## Principle

Extensibility should make Civic Foundry easier to author and explore without turning the simulator into an unvalidated collection of scripts. The same authority, determinism and conservation rules that protect the base game should protect scenarios and mods.