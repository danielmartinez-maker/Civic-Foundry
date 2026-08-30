# Civic Foundry — Player Experience

## Player role

The player acts as the city’s principal builder, planner and municipal decision-maker. They directly shape public space, infrastructure, zoning and policy while households, firms, developers and institutions respond to the resulting conditions.

The intended relationship to the city is hands-on and observational. The player should enjoy both making interventions and watching the system react.

## Core loop

A normal Civic Foundry session should repeatedly move through this loop:

1. **Observe** — inspect land, networks, neighborhoods, budgets and trends.
2. **Diagnose** — determine the actual constraints or causes behind a problem/opportunity.
3. **Plan** — choose infrastructure, regulation, investment or policy.
4. **Commit** — spend money, change rules or authorize construction.
5. **Operate** — let simulation systems respond over appropriate time horizons.
6. **Inspect consequences** — examine intended and unintended effects.
7. **Adapt** — revise the city based on new conditions.

The game should avoid making the player continuously spam corrective actions. Important decisions should have persistence and consequences.

## Primary decision categories

### Shape the physical city

- roads and transportation infrastructure;
- public facilities;
- utility/infrastructure corridors;
- zoning and development rules;
- major redevelopment and capital projects;
- resilience investments.

### Operate the municipality

- budgets and service funding;
- taxes, fees and later debt/capital finance;
- service levels and institutional capacity;
- transportation operations;
- maintenance priorities;
- later policy and political choices.

### Guide private development

The player influences development through access, services, land rules, taxes, incentives and public investment. Private projects should depend on feasibility and market conditions rather than appearing solely because a zone was painted.

## Time horizons

Civic Foundry decisions operate at several timescales:

- **seconds/minutes:** vehicle movement, queues, incidents and immediate operational feedback;
- **days/weeks:** service operations, firm activity, household adjustments, transit reliability;
- **months/years:** construction, rents, development, budgets, demographics and infrastructure deterioration;
- **decades:** urban form, agglomeration, neighborhood trajectories, debt, replacement cycles and regional change.

The player should be able to pause and accelerate time. Simulation cadence remains deterministic and independent of display frame rate.

## Difficulty model

Difficulty should come primarily from tighter resources, weaker starting conditions, physical constraints, external economic conditions and more demanding objectives. It should not rely on hidden cheating by the simulation.

Scenario design can vary:

- geography and climate exposure;
- inherited street/parcel form;
- fiscal health;
- population/economic structure;
- infrastructure age;
- regional connectivity;
- policy constraints;
- challenge objectives.

## Information hierarchy

### City overview

High-level indicators show population, employment, housing, fiscal health, mobility, service performance and major warnings.

### Spatial diagnosis

Overlays show where conditions occur: parcels, zoning, accessibility, congestion, service access, flood exposure, land values, utilities and later environment/social outcomes.

### Entity inspection

The player should be able to inspect meaningful entities such as parcels, buildings, firms, facilities, routes, projects and eventually households/cohorts.

### Causal explanation

Important changes should expose contribution-style explanations: what raised or lowered demand, feasibility, service performance, congestion, fiscal balance or similar outcomes.

### History

Charts and timelines help distinguish a temporary spike from a structural trend.

## Camera and city feel

**Implemented:** production presentation uses a GPU-rendered isometric world with panning, anchored zoom, rotation, picking, overlays and tool previews through the existing camera contract.

**Target aesthetic:** the city should feel like a highly detailed physical model or miniature metropolis. Tilt-shift-inspired depth treatment, carefully controlled scale cues, readable material variation and charming movement can support this identity without compromising simulation legibility.

The player should be able to move fluidly from metropolitan overview to parcel/building inspection.

## Building tools

Construction tools should communicate:

- what will be built or changed;
- cost and physical feasibility;
- affected parcels/network elements;
- important side effects;
- invalid-placement reasons;
- whether the action is immediate or begins a project process.

Preview state belongs to presentation. Final state changes occur through authoritative simulation commands/services.

## Feedback philosophy

Feedback should be specific enough to guide action. Prefer:

- “Hospital wait time is high because staffed bed capacity is 84% below peak demand”

over:
- “Healthcare bad.”

Prefer:

- “This parcel’s redevelopment is infeasible at current rent, construction cost and allowed FAR”

over:
- “No demand.”

The exact depth depends on system maturity, but the direction is consistent.

## Progression

The sandbox should not depend on an arbitrary unlock ladder for its core identity. Scenarios may stage complexity, and advanced infrastructure can require city scale, finances or prerequisites. Progression should generally reflect institutional and economic capability rather than gamey experience points.

## Player agency boundaries

The player may strongly influence outcomes but should not control every actor. Mature systems should allow:

- residents to relocate or remain based on constraints;
- firms to hire, expand, relocate or fail;
- developers to pursue feasible projects;
- lenders and contractors to constrain development;
- political actors and public opinion to constrain later policy.

This makes planning meaningful because conditions must be created rather than outcomes simply selected.

## Success experience

A successful city should feel earned because multiple systems reinforce one another: useful infrastructure, productive land use, accessible jobs, adequate housing, reliable services, fiscal capacity and resilient long-term investment.

A struggling city should remain diagnosable. The player should usually be able to identify the mechanisms driving decline and choose among imperfect responses.