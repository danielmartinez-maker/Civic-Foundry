# Civic Foundry Knowledge Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a canonical, status-aware documentation layer that lets developers and AI agents understand Civic Foundry's game design, current runtime, major systems, roadmap, authority boundaries and engineering constraints.

**Architecture:** Add one documentation entry point at `docs/README.md` and a focused `docs/game/` knowledge base. Existing engineering documents remain authoritative for detailed implementation; the new layer summarizes, cross-links and clearly labels Implemented, Transitional and Target state.

**Tech Stack:** Markdown, existing Civic Foundry repository documentation conventions, GitHub.

**Spec:** `docs/superpowers/specs/2026-08-29-civic-foundry-knowledge-base-design.md`

## Global Constraints

- Do not describe approved future design as implemented runtime behavior.
- Preserve `WorldFoundation` as physical/geographic authority and `CadastralGraph` as legal-land authority.
- Preserve `SimulationCore` as the current gameplay compatibility facade and `SimulationKernel` as deterministic execution coordinator.
- Preserve `LotSystem` as a derived compatibility facade.
- Preserve Save V9 as the current default persistence envelope.
- Preserve `GpuWorldRenderer`/PixiJS/WebGL as the production world-rendering path and Electron as a host only.
- Link to existing engineering authority instead of copying large technical specifications.
- Use explicit Implemented / Transitional / Target status language where ambiguity could arise.

---

### Task 1: Documentation entry point

**Files:**
- Create: `docs/README.md`

**Interfaces:**
- Consumes: existing top-level engineering docs and `docs/game/` files.
- Produces: canonical onboarding route for humans and AI.

- [ ] Create a source-of-truth hierarchy and recommended reading paths.
- [ ] Catalog game knowledge, engineering, art, ADR and historical-plan documents.
- [ ] Explain Implemented / Transitional / Target status semantics.
- [ ] Add maintenance rules for future accepted changes.
- [ ] Verify every linked path exists or is created by this plan.
- [ ] Commit.

### Task 2: Product identity and player model

**Files:**
- Create: `docs/game/GAME_BIBLE.md`
- Create: `docs/game/DESIGN_PILLARS.md`
- Create: `docs/game/PLAYER_EXPERIENCE.md`

**Interfaces:**
- Consumes: approved Civic Foundry 2.0 master design and current README.
- Produces: stable description of what the game is and what decisions should feel like.

- [ ] Define genre, fantasy, scope and causal city-system model.
- [ ] Define design pillars and explicit anti-goals.
- [ ] Define player role, game loop, time horizons, information model and progression philosophy.
- [ ] Mark long-horizon ambitions as Target where appropriate.
- [ ] Commit.

### Task 3: Runtime truth and roadmap

**Files:**
- Create: `docs/game/CURRENT_STATE.md`
- Create: `docs/game/ROADMAP.md`
- Create: `docs/game/STATUS_AND_AUTHORITY.md`

**Interfaces:**
- Consumes: `README.md`, `docs/ARCHITECTURE.md`, Save V9 documentation and approved master design.
- Produces: definitive high-level answer to what exists now, what owns each domain and what comes next.

- [ ] Record completed Phase 0A, 1R, 2R and desktop GPU runtime.
- [ ] Record inherited compatibility domains that remain playable but transitional.
- [ ] Record 3R as the next major authority replacement.
- [ ] Summarize later Phase 4R–20 targets without claiming completion.
- [ ] Include authority matrix and conflict-resolution rules.
- [ ] Commit.

### Task 4: Systems map

**Files:**
- Create: `docs/game/SYSTEMS_OVERVIEW.md`

**Interfaces:**
- Consumes: current simulation directories and master architecture.
- Produces: one causal map of the major game domains and their dependencies.

- [ ] Describe world/geography, land/development, transport, economy, population/housing, services, utilities, government and presentation.
- [ ] Show the principal causal chain and cross-domain feedback loops.
- [ ] Explain fidelity tiers and cadence expectations.
- [ ] Commit.

### Task 5: Physical city and urban fabric

**Files:**
- Create: `docs/game/WORLD_AND_URBAN_FABRIC.md`

**Interfaces:**
- Consumes: `docs/ARCHITECTURE.md`, World Foundation and Urban Fabric accepted implementation.
- Produces: game-level explanation of geography, terrain, hydrology, parcels, zoning, buildings and redevelopment.

- [ ] Explain physical vs legal land authority.
- [ ] Explain parcel, zoning-envelope, BuildingV2, lifecycle and property/development mechanics.
- [ ] Explain compatibility boundaries and future dependencies.
- [ ] Commit.

### Task 6: Transportation and mobility

**Files:**
- Create: `docs/game/TRANSPORTATION_AND_MOBILITY.md`

