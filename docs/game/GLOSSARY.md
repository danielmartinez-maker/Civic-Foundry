# Civic Foundry — Glossary

## Authority and architecture

**Authoritative state** — State whose exact value represents simulation truth and cannot be discarded/rebuilt without losing information.

**Derived state** — A cache, projection, index, visualization or aggregate that can be reconstructed from authoritative state.

**Authority / owner** — The single subsystem permitted to define and validate a domain’s canonical truth.

**Compatibility facade** — An API or representation retained so older systems keep working while canonical ownership moves elsewhere.

**Progressive replacement** — Civic Foundry 2.0 migration strategy: introduce a replacement behind compatibility boundaries, prove it, migrate persistence, transfer authority, then retire legacy code.

**Parity gate** — Evidence that a replacement preserves required existing behavior/invariants before authority transfer.

**Tranche** — A bounded implementation slice of a larger phase that is designed, planned, tested and reviewed independently.

**Implemented** — Accepted current runtime behavior/authority.

**Transitional** — Current compatibility behavior expected to be replaced.

**Target** — Approved future design that is not current authority.

## Simulation

**SimulationKernel** — Deterministic scheduling/orchestration infrastructure. Coordinates time/order but should not own normal city-domain state.

**SimulationCore** — Current public gameplay compatibility facade that exposes/coordinates systems while progressive replacement occurs.

**Cadence** — Explicit simulation interval at which a system runs. Independent from render frame rate.

**Determinism** — Property that identical authoritative inputs, RNG state and ordered commands produce identical authoritative outputs.

**RNG stream** — Named deterministic random sequence isolated from unrelated domains.

**Invariant** — Condition that must always hold, such as nonnegative inventory or unique ownership.

**Conservation** — Requirement that quantities such as money, population, cargo or occupancy are neither created nor destroyed except by explicit modeled sources/sinks.

**Replay** — Reproduction of simulation evolution from authoritative starting state plus ordered commands/events required for deterministic continuation.

**Snapshot** — Stable representation of state used for persistence, rendering, testing or replay depending on context. Not every snapshot is itself the authoritative owner.

## World and land

**WorldFoundation** — Sole authority for physical/geographic state: terrain, geography hierarchy, hydrology/flood state and associated spatial queries.

**Geography hierarchy** — Physical/administrative nesting: Region → Municipality → District → Neighborhood → Block.

**CadastralGraph** — Sole legal-land authority containing canonical parcel topology, geometry, frontage/access, easements, ownership identity and lineage.

**Cadastre** — Legal parcel subdivision/topology of land.

**Parcel** — Canonical legal land entity represented by polygonal geometry and cadastral identity.

**Lot** — In current compatibility terminology, a derived legacy cell/frontage address exposed by `LotSystem`; not synonymous with canonical parcel.

**Parcel lineage** — History connecting retired and successor parcels after split, assembly or right-of-way mutation.

**Frontage** — Parcel boundary relationship that provides legal/physical access toward a road or relevant edge.

**Easement** — Legal right/constraint crossing or affecting a parcel without redefining the parcel as a separate owner/domain.

**Right-of-way dedication** — Cadastral operation that changes legal land reserved for transportation/public corridor purposes. It does not by itself create lane/traffic authority.

## Zoning and buildings

**Dimensional zoning** — Land-use regulation expressed through permitted uses and physical constraints such as FAR, height, coverage, setbacks and frontage requirements.

**FAR (Floor Area Ratio)** — Ratio between allowed/realized floor area and parcel land area, subject to other constraints.

**Buildable envelope** — Geometric volume/area within which a compliant building can be placed after applying parcel geometry and zoning controls.

**BuildingV2** — Canonical Urban Fabric physical building representation used by accepted 2R systems.

**Legacy building** — Older building representation retained for inherited gameplay/save compatibility during migration.

**Massing** — Physical building-form candidate: footprint, height/floors and use allocation within a parcel/envelope.

**Highest and best use (HBU)** — Evaluation of the economically strongest feasible development use under physical, legal and market constraints.

