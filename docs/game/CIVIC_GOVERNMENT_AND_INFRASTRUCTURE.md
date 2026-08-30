# Civic Foundry — Civic Systems, Government & Infrastructure

## Status summary

Civic Foundry currently has playable public services, utilities, taxation and treasury systems. These are **Transitional** relative to the deeper institutional/network/government phases in the Civic Foundry 2.0 roadmap.

World Foundation hydrology/flooding is **Implemented** physical authority. Later environmental and infrastructure-network phases extend it.

## Municipal design goal

The city government should operate under real capacity, geography and finance. Public outcomes should come from institutions, networks, people/equipment and budgets rather than abstract coverage bonuses alone.

The mature system should make the player manage both current service delivery and long-term institutional/fiscal capacity.

## Current public-service baseline — Transitional

Existing gameplay includes:

- fire services;
- police;
- healthcare;
- education;
- waste collection;
- routed service/emergency vehicles;
- incidents;
- budgets;
- neighborhood-quality effects.

These systems already connect service delivery to actual city state and routing more deeply than a pure radius model.

## Phase 4R — Civic Institutions 2.0 — Target

The target replacement models each facility as an operating institution.

### Facility operating state

Target facilities can own:

- physical capacity;
- required/current staffing;
- equipment and fleet;
- operating budget;
- service queue;
- service quality;
- catchment/accessibility;
- maintenance/condition.

A facility building does not automatically equal full service output.

### Healthcare

Target hospitals/clinics include beds, staff, treatment capacity, ambulance intake and waiting/queue effects.

Relevant outputs can feed health, emergency outcomes, household desirability and fiscal cost.

### Education

Target schools include classrooms, teachers, enrollment/capacity, class size, quality and attainment contribution.

School access and quality can feed household location, long-run human capital and neighborhood outcomes.

### Police, fire and EMS

Target dispatch chain:

```text
incident
→ dispatch decision
→ resource assignment
→ route
→ on-scene service
→ transport/clearance
→ resource recovery
```

One unit cannot be double-booked across incompatible incidents.

### Waste

Target waste becomes linked logistics:

```text
generation
→ collection
→ transfer/recycling
→ treatment/landfill
```

Vehicle routes and facility capacity limit realized service.

## Current utilities baseline — Transitional

The current game contains utilities needed for playable city operation.

Future infrastructure authority must preserve current player-facing continuity while replacing simplified capacity assumptions with explicit networks.

## Phase 9 — Metropolitan Infrastructure Networks — Target

Target utility systems are typed networks rather than one generic graph with identical semantics.

### Electricity

```text
generation
→ transmission
→ substation
→ distribution
→ load
```

### Water

```text
source
→ treatment
→ storage
→ pumping
→ distribution
```

### Wastewater

```text
collection
→ pumping
→ treatment
→ discharge/reuse
```

### Drainage

```text
catchment
→ inlet
→ pipe/channel
→ detention/outfall
```

Drainage should integrate with World Foundation hydrology rather than duplicate flood authority.

### Telecommunications

```text
backbone
→ node/exchange
→ local service
```

### Network properties

Infrastructure can own:

- connectivity;
- capacity;
- load;
- condition;
- maintenance;
- failure state;
- upgrade state.

Disconnected assets must not provide phantom capacity.

## Phase 10 — Environment & Climate — Target

The environmental layer expands beyond current physical hydrology into:

- air pollution;
- water quality;
- noise;
- urban heat;
- energy use/emissions;
- rainfall/drought forcing;
- wildfire exposure where relevant;
- tree cover/green infrastructure;
- resilience investment.

Environmental conditions feed:

- health;
- land/property value;
- household/firms location;
- operating cost;
- infrastructure performance;
- political opinion.

## Current municipal finance — Transitional

Existing gameplay includes treasury, taxation and recurring municipal finance.

This is enough to create present-day budget constraints, but it is not the final government-finance authority envisioned by the roadmap.

## Phase 11 — Municipal Government & Finance — Target

Target finance includes:

- fund accounting;
- operating budgets;
- capital budgets;
- property/other assessments;
- taxes and fees;
- grants/transfers;
- bonds;
- debt service;
- credit quality;
- pensions/long-term liabilities;
- maintenance backlogs;
- capital improvement planning.

The important design consequence is temporal: a city can appear cash-positive today while creating future liabilities.

### Fiscal causal loop

```text
development/economic activity
→ tax base
→ operating/capital capacity
→ infrastructure/services
→ accessibility/quality
→ future development/economic activity
```

Debt, maintenance and operating obligations make this loop path-dependent.

## Phase 12 — Politics & Public Opinion — Target

Politics should constrain policy based on actual simulated conditions rather than replace the underlying mechanics.

Target elements include:

- mayoral elections;
- council districts;
- approval;
- neighborhood organizations;
- support/opposition to projects;
- ballot questions;
- policy coalitions;
- political feasibility.

Resident preferences should respond to actual housing, taxes, services, environment, transport and neighborhood change.

## Phase 13 — Planning Law — Target

Planning law extends Urban Fabric zoning into an editable code/policy system.

Target instruments include:

- zoning maps;
- FAR/height/setback rules;
- mixed use;
- parking requirements;
- historic overlays;
- environmental review;
- impact fees;
- inclusionary requirements;
- density bonuses;
- transferable development rights.

The player can reform the development code itself, with economic and political consequences.

## Phase 14 — Construction & Megaprojects — Target

Major infrastructure should not appear instantly at completion.

Target project chain:

```text
concept/design
→ engineering
→ land acquisition
→ procurement
→ contractor mobilization
→ staged construction
→ commissioning
```

Projects can carry:

- budget;
- schedule;
- work zones;
- contractor capacity;
- material/labor demand;
- delay/cost-overrun risk;
- fiscal exposure.

A megaproject therefore temporarily affects traffic, firms, labor and finance before producing long-term benefits.

## Regional government context — Target

Later regional simulation adds neighboring municipalities and cross-boundary flows. This can introduce:

- commuting outside the city;
- regional infrastructure dependencies;
- freight gateways;
- competition/cooperation between jurisdictions;
- regional housing/labor markets.

Civic Foundry should ultimately distinguish municipal authority from regional conditions rather than treating the city as economically isolated.

## Public-service causality requirements

Mature civic systems should obey these rules:

- service output cannot exceed physical/staff/equipment capacity;
- routes/connectivity matter when service must physically travel;
- queues matter when demand arrives faster than processing capacity;
- one scarce unit cannot be assigned twice;
- budgets constrain operating state;
- maintenance and condition affect future capability;
- facilities cannot create unlimited quality merely by proximity.

## Player-facing civic questions

The game should help the player answer:

- Is service failure caused by too few facilities, too little staff, bad routing or an operating-budget problem?
- Which infrastructure segment is the real bottleneck?
- Is short-term budget balance hiding a maintenance/debt problem?
- Does a capital project create enough accessibility/resilience/revenue to justify cost?
- Which neighborhoods bear the costs or benefits of a policy?
- Is a politically difficult decision economically necessary, or is there an alternative intervention?

Public systems are where the physical city, budget and institutional capability converge. Their design should make municipal management consequential across decades rather than a sequence of coverage-radius purchases.