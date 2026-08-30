# Civic Foundry — Design Pillars

These pillars are decision filters. A feature that conflicts with them needs an explicit architectural or product decision rather than an accidental exception.

## 1. Cities are interconnected systems

No major domain should behave like an isolated minigame. Land use affects mobility. Mobility affects labor access and property value. Services require money and access. Firms require workers, inputs and customers. Infrastructure changes development feasibility.

Feature designs should identify both inputs and downstream effects.

## 2. Important outcomes have causes

The game should expose the main contributors to meaningful metrics and state transitions. “Demand 82” is insufficient if the player cannot learn what produced 82.

Causal explanation does not require exposing every internal coefficient. It requires preserving a trace from actual model inputs to meaningful outcomes.

## 3. The physical city matters

Terrain, parcel geometry, frontage, road topology, building footprint and infrastructure connectivity are gameplay constraints. Distance and connectivity should not disappear into global bonuses when a network model is materially relevant.

## 4. One authoritative owner per fact

Each domain has one source of truth. Other systems may maintain caches, projections and compatibility facades, but derived views cannot become competing owners.

This is both an engineering rule and a simulation-design rule: conflicting reality destroys causality.

## 5. Private actors respond rather than obey

Households, firms, developers and lenders should make bounded decisions based on incentives, constraints and available information. The player establishes conditions and policy; private behavior emerges from those conditions.

The player can directly build public infrastructure and may support public development, but private-market outcomes should retain agency.

## 6. Public systems operate under capacity

A building icon alone should not guarantee output. Mature versions of schools, hospitals, emergency services, transit, utilities and waste systems require staff, equipment, network access, budget and throughput.

## 7. Conservation creates trust

Population, occupancy, money, inventory, cargo, passenger weight and other conserved quantities must reconcile. The game should not create invisible residents, duplicate money, teleport freight or assign the same scarce asset twice.

## 8. Determinism is part of game quality

Given the same authoritative state, seed and ordered commands, the simulation must produce the same authoritative future. Randomness is namespaced so adding a traffic draw does not perturb unrelated demographic outcomes.

Determinism supports debugging, balancing, replay, migration testing and player trust.

## 9. Use fidelity where it changes decisions

Civic Foundry should not simulate every human at maximum detail simply because it can. Explicit agents are justified when routing, capacity, sequence or individual state matters. Weighted cohorts and aggregates are preferable when they preserve meaningful heterogeneity more efficiently.

## 10. History matters

Cities accumulate path dependence. Parcel lineage, building age, infrastructure condition, fiscal commitments and previous development patterns should shape future possibilities.

Migration code must never fabricate historical events merely to populate a new feature.

## 11. Trade-offs beat universal bonuses

Policies and infrastructure choices should have costs, opportunity costs and distributional effects. More road capacity can reduce one bottleneck while inducing travel or consuming valuable land. Restrictive zoning can preserve form while constraining supply. Higher service quality requires resources.

Avoid mechanics where the optimal answer is always “build the highest tier everywhere.”

## 12. The player needs legibility

Complexity without inspection becomes noise. Every major system should eventually provide useful overlays, inspectors, trends and diagnostics at the level where the player can act.

## 13. Presentation serves simulation

Visuals should make the city desirable to watch and pleasant to manipulate while remaining faithful to simulation state. The renderer may interpolate and stylize, but it cannot manufacture authoritative outcomes.

## 14. Performance is a design constraint

Long-run city simulation needs predictable scale. New systems require bounded cadence, spatial indexing, cache invalidation rules, cohorting or other scale strategies. Skipping causality entirely is not the preferred optimization.

## 15. Replacement must earn authority

Civic Foundry 2.0 evolves through progressive replacement. Existing behavior remains behind compatibility seams until a replacement passes determinism, persistence, parity, quality and performance gates.

## Anti-goals

Civic Foundry should avoid:

- disconnected meters that rise because a building was placed nearby;
- citywide effects that ignore network connectivity when connectivity is central to the mechanic;
- decorative agents with no relationship to authoritative simulation;
- hidden money or population creation to make systems “work”;
- UI code that owns simulation history or outcomes;
- giant all-purpose coordinator classes;
- new subsystems that quietly duplicate existing authority;
- save migrations that invent a past that never happened;
- unrestricted randomness that makes debugging irreproducible;
- implementation work justified only by repository size;
- roadmap language presented as shipped capability.

## Design review questions

Before accepting a substantial feature, ask:

- What authoritative domain owns the new state?
- What causes this behavior?
- What other systems consume its outputs?
- What is conserved?
- What network or spatial constraints apply?
- What cadence is required?
- How does the player inspect it?
- How is it saved or rebuilt?
- How is it tested deterministically?
- How does it scale to a mature city?
- Is the feature Implemented, Transitional or Target?