**Adaptive reuse** — Conversion/renovation of an existing building for a different use while retaining the structure.

**Nonconforming/grandfathered building** — Existing development that remains valid even though current zoning may no longer permit its exact form/use.

## Transportation

**Road graph** — Current/inherited topological representation used for routing and road gameplay.

**Generalized travel cost** — Combined traveler cost including time and potentially fares, tolls, parking, reliability and preference penalties.

**Movement group** — Target 3R representation of a permitted intersection movement such as through or turning flow.

**Conflict matrix** — Target 3R definition of intersection movements that cannot safely operate simultaneously.

**Lane authority** — Future 3R ownership of lane configuration, permitted movements and lane-related capacity behavior.

**Accessibility** — Measure of how easily destinations/opportunities can be reached through the transport network, not simply straight-line distance.

**Weighted trip/passenger** — Cohort-like representation where one simulated object can represent multiple equivalent travelers while conserving total weight.

## Economy and real estate

**Firm / establishment** — Business entity/site participating in employment, production, inventories and economic activity.

**Input-output economy** — Target economic structure where sectors/firms consume intermediate inputs, labor, energy/capital/logistics to produce outputs.

**Economic ledger** — Conservation-safe record of material monetary transfers between accounts/entities.

**Delivered cost** — Supplier/product cost including transport/logistics time, congestion, reliability and related costs.

**Property holding** — Current ownership record linking a live canonical parcel/property to an owner within Urban Fabric’s property scope.

**Development feasibility** — Whether a project is physically, legally and economically viable under its inputs/constraints.

**Developer commitment** — Capital/project state that must not be double-spent or discarded during redevelopment logic.

**Displacement safeguard** — Rule preventing redevelopment from deleting or invalidating occupied housing without conservation-safe relocation handling.

## Population and institutions

**Weighted cohort** — Aggregate agent representing multiple people/travelers with shared relevant attributes and a conserved weight.

**Service facility** — Public institution such as school, hospital, fire/police facility or waste asset.

**Catchment** — Population/area effectively reachable or served by a facility/network under access/capacity constraints.

**Operating capacity** — Real service throughput after considering physical space, staff, equipment, queues and budget rather than building existence alone.

## Persistence

**Save V8** — Historical accepted World Foundation 2.0 persistence format.

**Save V9** — Current default persistence envelope including V8 World Foundation state plus accepted Urban Fabric state.

**Hydration** — Loading persisted authoritative state into valid runtime owners and rebuilding derived state.

**Migration** — Deterministic transformation from an older save schema to current authoritative state.

**No fabricated history** — Migration rule forbidding invented past events/transactions/time-series when older saves did not record them.

## Presentation

**GpuWorldRenderer** — Current production world renderer backed by PixiJS/WebGL.

**IsometricCamera** — Current projection/interaction contract for panning, zoom, rotation and coordinate conversion.

**Presentation state** — Visual-only state such as selection, interpolation, previews and overlay activation.

**Analytical overlay** — Derived spatial visualization used to inspect simulation conditions.

**Tilt-shift/miniature aesthetic** — Target visual direction inspired by model photography; a presentation treatment, not simulation state.

## Project concepts

**Civic Foundry 2.0** — Progressive replacement program that evolves the existing playable city simulator into the target interconnected metropolitan simulation.

**World Foundation 2.0 / 1R** — Accepted physical/geographic replacement phase.

**Urban Fabric 2.0 / 2R** — Accepted legal land/zoning/building/property foundation replacement phase.

**Transportation Engine 2.0 / 3R** — Next target replacement establishing lane/movement/signal/parking/crash street authority.

**Civic Institutions 2.0 / 4R** — Target replacement for deeper public-facility operations.

**Mobility & Transit 2.0 / 5R** — Target expansion of traveler choice and scheduled transit operations.

**Economy 2.0 / 6R** — Target input-output and firm-account economic replacement.

**Real Estate Capitalism 2.0 / 7R** — Target ownership/market/finance/development-capital replacement.