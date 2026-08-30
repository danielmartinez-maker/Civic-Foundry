# Civic Foundry — Systems Overview

## Purpose

Civic Foundry should be understood as one coupled urban system. This document maps the major domains and the feedback loops between them without replacing lower-level engineering documentation.

## Primary causal chain

```text
WORLD / GEOGRAPHY
    ↓
INFRASTRUCTURE + NETWORKS
    ↓
ACCESSIBILITY
    ↓
LAND VALUE + DEVELOPMENT FEASIBILITY
    ↓
BUILDINGS + HOUSING + BUSINESS SPACE
    ↓
HOUSEHOLDS + FIRMS + EMPLOYMENT
    ↓
PRODUCTION + CONSUMPTION + FREIGHT
    ↓
TRAVEL + CONGESTION + TRANSIT
    ↓
SERVICE DEMAND + ENVIRONMENTAL PRESSURE
    ↓
MUNICIPAL REVENUE + COST + POLITICS
    ↓
POLICY + CAPITAL INVESTMENT
    ↺ back into infrastructure and land
```

No single arrow implies a one-way effect. Most are feedback loops.

## 1. World and geography

**Current authority:** `WorldFoundation`.

Provides the physical substrate:

- terrain and engineering conditions;
- groundwater and hydrology;
- drainage/flood behavior;
- administrative geography;
- spatial queries and world-relative costs.

World conditions affect construction feasibility, infrastructure cost, risk and later environmental outcomes.

## 2. Legal land and urban fabric

**Current authority:** `CadastralGraph` plus accepted Urban Fabric systems.

Represents:

- parcels and topology;
- frontage/access/easements;
- dimensional zoning;
- buildable envelope;
- canonical buildings;
- building lifecycle/condition;
- property holdings and redevelopment decisions.

Land regulation and accessibility affect feasible floor area and project economics. Development changes capacity for households, jobs and services.

## 3. Transportation and accessibility

**Current:** inherited deterministic road, traffic and transit systems.

**Next replacement:** 3R Transportation Engine 2.0.

Transportation converts urban form into generalized travel costs. It connects households to jobs, firms to suppliers/customers, service units to incidents and development to market accessibility.

Important outputs include:

- travel time;
- congestion;
- accessibility;
- route reliability;
- parking and incident effects in later authority.

## 4. Mobility and transit

Current transit already models multiple public-transport modes, passenger queues and operations.

Later replacement deepens mode choice, schedules, fleet/depot constraints, delay propagation and heterogeneous traveler preferences.

Mobility is downstream of activity locations and upstream of land value, labor matching and service access.

## 5. Economy and firms

Current firm/economy systems provide establishments, jobs, production, inventories, trade/freight orders and business dynamics.

Later Economy 2.0 connects sectors through input-output production, firm accounts and supplier choice.

Firms depend on:

- available labor;
- commercial/industrial space;
- accessibility;
- utilities;
- intermediate inputs;
- customer demand;
- taxes and operating costs.

Their location and scale generate jobs, tax base, freight and travel demand.

## 6. Housing, population and households

Current housing/population systems include affordability, tenure and relocation mechanics.

Future household/person authority adds demographic heterogeneity, income/education/occupation, savings/debt and life cycles.

Housing interacts strongly with:

- job accessibility;
- rents/prices;
- construction supply;
- neighborhood/service quality;
- transportation cost;
- household income and financing.

## 7. Development and real estate

Urban Fabric already provides physical development feasibility and property state.

Later Real Estate Capitalism 2.0 adds deeper ownership, listings, transactions, mortgages, lender/developer/contractor constraints and project finance.

Development is a major bridge between policy and physical change.

## 8. Public services

Current systems include police, fire, healthcare, education and waste with routed/operational behavior.

Civic Institutions 2.0 targets explicit staffing, equipment, queues, budgets, catchments and condition.

Service quality feeds:

- health/safety/attainment;
- neighborhood desirability;
- household/firms location choice;
- municipal cost;
- later political approval.

## 9. Utilities and infrastructure

Current utilities support playable city operation.

Future infrastructure authority models explicit electricity, water, wastewater, drainage and telecom networks with capacity, condition, maintenance and failures.

Infrastructure should never provide disconnected capacity through a global score when network connectivity is materially relevant.

## 10. Environment and risk

World Foundation already supplies physical terrain/hydrology/flood mechanics.

Future environmental systems add pollution, noise, heat, emissions, weather/climate pressures and resilience.

Environmental conditions feed health, land value, migration, infrastructure cost and politics.

## 11. Government and finance

Current taxes/treasury provide municipal economic constraints.

Future government-finance authority adds fund accounting, grants, bonds, debt service, credit quality, pensions/liabilities, maintenance backlogs and capital planning.

Finance closes the loop: infrastructure and services require resources; economic development creates tax base; debt and maintenance make decisions persist across decades.

## 12. Politics and public opinion

**Target.** Residents form preferences from actual conditions. Elections, council districts, neighborhood organizations and project coalitions make policy politically constrained without replacing underlying physical/economic mechanics.

## 13. Analytics and explainability

The long-term observatory should aggregate historical/spatial data and causal contributions from the real simulation.

Analytics are read models. They should not become independent sources of gameplay truth.

## Fidelity tiers

Civic Foundry uses different levels of representation depending on whether individual sequence matters.

### Tier A — explicit agents

Appropriate for active vehicles, transit/service vehicles, incidents, buildings/parcels, projects and other entities where routing/state sequence matters.

### Tier B — weighted agents/cohorts

Appropriate for households, workers, students, travelers and demographic groups where heterogeneity matters more than every individual identity.

### Tier C — aggregates

Appropriate for external/regional pools and macro conditions outside the detailed simulation boundary.

## Cadence

Subsystems should run at the slowest cadence that preserves meaningful dynamics. Fine-grained traffic updates do not require property markets to clear every traffic tick.

Each authoritative system should declare or have an explicit cadence. Browser render frames are not simulation ticks.

## Example cross-domain loops

### Transit investment

```text
new transit service
→ lower generalized travel cost
→ higher accessibility
→ location/land-value response
→ development feasibility
→ households/jobs relocate
→ ridership changes
→ operating/fiscal consequences
```

### Housing shortage

```text
strong job growth
→ household demand
→ low vacancy
→ higher rents
→ developer feasibility rises
→ construction if zoning/capital allow
→ new supply
→ affordability response
```

### Flood-prone growth

```text
cheap flood-exposed land
→ development pressure
→ more exposed assets
→ storm losses/service demand
→ infrastructure/resilience spending
→ fiscal and land-value response
```

These relationships are the intended unit of Civic Foundry design: systems that produce consequences through connected state rather than isolated bonuses.