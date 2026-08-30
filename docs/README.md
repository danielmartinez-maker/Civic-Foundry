# Civic Foundry Documentation

This directory is the canonical map for understanding Civic Foundry. Start here before reading old plans, changing simulation ownership, or making claims about what the game currently supports.

## Status language

Every major capability should be described using one of these terms:

- **Implemented** — accepted current runtime behavior supported by repository code and verification.
- **Transitional** — playable/current compatibility behavior that remains while a replacement system is being introduced.
- **Target** — approved future design. Target behavior must never be presented as already shipped.

If a document does not state status clearly, verify against current code, `README.md`, `docs/ARCHITECTURE.md`, and accepted ADRs before assuming implementation.

## Recommended reading order

For a new developer or AI contributor:

1. [`game/GAME_BIBLE.md`](game/GAME_BIBLE.md) — what Civic Foundry is.
2. [`game/CURRENT_STATE.md`](game/CURRENT_STATE.md) — what exists today.
3. [`game/STATUS_AND_AUTHORITY.md`](game/STATUS_AND_AUTHORITY.md) — which system owns which facts.
4. [`game/SYSTEMS_OVERVIEW.md`](game/SYSTEMS_OVERVIEW.md) — how the city systems interact.
5. [`game/ROADMAP.md`](game/ROADMAP.md) — what comes next.
6. The focused domain document relevant to the work.
7. The lower-level engineering document for implementation details.

## Game knowledge base

| Document | Purpose |
| --- | --- |
| [`game/GAME_BIBLE.md`](game/GAME_BIBLE.md) | Product identity, scope, fantasy, causal model and success definition. |
| [`game/DESIGN_PILLARS.md`](game/DESIGN_PILLARS.md) | Non-negotiable design principles and anti-goals. |
| [`game/PLAYER_EXPERIENCE.md`](game/PLAYER_EXPERIENCE.md) | Player role, decision loop, time horizons, information and progression. |
| [`game/CURRENT_STATE.md`](game/CURRENT_STATE.md) | Concise snapshot of implemented and transitional runtime. |
| [`game/ROADMAP.md`](game/ROADMAP.md) | Completed tranches and approved future phases. |
| [`game/STATUS_AND_AUTHORITY.md`](game/STATUS_AND_AUTHORITY.md) | Domain authority matrix and conflict-resolution rules. |
| [`game/SYSTEMS_OVERVIEW.md`](game/SYSTEMS_OVERVIEW.md) | Cross-domain systems map and feedback loops. |
| [`game/WORLD_AND_URBAN_FABRIC.md`](game/WORLD_AND_URBAN_FABRIC.md) | Geography, terrain, hydrology, parcels, zoning, buildings and redevelopment. |
| [`game/TRANSPORTATION_AND_MOBILITY.md`](game/TRANSPORTATION_AND_MOBILITY.md) | Roads, traffic, transit and future lane-aware mobility. |
| [`game/ECONOMY_HOUSING_AND_FIRMS.md`](game/ECONOMY_HOUSING_AND_FIRMS.md) | Firms, labor, housing, development, freight and future economic depth. |
| [`game/CIVIC_GOVERNMENT_AND_INFRASTRUCTURE.md`](game/CIVIC_GOVERNMENT_AND_INFRASTRUCTURE.md) | Services, utilities, finance, institutions, environment and politics. |
| [`game/RENDERING_ART_AND_UI.md`](game/RENDERING_ART_AND_UI.md) | GPU renderer, camera, visual identity, overlays and interface principles. |
| [`game/PERSISTENCE_DETERMINISM_AND_PERFORMANCE.md`](game/PERSISTENCE_DETERMINISM_AND_PERFORMANCE.md) | Technical promises that constrain game design. |
| [`game/CONTENT_SCENARIOS_AND_MODDING.md`](game/CONTENT_SCENARIOS_AND_MODDING.md) | Data, assets, scenarios, editor/replay and modding direction. |
| [`game/AI_CONTRIBUTOR_CONTEXT.md`](game/AI_CONTRIBUTOR_CONTEXT.md) | Operating rules for AI-assisted development. |
| [`game/GLOSSARY.md`](game/GLOSSARY.md) | Stable Civic Foundry terminology. |

## Engineering authority

These documents remain authoritative for detailed implementation:

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — current runtime boundaries and domain ownership.
- [`SIMULATION.md`](SIMULATION.md) — simulation behavior and scheduling details.
- [`SAVE_FORMAT.md`](SAVE_FORMAT.md) — persistence schemas and migrations.
- [`TESTING.md`](TESTING.md) — verification strategy and gates.
- [`ENGINEERING_STANDARDS.md`](ENGINEERING_STANDARDS.md) — repository and code standards.
- [`BALANCING.md`](BALANCING.md) — balancing conventions and parameter philosophy.
- [`art/ASSET_BIBLE.md`](art/ASSET_BIBLE.md) — asset-production rules and visual constraints.
- [`adr/`](adr/) — accepted architectural decisions.

`docs/superpowers/specs/` and `docs/superpowers/plans/` contain approved designs and implementation plans. They are important historical and forward-looking records, but old plans do not override accepted runtime truth.

## Source-of-truth precedence

When documents disagree, resolve the conflict in this order unless a narrower accepted ADR controls the exact question:

1. accepted current code plus verification evidence;
2. root `README.md`, `docs/ARCHITECTURE.md`, `docs/SAVE_FORMAT.md`, accepted ADRs;
3. `game/CURRENT_STATE.md` and `game/STATUS_AND_AUTHORITY.md`;
4. other `game/` explanatory documents;
5. currently active approved phase specification;
6. implementation plans;
7. superseded specifications and development logs.

Never infer that a roadmap phase is implemented merely because a detailed specification exists.

## Documentation maintenance

A merge that changes accepted runtime truth should update the corresponding knowledge docs in the same tranche. At minimum:

- runtime ownership change → `ARCHITECTURE.md`, `game/STATUS_AND_AUTHORITY.md`, relevant domain doc;
- save change → `SAVE_FORMAT.md`, `game/CURRENT_STATE.md`, persistence doc;
- phase completion → root `README.md`, `game/CURRENT_STATE.md`, `game/ROADMAP.md`;
- presentation identity change → rendering/art docs;
- major player-facing mechanics change → game bible, player experience or relevant system doc.

Prefer links to detailed engineering authority over copying long specifications into several files.