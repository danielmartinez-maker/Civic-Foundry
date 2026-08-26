# Simulation — Current 0.9.0 Urban Fabric Runtime

## Deterministic execution

`SimulationCore` remains the gameplay facade and advances through the deterministic `SimulationKernel`. The kernel owns the shared clock, command ordering, system scheduling, invariant execution, diagnostic events, and named RNG streams.

Inherited city systems continue to use their established cadences. At a high level:

- every tick: topology refresh when required, service/transit/freight/traffic vehicle progression, intersection service, traffic analytics, and active construction progression;
- short cadence: public-service demand, incidents, garbage jobs, accessibility, education/neighborhood quality, and development evaluation;
- 50-tick cadence: utilities, employment, taxes, R/C/I demand, municipal obligations, migration, housing/economic reconciliation;
- 100-tick cadence: person-trip generation, mobility choice, freight ordering/dispatch windows, and related deterministic demand work;
- longer lifecycle cadences: establishment formation/distress/closure, developer capital recycling, building lifecycle and redevelopment evaluation.

The exact subsystem cadence is owned by the corresponding scheduler/system. New Urban Fabric logic does not introduce a second independent clock.

## Physical world and land authority

The simulation now distinguishes three coordinate/authority layers:

1. `WorldFoundation` — authoritative terrain, hydrology, geography, and physical world composition;
2. `CadastralGraph` — authoritative legal parcel topology in world-meter coordinates;
3. legacy grid/lot adapters — compatibility addressing for inherited cell-based gameplay.

A parcel is not required to map one-to-one to a legacy lot. Compatible frontage cells may merge into one cadastral parcel while the legacy facade continues exposing stable `lot:x,y` identifiers.

Legacy road/zoning edits that affect land call `SimulationCore.rebuildCadastreFromLegacyState()`. That rebuild creates the canonical parcel state first and then refreshes the legacy lot projection from the cadastre.

## Urban Fabric development loop

Parcel-authoritative development uses the following causal path:

```text
parcel geometry + frontage/access
  + parcel zoning
  + physical-world site conditions
    → buildable envelope
    → massing candidates
    → zoning compliance
    → parcel economics / HBU / redevelopment diagnostics
    → developer bids and award
    → canonical BuildingV2
```

### Buildable envelope

`BuildableEnvelopeSystem` applies dimensional controls such as setbacks, coverage, FAR, height, and minimum parcel dimensions to the actual parcel polygon. Setbacks can create disconnected buildable pieces; the deterministic legal result retains the valid dominant geometry and reports constraints rather than inventing floor area.

### Zoning compliance

`ZoningComplianceSystem` validates physical massing independently across footprint, height, FAR, coverage, setbacks, and use allocation. Illegal candidates do not proceed to developer bidding.

### Building massing

`BuildingMassingSystem` produces deterministic physical candidates from the legal envelope. Candidate identity remains distinct through underwriting and developer awards, so materially different massings on the same parcel do not collapse into one opportunity.

Mixed-use candidates allocate usable floor area by permitted use. Residential capacity, jobs, utilities, tax base, project cost, and other downstream values derive from physical floor area rather than a hidden cell-density multiplier.

### Developer market

Developer bidding remains capital- and hurdle-constrained. Urban Fabric opportunities use canonical parcel identity even when several legacy frontage lots project over that parcel. Active commitments prevent duplicate simultaneous awards for the same physical opportunity.

Successful runtime development materializes canonical `BuildingV2` state while inherited building records remain available where legacy systems still require them.

## BuildingV2 and lifecycle

Canonical buildings persist:

- stable building ID;
- parcel IDs;
- footprint;
- typology;
- gross/usable floor area;
- stories, height, realized FAR, coverage;
- floor/use allocations;
- entitlement;
- lifecycle state;
- optional project/developer/owner metadata.

Physical lifecycle state models condition, effective age, maintenance needs/backlog, vacancy/distress influence, renovation, and redevelopment. It is not duplicated as an independent second condition authority on the same building.