**Interfaces:**
- Consumes: current traffic/transit compatibility systems and Phase 3R/5R target designs.
- Produces: clear current-vs-target transport model.

- [ ] Document current deterministic roads, pathfinding, moving vehicles, intersections, congestion and transit capabilities.
- [ ] Mark lane/turn/signal/parking/crash authority as 3R Target.
- [ ] Mark schedule/depot/heterogeneous traveler expansion as later Target.
- [ ] Commit.

### Task 7: Economy, housing and firms

**Files:**
- Create: `docs/game/ECONOMY_HOUSING_AND_FIRMS.md`

**Interfaces:**
- Consumes: current economy/employment/housing/development systems and Phase 6R/7R/8 targets.
- Produces: economic gameplay model with compatibility and future-state distinctions.

- [ ] Explain current firms, production, inventories, freight, employment and housing economics.
- [ ] Explain Urban Fabric development/property integration.
- [ ] Define Target input-output economy, explicit property markets, finance and household representation.
- [ ] Commit.

### Task 8: Civic systems, government and infrastructure

**Files:**
- Create: `docs/game/CIVIC_GOVERNMENT_AND_INFRASTRUCTURE.md`

**Interfaces:**
- Consumes: current services/utilities/tax/treasury systems and Phase 4R/9/10/11/12 targets.
- Produces: single game-level map of municipal operations and institutional evolution.

- [ ] Explain existing services and municipal finance baseline.
- [ ] Define future operating-institution, network-utility, environment, fund-accounting and politics targets.
- [ ] Preserve route/capacity/finance causality requirements.
- [ ] Commit.

### Task 9: Presentation identity

**Files:**
- Create: `docs/game/RENDERING_ART_AND_UI.md`

**Interfaces:**
- Consumes: current GPU runtime, camera contract and `docs/art/ASSET_BIBLE.md`.
- Produces: unified presentation rules for rendering, camera, miniature aesthetic, overlays and UI behavior.

- [ ] Explain PixiJS/WebGL production path and Electron host boundary.
- [ ] Document free 3D-feeling isometric orbit/zoom intent within current projection constraints.
- [ ] Document miniature/tilt-shift-inspired visual goal as an aesthetic target where not yet fully implemented.
- [ ] Link art production rules rather than duplicate asset specs.
- [ ] Commit.

### Task 10: Determinism, persistence and performance

**Files:**
- Create: `docs/game/PERSISTENCE_DETERMINISM_AND_PERFORMANCE.md`

**Interfaces:**
- Consumes: `SAVE_FORMAT.md`, `TESTING.md`, `SIMULATION.md`, `ENGINEERING_STANDARDS.md`.
- Produces: accessible explanation of the technical promises that shape game design.

- [ ] Explain deterministic inputs, RNG streams, explicit cadence and replay expectations.
- [ ] Explain authoritative vs derived persistence and Save V9 migration philosophy.
- [ ] Explain conservation and invariant philosophy.
- [ ] Explain scale/performance as acceptance criteria.
- [ ] Commit.

### Task 11: Content, scenarios and extensibility

**Files:**
- Create: `docs/game/CONTENT_SCENARIOS_AND_MODDING.md`

**Interfaces:**
- Consumes: existing asset/data pipeline and Phase 20 target design.
- Produces: policy for data-driven definitions, scenario authoring, editor/replay and safe modding direction.

- [ ] Separate current deterministic data/assets from future editor/mod support.
- [ ] Explain content-first modding preference and executable-scripting caution.
- [ ] Commit.

### Task 12: AI/contributor onboarding and vocabulary

**Files:**
- Create: `docs/game/AI_CONTRIBUTOR_CONTEXT.md`
- Create: `docs/game/GLOSSARY.md`

**Interfaces:**
- Consumes: entire knowledge base.
- Produces: fast operational context and stable project vocabulary.

- [ ] Add mandatory reading order for AI contributors.
- [ ] Add rules against second authorities, fabricated implementation claims and stale-plan reuse.
- [ ] Define core terms including authoritative state, derived state, compatibility facade, tranche, cadence, parcel, lot, BuildingV2, WorldFoundation, CadastralGraph and deterministic replay.
- [ ] Commit.

### Task 13: Cross-link and verification pass

**Files:**
- Modify: new documentation files only unless a broken existing reference must be corrected.

**Interfaces:**
- Consumes: all created files.
- Produces: internally consistent knowledge base.

- [ ] Verify paths and cross-links.
- [ ] Search for language that confuses Target with Implemented state.
- [ ] Confirm Save V9 and current authority matrix are consistent across files.
- [ ] Confirm 3R is described as the next major replacement phase.
- [ ] Confirm existing engineering docs remain the linked authority for implementation details.
- [ ] Commit final documentation corrections.