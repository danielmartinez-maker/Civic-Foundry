# Civic Foundry — Economy, Housing & Firms

## Status summary

Civic Foundry already contains substantial playable economic, employment, housing, development and freight behavior. Much of that stack is **Transitional** because later 2.0 phases will deepen and replace authority behind compatibility gates.

Urban Fabric’s parcel/building/property mechanics are **Implemented current authority within their accepted scope**.

Future Economy 2.0, Real Estate Capitalism 2.0 and Households & People are **Target**.

## Economic design goal

The economy should explain why urban land is used, why firms succeed or fail, why households can or cannot afford the city, and how transportation/infrastructure affect production and location.

Money, labor, inventory, occupancy and cargo should not behave as unrelated meters.

## Current firm/economy baseline — Transitional

The existing gameplay layer includes establishment-based firms and meaningful operating state such as:

- firm formation;
- employment/job capacity;
- labor allocation;
- production;
- inventories;
- imports and exports;
- freight orders;
- explicit freight trucks;
- distress/recovery;
- closure.

This gives the current game a real economic loop even before the later input-output replacement.

## Current employment baseline — Transitional

Employment connects population to firms and contributes to:

- household income/economic health;
- firm staffing;
- development demand;
- commute/travel demand;
- municipal tax base.

Later labor-market replacement should add skill/occupation/location matching without discarding the principle that jobs require actual worker supply.

## Current housing baseline — Transitional

The existing housing layer includes:

- residential capacity/occupancy concepts;
- affordability;
- renter/owner tenure economics;
- persistent relocation;
- redevelopment/displacement safeguards.

These mechanics remain important compatibility behavior while explicit households/units and deeper real-estate markets are introduced later.

## Urban Fabric development/property — Implemented foundation

Urban Fabric adds physical economic context around land:

- legal parcels;
- dimensional zoning;
- buildable envelopes;
- canonical buildings;
- highest-and-best-use analysis;
- property holdings/transactions;
- site assembly;
- lifecycle/condition;
- redevelopment execution.

This establishes a parcel-based physical development substrate. Later finance and market phases should extend it rather than introduce a second property geometry system.

## Development economics

A development opportunity should ultimately depend on a chain such as:

```text
parcel geometry
+ legal entitlement
+ terrain/site costs
+ accessibility
+ achievable rent/sale value
+ construction cost
+ financing/approval constraints
→ project feasibility
```

The current Urban Fabric model already addresses several of these factors. Later phases deepen capital, finance, contractor and market constraints.

## Phase 6R — Economy 2.0 — Target

The target replacement moves from a compact inherited economy to a configurable urban/regional input-output model.

### Sector system

The initial target sector set spans broad categories such as:

- food/extractive supply;
- construction materials;
- metals;
- machinery;
- automotive/manufacturing;
- logistics/warehousing;
- wholesale/retail;
- hospitality;
- finance;
- professional services;
- technology/software;
- healthcare;
- education;
- culture/entertainment.

Definitions should be data driven where practical.

### Input-output production

Firms consume actual inputs to create outputs/services.

Example conceptual recipes:

```text
automotive assembly
= metals + components + skilled labor + energy + logistics

restaurant output
= food + labor + utilities + commercial space

construction
= materials + machinery + labor + finance
```

A firm cannot consume inputs it does not possess.

### Firm accounts

Target firm economics include explicit operating statements:

- revenue;
- cost of goods;
- payroll;
- rent;
- utilities;
- logistics;
- taxes;
- interest;
- capital expenditure;
- cash/debt;
- profit/loss.

Material cash transfers should post through a conservation-safe economic ledger when that layer becomes authoritative.

### Labor markets

Target labor matching distinguishes skill/occupation/location rather than one homogeneous worker pool.

Vacancies influence wage pressure; accessibility influences matching. Employment allocated cannot exceed worker supply or job demand.

### Entrepreneurship and business dynamics