Adequate maintenance slows deterioration. Persistent vacancy increases distress. Major renovation/adaptive reuse must clear economic and zoning constraints, and relocation-dependent work cannot bypass displacement safeguards.

## Redevelopment and relocation safeguards

Physical redevelopment pressure is an explainable derived signal. Drivers can include:

- unused legal FAR;
- building deterioration/effective age;
- demand and market value;
- profitable replacement massing;
- upzoning or higher legal intensity.

Friction can include:

- demolition cost;
- acquisition cost;
- relocation burden;
- preservation constraints;
- insufficient developer return;
- unresolved displacement.

A project cannot enter demolition while canonical household displacement requirements remain unresolved. Existing housing relocation conservation rules continue to govern occupied residential redevelopment.

## Cadastral mutations

Legal land operations are executed through `CadastralMutationSystem` against candidate snapshots:

- split;
- assembly;
- easement creation/removal;
- right-of-way dedication.

The live graph changes only after the complete candidate validates. Failed operations are atomic.

Area accounting is explicit. Split and assembly conserve private land area; right-of-way dedication transfers area out of private parcels and the combined controlled private + dedicated ROW area must remain conserved within geometry tolerance.

Lineage records retired and resulting parcel IDs so legal history is deterministic and auditable.

## Property market and site assembly

`PropertyMarketSystem` owns canonical parcel holdings and transactions. Multi-parcel transfers validate seller ownership before committing, preventing partial ownership changes.

`SiteAssemblySystem` evaluates bounded adjacent parcel sets. Assembly is economically interesting only when geometric/development uplift exceeds acquisition friction; candidate enumeration is deterministic and currently bounded to four parcels.

## Transportation, services, transit, and freight

Urban Fabric does not replace the existing mobility or service authorities.

Road congestion remains based on weighted traffic over real network capacity. Emergency/service, transit, commuter, and freight vehicles contribute to the shared network according to their established rules.

Public-service accessibility still derives from reachable network facilities and capacity. Transit choice still uses deterministic generalized cost and finite capacity/queues. Firms and freight remain explicit establishment/cargo systems with conserved inventory and routed vehicles.

Parcel frontage/access may consume transportation information, but cadastral geometry does not manufacture traffic, accessibility, service, or freight outcomes.

## World Foundation interaction

Generated terrain preparation multipliers continue to affect real construction economics. `WorldFoundation` remains static under ordinary city ticks; explicit operations such as `runDesignStorm()` mutate only the appropriate world/flood authority.

Urban Fabric coordinates are measured in the same physical world coordinate system, but parcels do not duplicate terrain or geography data.

## Persistence and continuation

Current default serialization is Save V9. The continuation sequence restores:

1. inherited V8/World Foundation and legacy city state;
2. canonical cadastral topology;
3. legacy lots rebuilt from the restored cadastre;
4. validated parcel zoning assignments;
5. canonical `BuildingV2` records;
6. property-market state.

Derived envelopes, massing candidates, overlay state, route caches, and other recomputable diagnostics are rebuilt rather than persisted.

## Presentation

Urban Fabric presentation is analytical and read-only:

- cadastre overlay;
- zoning-envelope overlay;
- redevelopment overlay;
- canonical parcel inspector.

Clicking while an Urban Fabric overlay is active resolves one canonical parcel ID and the inspector renders from that exact ID. Overlay selection never mutates legal or economic authority.

## Simulation invariants

The current Urban Fabric tranche requires:

- cadastral topology valid after every committed mutation;
- no overlapping private parcel interiors;
- valid frontage/access/easement/lineage references;
- deterministic mutation results for fixed input/order;
- failed geometry operations leave state unchanged;
- canonical building/property/zoning references point to existing parcels;
- legacy lot compatibility cannot overwrite canonical parcel identity;
- redevelopment cannot bypass relocation safeguards;
- Save V9 continuation preserves canonical parcel and building identity;
- ordinary rendering/UI activity cannot mutate simulation authority.
