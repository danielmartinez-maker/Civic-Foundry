# Glossary

[← Wiki Home](Home.md)

**Authoritative state** — simulation truth that must be persisted or deterministically reconstructed according to its domain contract.

**Derived state** — caches, indexes, rendering geometry, heatmaps, or other data computed from authoritative state and normally safe to rebuild.

**Compatibility facade** — API/read model that keeps older callers working while a newer system becomes authoritative.

**Progressive replacement** — Civic Foundry 2.0 strategy of replacing one authority domain at a time while preserving a playable baseline.

**SimulationKernel** — deterministic scheduling/orchestration infrastructure; not the normal owner of city-domain state.

**SimulationCore** — current public gameplay facade and compatibility boundary.

**WorldFoundation** — sole authority for physical geography, terrain, hydrology, and administrative geography.

**CadastralGraph** — canonical authority for legal parcels and parcel topology.

**Cadastre** — legal representation of parcels, boundaries, frontage/access, easements, ownership identity, and lineage.

**Parcel** — canonical legal land unit.

**Legacy lot** — compatibility addressing record derived from canonical cadastral state for older cell-based systems.

**Parcel lineage** — historical relationship recording how parcels were created, split, assembled, dedicated, or retired.

**Right-of-way** — land legally dedicated to a transportation/public corridor; dedication alone does not create road-network authority.

**Easement** — legal access/use constraint crossing or affecting parcel land.

**Dimensional zoning** — zoning expressed through constraints such as allowed use, FAR, height, coverage, setbacks, and frontage.

**FAR** — floor-area ratio: allowable/realized floor area relative to parcel area.

**Buildable envelope** — physical/legal footprint or volume remaining after parcel geometry and zoning constraints are applied.

**BuildingV2** — canonical Urban Fabric building representation.

**Highest and best use (HBU)** — economic evaluation of the most valuable feasible legal development option for a site.

**Site assembly** — combining multiple parcels to enable a larger development opportunity.

**Grandfathered / nonconforming** — existing development preserved by legal/history rules even when it does not match current zoning.

**Generalized travel cost** — combined travel utility/cost including time, money, waiting, reliability, tolls, parking, and other relevant factors.

**OD flow** — origin-destination travel demand.

**Movement group** — intersection movements evaluated/controlled as a compatible group.

**Passenger weight** — weighted representation of multiple travelers while conserving total passenger demand.

**Cohort** — weighted group representing multiple similar agents.

**Explicit agent** — individually simulated entity used when identity, routing, sequence, or capacity materially changes outcomes.

**Economic ledger** — conservation-aware accounting of material value transfers.

**Causality trace** — structured explanation of how actual model inputs contributed to an outcome.

**Event journal** — ordered record of deterministic simulation events for diagnostics/replay infrastructure.

**Snapshot** — stable read model of simulation state for presentation, inspection, or replay diagnostics.

**Save migration** — versioned transformation preserving historical authoritative facts while initializing newly introduced state.

**Save V8** — World Foundation persistence envelope.

**Save V9** — current Urban Fabric persistence envelope (`saveVersion: 9`, `gameVersion: 0.9.0-urban-fabric`).

**GpuWorldRenderer** — PixiJS/WebGL production presentation renderer.

**IsometricCamera** — projection/input contract for world/canvas conversion, pan, zoom, rotation, and picking.

**Prism Engine** — long-horizon umbrella architecture concept; not currently an integrated authoritative `PrismEngine` runtime object.

**Implemented** — accepted current behavior backed by code and verification.

**Transitional** — current playable/compatibility behavior awaiting an accepted replacement.

**Target** — approved future direction, not current runtime capability.

**Determinism** — identical authoritative inputs, seed, and ordered commands produce identical authoritative outcomes.

**Parity gate** — acceptance check demonstrating that a replacement preserves required behavior before old authority is retired.

**Invariant** — condition that must always remain true, such as valid parcel references, conserved money, or occupancy within capacity.

**Spatial index** — derived structure accelerating location-based queries.

**Tiered fidelity** — mixing explicit agents, weighted cohorts, and aggregates at different scales to preserve causality while maintaining performance.

**Scenario** — authored starting condition and objective set executed within deterministic simulation rules.

**Replay** — reconstruction of simulation evolution using deterministic initial state and ordered inputs.