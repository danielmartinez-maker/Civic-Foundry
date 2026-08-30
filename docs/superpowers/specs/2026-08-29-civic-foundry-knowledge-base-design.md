# Civic Foundry Knowledge Base — Documentation Design

## Status

Approved in chat on 2026-08-29.

## Goal

Create a durable, AI-readable and developer-readable project knowledge layer that explains what Civic Foundry is, how its major systems fit together, what is implemented today, what is transitional, what is target architecture, and where authoritative technical truth lives.

The documentation must reduce onboarding time and prevent future work from confusing roadmap intent with shipped behavior.

## Core documentation rule

Every important claim about Civic Foundry must fall into one of three statuses:

- **Implemented** — exists in the current runtime and is supported by current repository behavior/tests.
- **Transitional** — exists as a compatibility seam, temporary implementation, migration bridge, or partially replaced subsystem.
- **Target** — approved future design that must not be described as shipped.

When a topic has a lower-level authoritative engineering document, the game knowledge layer summarizes and links to it rather than duplicating its entire specification.

## Documentation topology

The project uses three documentation layers.

### Layer 1 — Entry point and project map

`docs/README.md` is the canonical documentation index. It tells a new contributor or AI which document to read for each question and explains source-of-truth precedence.

### Layer 2 — Game knowledge base

Focused documents under `docs/game/` explain the product and major system domains:

- `GAME_BIBLE.md`
- `DESIGN_PILLARS.md`
- `PLAYER_EXPERIENCE.md`
- `CURRENT_STATE.md`
- `ROADMAP.md`
- `SYSTEMS_OVERVIEW.md`
- `STATUS_AND_AUTHORITY.md`
- `WORLD_AND_URBAN_FABRIC.md`
- `TRANSPORTATION_AND_MOBILITY.md`
- `ECONOMY_HOUSING_AND_FIRMS.md`
- `CIVIC_GOVERNMENT_AND_INFRASTRUCTURE.md`
- `RENDERING_ART_AND_UI.md`
- `PERSISTENCE_DETERMINISM_AND_PERFORMANCE.md`
- `CONTENT_SCENARIOS_AND_MODDING.md`
- `AI_CONTRIBUTOR_CONTEXT.md`
- `GLOSSARY.md`

These documents are intentionally broader than implementation specs. They should let someone understand the game before reading code.

### Layer 3 — Engineering authority and historical records

Existing documents remain authoritative for implementation-level details:

- `docs/ARCHITECTURE.md`
- `docs/SIMULATION.md`
- `docs/SAVE_FORMAT.md`
- `docs/TESTING.md`
- `docs/ENGINEERING_STANDARDS.md`
- `docs/BALANCING.md`
- `docs/art/ASSET_BIBLE.md`
- `docs/adr/`
- approved designs and plans under `docs/superpowers/`

Historical plans and designs explain why decisions were made, but they do not override current runtime documentation when they conflict with accepted implementation.

## Source-of-truth precedence

When two documents disagree, use this order unless an ADR explicitly establishes a narrower architectural rule:

1. current accepted code and verification evidence;
2. current `README.md`, `docs/ARCHITECTURE.md`, `docs/SAVE_FORMAT.md`, and accepted ADRs;
3. `docs/game/CURRENT_STATE.md` and `docs/game/STATUS_AND_AUTHORITY.md`;
4. other `docs/game/` explanatory documents;
5. active approved phase design;
6. implementation plans;
7. old development logs and superseded specs.

A future design never silently upgrades itself to implemented status.

## Product framing

The knowledge base must consistently describe Civic Foundry as a systems-heavy city, metropolitan and regional simulation focused on inspectable causality. Major outcomes should emerge from interacting geography, infrastructure, accessibility, land economics, development, households, firms, mobility, services, finance, politics and policy.

The player is a city-builder and municipal decision-maker operating a physical, economic and institutional system. The game should reward understanding interactions rather than optimizing disconnected meters.

