# Civic Foundry — Game Bible

## Status

**Canonical product direction.** This document describes the intended identity of Civic Foundry while distinguishing current implementation from long-horizon ambition.

## One-sentence definition

Civic Foundry is a systems-heavy city, metropolitan and regional simulation where the player shapes a living urban system and can inspect the causal chain behind important outcomes.

## Genre

Civic Foundry combines:

- city building and urban planning;
- transportation and infrastructure management;
- municipal finance and public administration;
- land and real-estate economics;
- firm, labor and freight simulation;
- public-service operations;
- long-run metropolitan development.

The design sits closer to a simulation platform with strong game structure than to a decorative sandbox.

## Player fantasy

The player is the principal civic decision-maker responsible for the physical and institutional evolution of a city. They shape streets, zoning, infrastructure, services, taxation, budgets and policy while private households, firms, developers and institutions react to actual incentives and constraints.

The player should feel like they are working with a city rather than directly puppeteering every outcome. A zoning change creates development potential; it does not magically spawn a tower. A new road changes accessibility and congestion; it does not directly add economic growth points. A new hospital requires operating capacity to create meaningful service output.

## Core causal model

The strategic architecture follows this chain:

```text
terrain and geography
→ infrastructure
→ accessibility
→ land economics
→ development
→ households and firms
→ employment and production
→ consumption and freight
→ travel and congestion
→ pollution and service demand
→ municipal finance
→ politics and policy
→ future infrastructure and development
```

The actual game is the feedback between these domains.

## What makes Civic Foundry distinctive

### Inspectable causality

Important outcomes should answer “why?”. Rising rents should be explainable through vacancy, demand, income, accessibility, financing and supply. Congestion should trace to real trips, topology, capacity and incidents. Fiscal stress should trace to revenues, obligations, maintenance and service costs.

### Physical grounding

The city exists on real modeled land. Terrain, soil, groundwater, drainage, flood susceptibility, parcels, frontage, buildings and networks should constrain what is feasible and what it costs.

### Economic agency

Private development and firms respond to economics rather than player paint alone. The long-term target includes explicit capital, finance, labor, supply chains, ownership and market transactions.

### Institutional operations

Public facilities become operating organizations rather than abstract radius emitters. Staffing, queues, fleets, budgets and access matter.

### Historical persistence

A mature city should carry history: street patterns, parcel lineage, legacy buildings, infrastructure age, debt, neighborhood trajectories and prior policy choices.

### Deterministic simulation

Same authoritative state, seed and ordered commands should produce the same future. This enables reproducible debugging, meaningful save migration and trustworthy causal inspection.

## Scale

The target experience begins with individual streets, blocks, parcels and buildings, then expands into a metropolitan system with neighboring jurisdictions and regional flows. Fidelity is tiered so the game can remain performant:

- explicit agents where sequence, routing or individual state matters;
- weighted cohorts where heterogeneity matters but full microsimulation is unnecessary;
- aggregates outside the detailed city where only regional flows matter.

## Current playable foundation

**Implemented:** deterministic kernel, World Foundation 2.0, Urban Fabric 2.0, GPU-rendered desktop path, existing roads/traffic/transit, firms/economy, population/housing, utilities, services, taxes and treasury systems.

**Transitional:** many inherited gameplay systems still use earlier abstractions behind compatibility boundaries. They remain playable until their replacement phases pass parity and acceptance gates.

**Target:** lane-aware transportation authority, deeper civic institutions, schedule-based mobility, input-output economy, explicit property finance, household demographics, utility networks, environment, government finance, politics, regional simulation, analytics, scenario editor/replay/modding and related later phases.

See [`CURRENT_STATE.md`](CURRENT_STATE.md) for the precise snapshot.

## Win condition philosophy

Civic Foundry is primarily an open-ended simulation. Success should emerge from sustained city performance rather than one universal score. Scenarios and challenge modes may impose concrete objectives such as:

- population or employment targets;
- housing affordability;
- fiscal stability;
- emissions or resilience goals;
- transport reliability;
- service outcomes;
- redevelopment of a district;
- recovery from a disaster or industrial decline.

The sandbox should remain viable without forcing a single ideological model of a “good city.” Policies create trade-offs that the simulation exposes.

## Failure and pressure

The game needs meaningful adverse states without cheap punishment. Examples include insolvency risk, infrastructure failure, congestion, housing shortage, firm closure, service overload, flooding, pollution, political opposition and long-term maintenance backlog.

Bad outcomes should usually be legible consequences of previous conditions rather than arbitrary random penalties.

## Time

Multiple simulation cadences coexist. Traffic may need fine-grained updates while property markets, budgets and demographics operate at slower intervals. Browser frame rate must never define authoritative simulation time.

Player-facing speed controls should allow inspection, normal operation and accelerated long-run planning without changing deterministic outcomes.

## Information design

The player should have three layers of information:

1. **Immediate state** — what exists and what is happening now.
2. **Diagnosis** — bottlenecks, constraints and causal contributors.
3. **History** — how the condition evolved over time.

Overlays, inspectors, charts and “Why?” explanations are gameplay tools rather than decorative dashboards.

## Long-term success definition

Civic Foundry succeeds when a player can follow and influence chains such as:

```text
zoning reform
→ more feasible floor area
→ developer interest
→ construction
→ added housing supply
→ rent response
→ household relocation
→ changed travel demand
→ fiscal and service consequences
```

or:

```text
factory expansion
→ labor demand
→ wage pressure
→ migration
→ housing demand
→ development
→ freight growth
→ congestion
→ logistics cost
→ future firm profitability
```

Those chains must be measurable, deterministic, inspectable and testable.