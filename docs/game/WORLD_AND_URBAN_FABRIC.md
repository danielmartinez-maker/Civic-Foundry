# Civic Foundry — World & Urban Fabric

## Status

**Implemented foundation:** World Foundation 2.0 and Urban Fabric 2.0 are accepted current authority layers.

This document explains how physical geography, legal land, zoning, buildings and redevelopment fit together. Detailed implementation authority remains in [`../ARCHITECTURE.md`](../ARCHITECTURE.md), [`../SIMULATION.md`](../SIMULATION.md) and the relevant accepted phase specs.

## Two different kinds of land truth

Civic Foundry deliberately separates the **physical world** from the **legal subdivision of that world**.

### Physical/geographic authority — `WorldFoundation`

`WorldFoundation` owns facts that would still exist even if property boundaries were redrawn:

- elevation and slope;
- soil and bearing conditions;
- bedrock and groundwater;
- vegetation and contamination;
- drainage, channels, watersheds and flood state;
- region/municipality/district/neighborhood/block geography;
- world generation configuration and physical spatial queries.

### Legal-land authority — `CadastralGraph`

`CadastralGraph` owns facts created by legal subdivision and land tenure:

- parcel identity and polygon geometry;
- shared cadastral boundaries;
- block-to-parcel membership;
- frontage and access;
- easements;
- owner identity;
- zoning-district identity/reference;
- parent/retired parcel lineage after legal mutations.

A parcel occupies physical world coordinates but does not own terrain or geography.

## Geography hierarchy

The accepted physical hierarchy is:

```text
Region
→ Municipality
→ District
→ Neighborhood
→ Block
```

Urban Fabric then adds legal parcels and canonical buildings within that physical structure.

Long-term city analytics and policy should use this hierarchy for spatial aggregation without allowing analytical regions to become competing physical authorities.

## Terrain and engineering conditions

**Implemented.** World Foundation supports deterministic terrain with engineering-relevant attributes rather than a cosmetic heightfield alone.

Key physical variables include:

- elevation;
- slope/aspect;
- soil class and depth;
- bearing capacity;
- bedrock depth;
- groundwater depth;
- vegetation;
- contamination;
- surface water/flood susceptibility.

Accepted soil classes include rock, gravel, sand, loam, clay, alluvium, peat and disturbed/fill conditions.

These properties can affect construction preparation and development economics. Generated worlds therefore create different engineering contexts, while migrated/legacy worlds can preserve neutral economics where appropriate.

## Hydrology and flooding

**Implemented foundation.** The world supports deterministic drainage analysis and design-storm flooding.

The model includes:

- terrain conditioning;
- D8-style drainage routing with deterministic tie breaking;
- watershed assignment;
- flow accumulation;
- generated channels;
- infiltration/storage/export accounting;
- flood depth and susceptibility;
- explicit water-balance validation.

Ordinary city ticks do not mutate the world’s terrain or previous flood state. Physical events occur through explicit world operations such as the authoritative design-storm entry point.

**Target extensions:** later climate/environment phases add broader weather, drought, heat, pollution and resilience mechanics. These should build on World Foundation rather than create another terrain/hazard owner.

## World generation

**Implemented.** Seeded world generation provides reproducible physical environments. Current world presets include different broad landforms such as plains, valleys, basins, uplands, ridge conditions and coastal lowlands.

Randomness is namespaced so changing one generation stream should not silently change unrelated geography.

Scenario-authored physical overrides are allowed without inventing hidden contamination or history.

## Parcels

**Implemented canonical legal entities.** Parcels are polygonal legal land units rather than merely tile labels.

Important parcel concepts include:

- stable canonical identity;
- area and centroid;
- frontage/access edges;
- ownership;
- zoning assignment;
- easements;
- lineage from split/assembly/right-of-way changes.

A canonical parcel may cover multiple legacy grid cells. The compatibility layer can expose several legacy lot addresses over one parcel without changing the parcel’s identity.

## Legacy lots

`LotSystem` is **Transitional** and derived.

Its purpose is to let inherited cell-based gameplay continue to address land while Urban Fabric owns legal parcels. It must be rebuilt from cadastral state rather than edited as an independent source of truth.