Firms can form, expand, contract, relocate, automate, become distressed or close based on opportunity, capital, demand, costs and workforce availability.

### Supply chains and freight

Supplier choice should reflect delivered cost:

```text
production price
+ transport cost/time
+ congestion
+ reliability
+ inventory risk
```

This creates a direct bridge from the transportation engine to firm profitability and industrial geography.

## Phase 7R — Real Estate Capitalism 2.0 — Target

This phase deepens property from parcel economics into explicit markets and finance.

### Ownership

Properties may be owned by households, landlords, firms, developers, institutional investors or government.

Ownership transfers become authoritative events with reconciled buyer/seller/ledger state.

### Residential units and listings

Target buildings contain explicit or weighted units by type/quality/tenure.

Units can be occupied, rented, for sale/rent, vacant or unavailable during renovation.

### Rental and sale markets

Landlords post rents; households search/rank units; leases and transactions create real market evidence.

Thin markets may use bounded appraisal fallback, but indexes should derive from actual transactions when possible.

### Mortgages and household finance

Target home purchases consider:

- down payment;
- income;
- interest rate;
- loan term;
- LTV;
- debt-service/qualification limits.

Owner cost includes financing, taxes, insurance and maintenance.

### Developer finance

Projects can model:

- land acquisition;
- demolition;
- hard/soft costs;
- fees;
- financing and interest carry;
- schedule;
- lease-up/sales;
- NOI/cap rate;
- debt/equity;
- returns and lender constraints.

### Developers, lenders and contractors

The target economy includes scarce development capital, lending capacity and construction capacity. A construction boom can therefore increase costs and delay projects.

## Phase 8 — Households & People — Target

The long-term demographic authority moves beyond aggregate population toward explicit/weighted people and households.

Target person/cohort attributes include:

- age;
- education;
- occupation;
- employment;
- income;
- health;
- household membership.

Target household state includes:

- income;
- savings/debt;
- vehicles;
- tenure;
- children/dependents;
- preferences;
- relocation constraints.

Life-cycle processes can include schooling, graduation, household formation, employment/unemployment, migration, retirement and death.

Weighted cohorts are acceptable when they conserve population weight and preserve relevant heterogeneity.

## Housing-market causal loop

A mature housing loop should resemble:

```text
jobs/income/accessibility
→ household demand
→ vacancy/rent/price pressure
→ project feasibility
→ land acquisition + construction
→ new units
→ market clearing
→ relocation
→ changed travel/service demand
```

Zoning and finance can constrain the supply response.

## Displacement and redevelopment

Civic Foundry already values conservation-safe redevelopment safeguards. Later real-estate mechanics must not allow a physical building/property transaction to silently delete occupants.

Redevelopment may create displacement costs and require viable relocation capacity. Lower-income protection and developer commitment safeguards should remain explicit design concerns.

## Economy–city feedback loops

### Industrial growth

```text
firm expansion
→ jobs
→ wage/migration pressure
→ housing demand
→ construction
→ freight
→ congestion
→ delivered cost
→ future firm profitability
```

### Accessibility investment

```text
better transport
→ larger effective labor/customer market
→ stronger firm/land demand
→ development
→ more trips and fiscal activity
```

### Housing constraint

```text
job growth
+ restrictive capacity / expensive construction
→ low vacancy
→ higher rents
→ displacement/longer commutes
→ labor-market and political consequences
```

## Player-facing economic questions

The mature game should help answer:

- Why are firms opening or failing?
- Is a labor shortage caused by skill mismatch, housing cost or accessibility?
- Why is a parcel not developing despite zoning capacity?
- Are rents high because of demand, construction cost, financing or supply constraints?
- How much does congestion raise freight cost?
- Is redevelopment profitable only because displacement costs are missing?
- Is municipal growth producing a durable tax base or fragile debt/maintenance exposure?

The economy’s role is to turn city form and policy into incentives, constraints and trade-offs that propagate through the rest of the simulation.