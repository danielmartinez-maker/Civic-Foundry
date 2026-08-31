# Vision & Player Experience

[← Wiki Home](Home.md)

## Product definition

Civic Foundry is a city-management and urban-systems simulation spanning land use, transportation, infrastructure, municipal finance, real estate, firms, freight, public services, housing, demographics, environment, and long-run metropolitan development.

The intended product is a serious simulation platform with strong game structure rather than a decorative sandbox.

## Player fantasy

The player acts as the city's principal civic decision-maker: builder, planner, infrastructure investor, regulator, and municipal operator. The player can shape streets, zoning, public facilities, utilities, taxes, budgets, transit, capital projects, resilience investments, and later planning law and political choices.

Private actors respond to incentives and constraints. Zoning creates development potential; it does not directly spawn a tower. A hospital must eventually depend on staffing, equipment, access, budget, and operating capacity. Firms should expand when labor, demand, logistics, space, finance, and profitability support expansion.

## Core player loop

1. **Observe** land, networks, neighborhoods, budgets, and trends.
2. **Diagnose** the underlying constraint or causal chain.
3. **Plan** infrastructure, regulation, investment, or policy.
4. **Commit** an authoritative action.
5. **Operate** the city at the appropriate simulation cadence.
6. **Inspect consequences**, including unintended effects.
7. **Adapt** the plan.

The design should avoid constant action spam. Decisions should persist long enough to produce consequences.

## Design pillars

- Cities are interconnected systems.
- Important outcomes must have explainable causes.
- Terrain, geometry, connectivity, and physical networks matter.
- Every important fact has one authoritative owner.
- Private actors respond rather than obey.
- Public systems operate under capacity constraints.
- Population, money, occupancy, inventory, freight, passengers, vehicles, and ownership should reconcile.
- Determinism is part of simulation quality.
- Fidelity belongs where it changes decisions.
- History and path dependence matter.
- Policies should create trade-offs instead of universal bonuses.
- Complexity must remain legible through overlays, inspectors, trends, and explanations.
- Presentation may stylize state but cannot manufacture simulation facts.
- Replacement systems must earn authority through parity, determinism, persistence, performance, and player-facing acceptance.

## Time horizons

Civic Foundry intentionally mixes timescales. Vehicles, queues, and incidents operate over seconds/minutes; service and firm operations over days/weeks; development, rents, budgets, and demographics over months/years; urban form and infrastructure replacement over decades.

Pausing or accelerating the simulation must not change authoritative results.

## Success and failure

There is no universal perfect-city score. Scenarios may define goals around affordability, fiscal stability, growth, resilience, transport reliability, emissions, service quality, or redevelopment. Negative outcomes should normally be understandable consequences of the actual model state.