## Current architecture framing

The knowledge base must preserve these current accepted boundaries:

- `SimulationCore` is the gameplay compatibility facade.
- `SimulationKernel` coordinates deterministic execution.
- `WorldFoundation` is the sole physical/geographic authority.
- `CadastralGraph` is the legal-land authority.
- `LotSystem` is a derived compatibility facade rather than a competing land source of truth.
- Urban Fabric owns parcel zoning, physical `BuildingV2`, property and redevelopment mechanics within its accepted scope.
- the production world renderer is `GpuWorldRenderer` using PixiJS/WebGL.
- Electron is a desktop host rather than a simulation authority.
- Save V9 is the current default persistence envelope.
- inherited traffic, transit, economy, housing, services and municipal systems remain playable compatibility domains until later replacement phases assume authority.

## Roadmap framing

Roadmap documentation must distinguish accepted completed work from future replacement phases.

Completed/current major tranches include:

- Phase 0A kernel skeleton and deterministic scheduling;
- 1R World Foundation 2.0;
- 2R Urban Fabric 2.0;
- desktop GPU runtime.

The next major replacement phase is 3R Transportation Engine 2.0. Later target phases cover civic institutions, mobility/transit, economy, real-estate capitalism, households, infrastructure, environment, government finance, politics, planning law, construction/megaprojects, regional simulation, agglomeration, social outcomes, institutional decision systems, analytics, scenarios/editor/replay/modding.

## Non-negotiable concepts to document

The knowledge base must make these principles easy to discover:

1. Determinism and replayability.
2. One authoritative owner per domain.
3. Presentation is read-only with respect to simulation authority.
4. Conserved quantities reconcile.
5. Important outcomes expose causal explanations.
6. Network effects require actual connectivity/capacity.
7. Fidelity is tiered rather than universally microscopic.
8. Saves migrate authoritative state deliberately and rebuild derived state.
9. Historical state is never fabricated during migration.
10. Performance gates are part of feature acceptance.
11. Simulation cadence is explicit and frame-rate independent.
12. Compatibility implementations remain until replacements pass parity and acceptance gates.

## AI onboarding requirements

`AI_CONTRIBUTOR_CONTEXT.md` must tell an AI agent to:

- read `docs/README.md` first;
- inspect `CURRENT_STATE.md`, `ROADMAP.md`, and `STATUS_AND_AUTHORITY.md` before proposing architecture changes;
- verify code before claiming a target feature exists;
- preserve authority boundaries and deterministic behavior;
- use existing compatibility seams rather than creating second owners;
- update documentation when accepted runtime truth changes;
- avoid treating old plans as current implementation.

## Maintenance policy

A phase or architectural merge that changes current truth should update at minimum:

- `README.md` when the public runtime summary changes;
- `docs/ARCHITECTURE.md` when ownership or runtime boundaries change;
- `docs/SAVE_FORMAT.md` when persistence changes;
- `docs/game/CURRENT_STATE.md` when shipped capability changes;
- `docs/game/ROADMAP.md` when phase status changes;
- the relevant focused game-domain document.

Docs should prefer stable concepts and links over copied implementation inventories. This keeps the knowledge base useful without forcing every source-code rename to touch many files.

## Acceptance criteria

The documentation pass is accepted when:

- `docs/README.md` gives a clear reading path;
- the focused game docs cover product vision, gameplay, architecture status, world/land, transport, economy, people/housing, public systems, rendering/art/UI, persistence/performance, content/modding and terminology;
- current vs transitional vs target state is explicit;
- existing authoritative engineering docs are linked rather than contradicted;
- no document claims unfinished 3R+ systems are already authoritative;
- Save V9, World Foundation, Urban Fabric and GPU desktop runtime are accurately represented as current accepted state;
- an unfamiliar developer or AI can determine where to find authoritative information without reading the entire repository.