Rule:

> The cadastre decides what legal land exists; the lot facade lets legacy systems address compatible cells/frontage.

## Zoning

### Current Urban Fabric zoning — Implemented

Zoning is represented as a dimensional envelope attached to canonical parcels rather than a direct instruction to spawn a specific building.

Controls include:

- permitted uses;
- floor-area ratio (FAR);
- maximum height;
- lot coverage;
- setbacks;
- frontage and parcel-dimension constraints;
- mixed-use permissions;
- overlays/restrictions where defined.

The buildable-envelope system converts those rules and parcel geometry into physically feasible development space.

### Legacy R/C/I zoning — Transitional

Inherited residential/commercial/industrial paint still exists for compatibility and migration. New Urban Fabric work should treat parcel-level zoning as the canonical development entitlement within accepted 2R scope.

### Future planning law — Target

Later phases expand zoning into a player-editable planning-law system with broader code reform, impact fees, inclusionary rules, historic/environmental overlays, density bonuses, transferable rights and similar regulatory tools.

## Canonical buildings — `BuildingV2`

**Implemented.** Urban Fabric stores physical canonical building records separate from inherited legacy building records.

`BuildingV2` represents concepts such as:

- parcel reference;
- physical footprint;
- floors and massing;
- use components;
- area-derived capacity;
- lifecycle/project state;
- condition and quality;
- age/effective age;
- optional project/development metadata.

Mixed-use buildings are first-class rather than forced into one global zone/use label.

## Development pipeline

Current parcel-authoritative development logic follows this conceptual flow:

```text
canonical parcel
→ effective zoning
→ buildable envelope
→ finite physical massing candidates
→ zoning compliance
→ economics / highest-and-best-use
→ development decision / bidding
→ canonical BuildingV2 materialization
```

Terrain preparation costs can enter underwriting for generated worlds. Accessibility and later market/finance systems can further affect feasibility.

The player therefore creates conditions for development instead of directly specifying every private building outcome.

## Building lifecycle

**Implemented 2R foundation.** Buildings can carry lifecycle and condition state supporting:

- maintenance need;
- deterioration;
- renovation;
- adaptive reuse;
- distress;
- demolition/redevelopment;
- grandfathered or nonconforming conditions.

Later phases can deepen financing, contractors, approvals, occupants and code enforcement without changing the principle that the physical building record remains authoritative for its accepted domain.

## Property and redevelopment

Urban Fabric includes current parcel holdings/transactions and redevelopment economics.

Current capabilities include:

- property holdings linked to live parcels;
- recorded transactions;
- highest-and-best-use analysis;
- site assembly;
- deterministic redevelopment execution;
- relocation/displacement safeguards inherited from earlier housing/development systems.

Historical transactions may reference retired parcel IDs only when cadastral lineage proves those parcels legitimately existed.

## Cadastral mutation

Legal land can change through controlled operations such as:

- parcel split;
- assembly;
- easement creation/removal;
- right-of-way dedication.

Low-level geometry validity is insufficient because many systems reference parcel IDs. Runtime mutation therefore crosses an explicit transaction boundary.

Conceptually:

```text
snapshot dependent authorities
→ mutate candidate cadastre
→ stage parcel-reference rewrites
→ validate all dependent state
→ commit in deterministic order
→ rollback every owner on failure
→ rebuild derived lots
```

This protects against partial land mutations leaving zoning, buildings, property or legacy lots inconsistent.

## Transportation boundary

Urban Fabric may know that a parcel has frontage/access to a road. It does not own lane topology, traffic, signals or parking.

Right-of-way dedication changes legal land. It does not automatically create Transportation 2.0 road authority.

## Player-facing meaning

World and Urban Fabric should make city building materially spatial:

- difficult terrain costs more;
- flood exposure matters;
- parcels have geometry and access constraints;
- zoning controls legal development capacity;
- private development must fit physical/legal/economic conditions;
- existing buildings age and create path dependence;
- parcel assembly can unlock larger projects;
- infrastructure and planning choices reshape future development possibilities.

This physical/legal foundation is the substrate on which the later transportation, economy, household, government and environmental systems are built.