# Prism Engine v5.1 — Civic Foundry Native Engine Architecture

## Status

Approved direction in chat on 2026-08-27.

This specification defines the target architecture for Prism Engine v5.1, the native Windows simulation substrate for Civic Foundry. It supersedes browser-oriented engine assumptions for future core-engine work. The current Electron + PixiJS/WebGL desktop runtime remains a transitional presentation/runtime bridge only; it is not the destination engine architecture.

Prism v5.1 is an architectural replacement program, not a clean-slate gameplay rewrite. Existing validated simulation behavior, cadastral authority, save compatibility, and deterministic semantics must be migrated progressively behind parity gates. No legacy subsystem is retired until its native replacement is proven.

The engine is deliberately separated from Civic Foundry game-domain systems. Prism owns memory, entities, jobs, spatial hierarchy, persistence, numerical execution, GPU compute, ML runtime, diagnostics, and low-level platform facilities. Civic Foundry owns parcels, households, firms, roads, policies, zoning, utilities, buildings, and the rules that govern them.

## Product Goal

Prism Engine v5.1 must sustain a historically persistent, multi-scale metropolitan simulation at interactive rates on Windows while allowing the player to move continuously between regional scale and individual parcels, streets, vehicles, citizens, and infrastructure assets.

The engine must support:

- native multithreaded simulation;
- deterministic execution and replay;
- cache-efficient archetype ECS storage;
- adaptive Lagrangian/Eulerian fidelity;
- cadastral topology with persistent lineage;
- continuum transport and infrastructure solvers;
- household, firm, developer, and property-market decision systems;
- multi-physics coupling;
- native D3D12 rendering and compute;
- historically queryable Chrono-Lattice persistence;
- safe ML acceleration behind deterministic authority boundaries;
- long-horizon simulation measured in decades rather than short sessions.

## Core Architectural Principles

1. **Native Windows is the target platform.** Browser compatibility, DOM APIs, browser-native ES modules, WebGL constraints, and Electron security boundaries do not constrain Prism Core.
2. **One authoritative owner per domain.** Derived views and renderer snapshots may duplicate data for presentation but never ownership.
3. **Deterministic authority.** Same initial state, ordered commands, engine version, deterministic mode, and numerical environment must produce the same authoritative result according to the declared determinism class.
4. **Cadastral topology is persistent truth.** Simulation LOD, rendering LOD, and camera state cannot create, remove, or reinterpret parcel identity.
5. **Observation changes fidelity, not history.** Camera movement may request computational refinement but may not change macro outcomes beyond declared numerical tolerances.
6. **ML is advisory unless projected through deterministic constraints.** Legal, financial, cadastral, and irreversible historical state is committed by explicit native logic.
7. **Historical identity survives LOD.** Named actors, ownership, parcel lineage, buildings, damage, construction, and protected events remain persistent even when physical detail collapses.
8. **Specialized physics beats a universal equation.** Traffic, flood, thermal, power, water, structures, and pollutants share execution infrastructure but retain domain-appropriate models.
9. **Performance is observable.** Cache behavior, job latency, transfers, GPU timing, memory pressure, AMR transitions, and Chrono throughput must be measurable.
10. **Migration is reversible until proven.** Existing TypeScript behavior remains available as a parity oracle until each native replacement passes acceptance gates.

---

# 1. Deterministic Core Fabric

## 1.1 Native Runtime and Language

Prism Core should be implemented in Rust with HLSL for D3D12 shaders and compute kernels. C or C++ libraries may be used where mature native dependencies justify them, but core ownership, scheduling, persistence, ECS, and simulation infrastructure should remain under Prism-controlled interfaces.

Rust is preferred because Prism requires precise memory layout, SIMD-aware storage, safe concurrency, deterministic systems code, explicit ownership, robust FFI, and long-lived maintainability across a large engine surface.

## 1.2 Entity Identity

Every Prism entity uses a 128-bit generational identifier:

```text
Guid {
    index: u64
    generation: u64
}
```

`index` identifies a slot in the entity registry. `generation` protects against stale references and ABA-style reuse. A slot may only be recycled after all jobs from the retiring epoch have completed. Generation increments on reuse.

Persistent game identities may additionally expose stable domain UUIDs where historical or external references require identity independent of ECS slot placement.

## 1.3 Archetype ECS

Prism uses chunked Structure-of-Arrays archetypes. Each archetype represents one exact component signature. Hot iteration traverses contiguous component streams rather than pointer-heavy object graphs.

Each component declares a temperature class:

- **Hot** — accessed every high-frequency simulation step;
- **Medium** — accessed periodically or by selected systems;
- **Cold** — historical, descriptive, legal, large geometry, or infrequent state.

Archetype chunk payload targets should generally fall between 16 and 64 KiB for hot streams, selected per signature rather than globally. Component arrays begin on 64-byte boundaries; SIMD-sensitive arrays may request stricter alignment.

Structural changes are staged through deterministic command buffers. Jobs cannot mutate archetype membership opportunistically during iteration.

## 1.4 Allocator Model

Prism exposes distinct allocators for distinct lifetimes:

- `FrameArena` — transient render/simulation-frame state;
- `TickArena` — one major simulation tick;
- `EpochArena` — state that must survive asynchronous jobs until an epoch barrier;
- `SlabPool` — fixed-size or chunk-sized hot allocations;
- `PersistentArena` — long-lived engine/domain state;
- `MappedArena` — memory-mapped Chrono and asset storage.

NUMA placement and migration are first-class metadata from the beginning, but automatic migration is profiler-driven and enabled only where hardware measurements justify it.

## 1.5 Scheduler and Job DAG

The current deterministic TypeScript scheduler is conceptually extended into a native directed acyclic job graph. Jobs declare explicit read/write resources and dependency edges. Compilation rejects unordered hazards.

Runtime execution may complete independent work in different orders, but authoritative commit order remains fixed.

Parallel systems write into thread-local or job-local result buffers. Results are then stably ordered by deterministic keys such as GUID, Morton key, parcel ID, or explicit ordinal before commit.

## 1.6 Worker Pool

Prism uses persistent worker threads with:

- local work-stealing deques;
- transient scratch arenas;
- CPU affinity metadata;
- profiler state;
- NUMA locality metadata;
- architecture-specific SIMD kernels where available.

The coordinator thread advances chronology, admits commands, compiles/dispatches DAG work, enforces barriers, and commits history. It should not become the primary compute thread.

## 1.7 Randomness

Authoritative randomness must be namespaced and reconstructable. Stateful global RNG streams are prohibited.

A deterministic random request is derived from stable context, for example:

```text
world_seed
branch_id
entity_guid
simulation_tick
decision_type
purpose
draw_index
```

BLAKE3-derived counter streams are preferred for stateless reproducibility. Reconstruction, household decisions, developer choices, procedural defects, weather scenarios, and stochastic policies each use separate namespaces.

## 1.8 Determinism Classes

Prism defines at least two authoritative execution modes:

### Strict deterministic mode

Used for CI, replay, debugging, golden tests, and divergence localization.

- fixed CPU kernels where required;
- fixed reduction order;
- fixed instruction path where necessary;
- defined floating-point environment;
- no vendor-variable GPU reduction in conservation-critical paths.

### Production deterministic mode

Used for normal gameplay.

- GPU acceleration allowed;
- event and PRNG semantics remain deterministic;
- numerical differences must stay within declared tolerance envelopes;
- irreversible commits pass deterministic projection/validation boundaries.

Cosmetic rendering variation is outside authoritative determinism.

## 1.9 Compatibility Boundary

During migration, `SimulationCore` and existing TypeScript systems remain a compatibility oracle. Prism does not permanently wrap legacy TypeScript as the engine. Native authority progressively replaces legacy domains once parity gates pass.

Save V9 remains readable during the migration period. Native persistent Prism-only state begins with Save V10.

### Section 1 Acceptance Criteria

- stale GUID access is rejected;
- archetype migration preserves component state;
- registration order cannot change scheduler results;
- deterministic command streams produce stable strict-mode hashes;
- current V9 cities remain loadable through migration tooling;
- no legacy domain is retired before its parity gate passes.

---

# 2. Spatial Hierarchy and Wave-State Reconstitution

## 2.1 Spatial Model

Prism uses a three-layer spatial model:

1. stable world sectors;
2. canonical topology and networks;
3. fidelity-dependent continuum and materialized entity state.

A loose quadtree is the default global surface-city hierarchy. Optional octree volumes are used only where vertical simulation warrants them, such as underground infrastructure, tunnels, tall-building structural zones, or atmospheric effects.

Per-sector structures may include:

- BVHs for active entity broad phase;
- half-edge cadastral topology handles;
- CSR road/utility graph views;
- finite-volume or unstructured continuum meshes;
- local uniform microgrids for effects that benefit from regular layout.

No single spatial representation is forced onto every domain.

## 2.2 Cell Fidelity State

A simulation region may be:

```text
Dormant
Eulerian
TransitionalToLagrangian
Lagrangian
TransitionalToEulerian
```

Transitions are scheduled simulation work. The renderer or camera may submit observation interest but may not directly create or destroy authoritative entities.

## 2.3 Refinement Policy

Refinement uses a scored policy driven by factors such as:

- camera distance and projected screen area;
- camera dwell time;
- player inspection volumes;
- traffic-density gradients;
- congestion fronts;
- flood gradients;
- structural damage;
- active construction;
- emergencies;
- redevelopment;
- explicit debugging requests.

Refinement and coarsening use hysteresis with separate high/low thresholds and a minimum residency time to prevent thrashing.

## 2.4 Deterministic De-Collapse

When a region becomes Lagrangian, Prism reconstructs discrete entities from continuum moments using a stateless seeded stream derived from stable sector identity and reconstruction context.

The pipeline is:

```text
continuum moments
→ deterministic candidate sampling
→ position/velocity generation
→ constraint projection
→ GUID allocation
→ archetype materialization
```

Continuous conserved quantities such as mass, weighted occupancy, and momentum are projected to tolerance. Integer entity counts are allowed bounded quantization residuals that are explicitly tracked.

## 2.5 Collapse

The inverse path:

```text
materialized entities
→ stable ordering
→ deterministic reduction
→ continuum moments
→ exceptional state extraction
→ epoch-safe retirement
```

No entity may simultaneously contribute as both Lagrangian and Eulerian state.

## 2.6 Persistent Exceptions

Some state remains persistent regardless of physical fidelity:

- named or tracked citizens;
- ownership/legal records;
- active construction;
- city-service assets;
- unique vehicles;
- damaged structures;
- incidents;
- protected historical events;
- player-created entities.

Physical transforms may collapse, but identity and historical state do not.

## 2.7 Cadastral Independence

Parcels never disappear because an area becomes coarse. AMR cells reference canonical cadastral topology rather than copying or owning parcel geometry.

Parcel split, merge, road acquisition, setbacks, easements, ownership, and lineage remain globally valid at every LOD.

## 2.8 Transition Budgets

The scheduler enforces explicit per-frame/per-tick budgets for:

- materialized entity count;
- number of sector transitions;
- geometry rebuild bytes;
- continuum projection work;
- temporary memory consumption.

Large transitions spill across deterministic simulation steps. Rendering may temporarily use impostors or aggregate motion while detail materializes.

### Section 2 Acceptance Criteria

- collapse/de-collapse preserves declared macroscopic moments;
- identical state reconstructs identical entities in strict mode;
- camera movement cannot materially change city macro outcomes;
- cadastral topology is LOD-independent;
- transition queues remain bounded;
- no stale-generation entity survives collapse;
- historical identities survive arbitrary LOD cycling.

---

# 3. Continuum Solvers, Transportation, Routing, and CPU/GPU Execution

## 3.1 Solver Family

Prism provides reusable numerical infrastructure through concepts equivalent to:

```text
ConservedField
FluxOperator
SourceOperator
BoundaryCondition
MeshView
Integrator
ConstraintProjector
```

Traffic, floodwater, pollutants, thermal transport, and selected utility flows reuse storage, scheduling, AMR, diagnostics, and reductions without sharing one universal governing equation.

## 3.2 Road Traffic

Metropolitan road traffic uses a conservative network finite-volume model. Directed road segments are subdivided into cells storing quantities such as:

- density by vehicle class;
- flow by class;
- mean speed;
- queue pressure;
- lane capacity;
- incident capacity multipliers.

Intersections solve demand/supply-constrained junction fluxes using turning fractions, downstream capacity, signals, lane rules, transit priority, emergency priority, and incidents.

Initial numerical implementation should favor robust Godunov-style finite volume with MUSCL reconstruction, a monotone limiter, HLL/Godunov-family interface flux, SSP-RK2 integration, and explicit CFL enforcement. WENO-Z, ADER, and higher-order schemes remain later optimizations for domains that demonstrate a measurable need.

## 3.3 CFL Scheduling and Subcycling

Every numerical domain exposes a maximum stable step. The major city tick coordinates domain-local substeps.

Sector-level subcycling is supported at power-of-two ratios where practical. Arbitrary asynchronous per-cell stepping is deferred because it adds substantial determinism and synchronization complexity.

## 3.4 Lagrangian Coupling

Visible vehicles consume the same authoritative network state rather than running an unrelated microscopic traffic model. Materialized vehicles read route potential, local desired velocity, lane constraints, signal state, and nearby interactions; their occupancy and motion feed back into local flow state.

## 3.5 Hierarchical Routing

Routing operates through a hierarchy such as:

```text
regional supergraph
→ corridor graph
→ local network
```

Shared-destination travel-cost potentials may be solved through graph fast marching/sweeping or equivalent algorithms and cached by destination class.

## 3.6 Multimodal Graph

The authoritative travel graph supports layered modes such as:

- walk;
- bicycle;
- private road;
- bus;
- rail;
- metro;
- ferry;
- freight.

Transfer edges model boarding, station access, parking, walking transfers, terminals, and park-and-ride.

Generalized travel cost combines time, money, reliability, transfers, and discomfort. Household preferences alter weighting; they do not rewrite network physics.

## 3.7 Accessibility as Derived Field

Accessibility is derived from authoritative network state and exposed as a parcel/regional field. Parcels do not own arbitrary accessibility scores.

Typical channels may include:

```text
car
transit
walk
bike
freight
jobs
services
education
```

Land economics, households, firms, and developers consume this field.

## 3.8 Infrastructure Solvers

The solver framework also supports specialized modules for:

- water network flow/pressure;
- stormwater runoff and drainage;
- graph-based power capacity/load;
- pollutant advection/diffusion;
- surface thermal balance.

Each domain keeps its own equations and cadence.

## 3.9 CPU/GPU Work Split

CPU is preferred for:

- cadastral topology;
- graph mutation;
- sparse dynamic event structures;
- command execution;
- persistence;
- deterministic branch-heavy commits.

GPU is preferred for:

- regular continuum sweeps;
- large AMR field updates;
- travel-cost propagation;
- hydrology;
- thermal fields;
- bulk ML inference;
- large sparse numerical passes;
- rendering.

The global DAG distinguishes CPU jobs, GPU compute jobs, and transfer jobs while preserving one dependency model.

## 3.10 D3D12 Backend

Direct3D 12 is the first-class Windows rendering and compute backend. Prism-facing interfaces remain backend-neutral enough to allow future Vulkan support without leaking D3D12 resource types into game-domain code.

The GPU runtime exposes abstractions for device, buffer, compute pipeline, command list, descriptor allocation, fences, and queue ownership.

## 3.11 GPU Determinism

GPU floating-point execution is not assumed bitwise reproducible across vendors. Strict mode uses deterministic CPU paths for conservation-critical authoritative work where required. Production mode allows GPU acceleration under bounded tolerances and requires deterministic projection before irreversible state changes.

## 3.12 Neural Solver Policy

A neural numerical surrogate may predict a substep only if it provides confidence/error diagnostics and passes constraint projection. Failed constraints trigger fallback to the conventional solver.

### Section 3 Acceptance Criteria

- closed traffic networks conserve vehicles;
- queues propagate upstream correctly;
- signals/capacity changes affect flow predictably;
- visible and continuum traffic remain statistically consistent;
- blocked roads trigger deterministic rerouting;
- accessibility updates from network state;
- CFL limits are enforced;
- no negative density or NaN reaches committed state;
- strict-mode runs reproduce exactly according to golden tests;
- GPU mode remains inside declared tolerances.

---

# 4. Chrono-Lattice, Historical State, Sandboxes, and Save V10

## 4.1 Purpose

Chrono-Lattice is a native append-oriented historical state store. It is distinct from live ECS memory and distinct from ordinary save-file serialization.

Its responsibilities are:

- deterministic historical reconstruction;
- checkpoint resume;
- long-term lineage;
- sandbox branching;
- rollback/replay diagnostics;
- protected historical inspection;
- multi-decade compaction.

## 4.2 Temporal Layers

Chrono separates:

### Fine history

Short-horizon residuals such as transforms, occupancy, flags, queue state, and selected continuum fields.

### Event history

Semantic events such as household moves, project milestones, policy changes, incidents, ownership transfers, construction, zoning changes, and infrastructure failures.

### Structural history

Parcel topology, network geometry, building footprints, persistent damage, terrain mutation, and schema/version boundaries.

Each layer has independent retention and compression policy.

## 4.3 Canonical Sequence

Every committed historical mutation receives a logical sequence:

```text
ChronoSequence {
    tick
    phase
    ordinal
}
```

Wall-clock completion order is not authoritative.

## 4.4 Checkpoints and Typed Deltas

Chrono stores periodic canonical checkpoints plus typed deltas such as:

```text
ComponentPatch
EntityCreate
EntityDestroy
ArchetypeMove
FieldTileDelta
ParcelSplit
ParcelMerge
NetworkEdgeMutation
GeometryMutation
OwnershipTransfer
PolicyMutation
```

Persistent schemas are explicitly encoded and endian-stable. Native struct memory is never serialized directly.

## 4.5 Compression

Initial compression pipeline:

```text
schema-aware encoding
→ delta/residual encoding
→ bit packing
→ Zstandard
```

Custom entropy coding is deferred until profiling proves a meaningful benefit.

## 4.6 Immutable Segments

Sealed Chrono segments are immutable, checksummed, and memory-mappable. Segment metadata includes format version, schema fingerprint, world identity, tick range, record count, compression type, byte sizes, BLAKE3 checksum, and index offsets.

## 4.7 Crash Consistency

Chrono commits follow transactional semantics:

```text
write candidate segment
→ flush payload
→ write checksum/index
→ flush metadata
→ atomically advance manifest
```

Uncommitted segments are ignored after a crash.

## 4.8 Cadastral Lineage

Parcel mutation is stored semantically. A split records source parcel, descendants, geometry, ownership disposition, zoning disposition, and tick. Historical parcel IDs remain queryable even after retirement.

The system must answer historical questions such as what parcel occupied a location at a past date and which transformations produced a present block.

## 4.9 Building History

Chrono distinguishes construction, expansion, renovation, adaptive reuse, damage, repair, demolition, and replacement. Renovation generally preserves building identity; replacement creates a new identity.

## 4.10 Historical Field Pyramids

Continuum state uses temporal/spatial pyramids. Recent history may retain fine temporal and spatial detail. Older history may compact to coarser samples while preserving protected events and higher-resolution tiles around major disasters or significant transitions.

## 4.11 Historical Inspection

Historical inspection uses immutable read-only snapshots. Scrubbing to an earlier year does not rewind or mutate the live city.

## 4.12 Rollback

Actual engine rollback restores a checkpoint and replays authoritative commands/events forward. Prism does not rely on reversing every operation.

Rollback supports numerical recovery, determinism testing, debugging, and developer tools.

## 4.13 Sandbox Branching

Prediction and player experimentation use copy-on-write branches sharing immutable checkpoint/Chrono state. A branch has its own UUID, command stream, tick, random namespace, and delta chain.

Canonical randomness and branch randomness are isolated.

## 4.14 Ensembles

Forecast ensembles are specialized families of sandbox branches. Independent stochastic dimensions receive branch-specific streams while deterministic assumptions remain shared.

Results may expose expected congestion, flood probability, development likelihood, fiscal ranges, travel-time distributions, and infrastructure risk.

## 4.15 Save V10

Save V10 is the migration boundary between existing Civic Foundry persistence and Prism-native state.

A V10 save includes Prism engine version, world identity, canonical tick, Prism checkpoint information, Chrono manifest reference/data, and compatibility metadata sufficient to trace imported V9 identities where required.

V9 migration procedure:

1. hydrate through the trusted V9 loader;
2. validate V9 invariants;
3. import canonical world/cadastral/building/economic state;
4. assign deterministic Prism GUID mappings;
5. generate the initial Prism checkpoint;
6. create the Chrono genesis segment;
7. preserve identity translation metadata where historical compatibility requires it.

The original V9 file is never overwritten automatically.

## 4.16 Schema Evolution and Hot Reload

Persistent record types are versioned. Module updates that alter persistent semantics declare migration functions and history compatibility ranges. A semantic migration becomes an explicit Chrono boundary.

## 4.17 Integrity and Replay Verification

Chrono segments and checkpoints expose domain hashes. Verification can identify the earliest divergent phase/domain between two runs.

## 4.18 Long-Term Compaction

Fine numerical replay fidelity may be reduced for very old history, but compaction may never silently destroy protected cadastral lineage, ownership, major construction, policy, named-entity history, disasters, player actions, or designated legal/economic transactions.

### Section 4 Acceptance Criteria

- deterministic V9→V10 migration;
- V10 reload reconstructs identical canonical state;
- parcel/building lineage remains queryable after repeated redevelopment;
- sandbox branches cannot mutate canonical state;
- crash injection cannot expose partially committed history;
- replay detects intentional divergence;
- 20–50 year runs maintain bounded storage growth under configured compaction;
- historical inspection is read-only.

---

# 5. Cognitive, Economic, Social, and ML Architecture

## 5.1 Household Identity

Households are persistent economic/social actors. Hot state contains compact income, asset, housing, household-size, employment, vehicle, location, preference, and satisfaction fields. Rich member/history/social data lives in colder structures.

Visible citizens may materialize and collapse independently of persistent household legal/economic identity.

## 5.2 Preferences and Utility

Households use explicit preference vectors for factors such as affordability, space, job access, transit, schools, amenities, environment, and neighborhood affinity.

Housing utility is analytical first and consumes canonical parcel/dwelling fields such as rent, size, accessibility, services, pollution, flood risk, taxes, and social proximity.

## 5.3 Discrete Choice

The baseline choice model is multinomial logit or related discrete choice with deterministic seeded Gumbel noise. Candidate sets are deterministically reduced through regional, affordability, housing-type, social, and spatial filters before utility evaluation.

Nested logit may be introduced where hierarchical decisions improve behavior.

## 5.4 Decision Cadence

Behavior occurs on domain-appropriate clocks rather than every frame. Mode choice may occur per activity; job search weekly; housing reconsideration monthly; migration monthly or quarterly; preference drift yearly or event-driven.

Major events may trigger early reconsideration.

## 5.5 Episodic Memory

Important household experiences are stored as structured episodes with tick, category, location, magnitude, affect, and source identity. Older episodes may be summarized into explicit metrics such as flood exposure, housing instability, commute frustration, neighborhood attachment, and confidence.

Neural memory compression is optional and advisory. Protected history remains explicit in Chrono.

## 5.6 Social Graph

Prism supports a sparse dynamic graph of households, people where persistent, workplaces, schools, neighborhoods, and organizations. Stable bulk storage uses CSR-like compressed structures with a small mutable delta layer between rebuilds.

Analytical social propagation is the baseline. GNN inference may estimate bounded social messages but may not directly execute canonical relocations, purchases, or other legal/economic commits.

## 5.7 Employment and Firms

Workers expose skills, wage expectations, commute tolerance, sector preferences, and employment status. Firms expose vacancies, requirements, wages, locations, schedules, productivity, finance, and establishments.

Employment matching is hierarchical to avoid all-to-all search.

Buildings are physical capital; firms are economic organizations. Firms can lease, relocate, expand, contract, hire, fire, close, and operate multiple establishments.

## 5.8 Developers

Developers are persistent firms with capital, debt capacity, risk tolerance, hurdle rates, specialization, land holdings, projects, and market expectations.

Canonical development pipeline:

```text
property market
→ candidate land
→ site assembly
→ zoning envelope
→ building massing
→ financial underwriting
→ risk adjustment
→ developer choice
→ permit/construction
```

Expected NPV uses discounted cash flow with land, demolition, site preparation, construction, financing, taxes, rent, vacancy, operating cost, environmental risk, congestion, accessibility, and duration.

Randomness represents imperfect information and heterogeneous judgment, not arbitrary behavior.

## 5.9 Property Market and Land Value

Prism maintains canonical ownership and transaction ledgers for listings, bids, sales, leases, rent changes, refinancing, assembly, and valuation.

ML may estimate value. It may not transfer title.

Land value is a derived field driven by accessibility, zoning/development envelope, rents, taxes, infrastructure, services, environmental risk, geometry, neighborhood effects, and expectations.

## 5.10 Macro/Micro Coupling

Household, firm, labor, rent, vacancy, construction, migration, and wage behavior aggregate into regional conditions such as labor tightness, housing shortage, sector growth, construction inflation, and tax base. These regional conditions feed back into slower micro decisions.

## 5.11 ML Runtime Boundary

All inference runs through a versioned `MlRuntime` abstraction. Domain systems submit model requests containing model ID, tensor handles, deterministic context, precision policy, and fallback policy. Results expose outputs, confidence, model version, runtime backend, and diagnostics.

The first native inference stack should use ONNX Runtime with CPU fallback and DirectML or CUDA providers where available.

## 5.12 Model Classes

Every model declares one of:

- **Strict** — authoritative replay requires deterministic CPU path;
- **Bounded** — GPU inference allowed with deterministic projection and error bounds;
- **Cosmetic** — may vary without affecting authoritative state.

No save may require an ML model to remain playable. Every integration has an analytical or numerical fallback.

## 5.13 Training Policy

Critical models are offline-trained, version-pinned, and read-only during normal gameplay. Online adaptation is deferred to explicitly safe model classes.

## 5.14 Explainability and Journaling

Major decisions retain compact decision traces so the game and diagnostics can answer why a household moved, why a developer built, why a firm closed, or why a parcel became valuable.

Major decisions become Chrono events; trivial recurrent choices do not necessarily remain permanent history.

## 5.15 Cognitive Fidelity Tiers

Population simulation supports:

- Tier 0 statistical cohorts;
- Tier 1 persistent households;
- Tier 2 active households with richer decisions/social processing;
- Tier 3 observed/materialized individuals.

Fidelity transitions preserve persistent identity.

### Section 5 Acceptance Criteria

- deterministic seeds reproduce individual choices;
- affordability shocks, congestion, financing rates, vacancy, transit, and flood exposure produce directionally correct aggregate responses;
- no ML model can bypass canonical financial/legal constraints;
- analytical fallback remains playable and within defined aggregate tolerances;
- population outcomes remain stable under LOD cycling;
- long-horizon tests reject pathological runaway behavior.

---

# 6. Multi-Physics, Damage, Hydrology, Thermal Systems, and Geometry Mutation

## 6.1 Physics Domain Contract

Each physics module exposes inputs, outputs, maximum stable timestep, preparation, integration, constraint projection, and diagnostics. The scheduler coordinates dependencies without embedding domain equations.

## 6.2 Operator Splitting

Prism uses operator splitting by default. Second-order Strang splitting is used where coupling strength warrants it; simpler sequential splitting is acceptable for weak coupling.

Coupling may be classified as loose, moderate, tight, or monolithic-required. Full monolithic solves are reserved for exceptional local regions.

## 6.3 Hydrology

Hydrology includes:

- forcing/rainfall;
- surface runoff;
- drainage network flow;
- surface/drainage exchange.

Active flood zones use conservative shallow-water finite-volume methods with positivity-preserving wet/dry handling. Hydrology participates in AMR; water volume must remain conservative across refinement transitions.

## 6.4 Thermal System

The baseline city thermal model is surface energy balance rather than full atmospheric CFD. It models solar input, anthropogenic heat, radiation, convection, evaporation, conduction, and thermal mass for surfaces such as asphalt, concrete, roofs, vegetation, water, soil, and façades.

Simplified physical radiation state records normal, albedo, emissivity, sky exposure, solar exposure, and shadow factor. GPU raster/ray techniques may update radiation fields without making rendered pixels authoritative physics input.

## 6.5 Structural Model

Buildings separate legal identity, geometry, structural state, occupancy, and economic asset state.

Structural fidelity tiers:

- Tier 0 — health/capacity ratios;
- Tier 1 — reduced beam/frame representation;
- Tier 2 — local FEM for critical, damaged, or landmark structures.

Loads may include dead load, occupancy, wind, flood, soil, thermal cycling, collision, construction modification, and accumulated deterioration.

## 6.6 Damage

Damage is multidimensional rather than one health scalar. Channels may include foundation, frame, floor system, façade, roof, utilities, fire, and water damage.

Damage evolution is deterministic given stored material/construction parameters and applied loads. Uncertain parameters are sampled at creation and remain fixed for the asset lifetime.

## 6.7 Persistent Geometry Mutation

Physical destruction or repair emits one canonical geometry mutation consumed by collision, navigation, continuum capacity, rendering, inspection, and Chrono.

Possible mutations include cracks, deformation, partial/full collapse, erosion, flood damage, demolition, repair, and reconstruction.

Rendering and collision may have different derived meshes but must originate from the same canonical mutation state.

## 6.8 Infrastructure Condition and Cascades

Roads and utilities carry condition/damage state. Heavy loading, heat, flooding, age, and maintenance may affect capacity and cost.

Critical infrastructure dependencies are explicit graph relationships. Cascading failure occurs through normal system inputs rather than hidden callbacks.

Examples include power→pump→water pressure and bridge→freight corridor→industrial accessibility.

## 6.9 Local Coupled Islands

Strongly coupled disasters may spawn a temporary coupled simulation island, solved iteratively or monolithically before projecting results back into the global split simulation.

## 6.10 Reconciliation and Rollback

After physics windows, Prism verifies conservation, positivity, finite temperatures, structural capacity, network bounds, valid geometry, occupancy validity, and entity placement.

Candidate updates that produce NaN, divergence, negative state, unstable residuals, or invalid geometry are rejected. The region may roll back, reduce timestep, retry, and fall back to strict CPU kernels.

Only accepted states reach Chrono.

## 6.11 Construction and Maintenance Coupling

Construction can alter road capacity, drainage, permeability, utilities, pedestrian access, noise, and structural loads through staged physical states.

Damage feeds inspections, repair cost, owner/government decisions, maintenance projects, and restored capacity. Deferred maintenance can accumulate into persistent deterioration.

## 6.12 Debris and Environmental Fields

Debris uses fidelity tiers from aggregate blocked volume to local collision obstacles to near-camera visible rigid bodies.

Pollution/environmental quality emerges from source/sink fields driven by vehicles, industry, construction, fires, wind, vegetation, precipitation, and terrain.

Weather/climate acts as external forcing; full meteorological simulation is not required initially.

### Section 6 Acceptance Criteria

A deterministic scenario must support a causal chain such as:

```text
extreme rainfall
→ drainage overload
→ street flooding
→ road capacity loss
→ rerouting/congestion
→ infrastructure loading/damage
→ structural restriction
→ accessibility decline
→ property/economic response
```

The same strict-mode scenario must reproduce consistent persistent damage and Chrono history. Individual domain benchmarks must verify conservation and known analytical/reference cases.

---

# 7. Native Runtime, Rendering, Hot Reload, Profiling, Verification, and Migration

## 7.1 Process Model

The production application is a native Windows executable containing logical runtime domains for:

- Prism Core;
- simulation workers;
- GPU runtime;
- Chrono/persistence workers;
- asset streaming;
- audio;
- UI;
- diagnostics.

UI and renderer threads consume immutable snapshots and submit typed commands. They do not mutate simulation authority directly.

## 7.2 Repository Direction

Target structure:

```text
/
├─ engine/prism/
│  ├─ core/
│  ├─ ecs/
│  ├─ jobs/
│  ├─ memory/
│  ├─ spatial/
│  ├─ chrono/
│  ├─ gpu/
│  ├─ ml/
│  └─ diagnostics/
├─ game/
│  ├─ world/
│  ├─ cadastre/
│  ├─ transport/
│  ├─ economy/
│  ├─ households/
│  ├─ buildings/
│  ├─ utilities/
│  └─ policies/
├─ renderer/
├─ desktop/
├─ assets/
├─ tools/
├─ tests/
└─ legacy-ts/
```

The exact physical move of existing files should occur incrementally rather than as an early repository-wide rename.

## 7.3 Engine/Game Boundary

Prism engine modules know about components, archetypes, jobs, fields, resources, GPU, persistence, and platform abstractions. They do not know what a residential zone, household, developer, property tax, or bus route means.

Those are Civic Foundry domain concepts layered on Prism.

## 7.4 Application Loop

The native application loop separates OS/input, command generation, fixed simulation ticks, immutable snapshot publication, render interpolation, and presentation. Render frequency never changes simulation time.

## 7.5 D3D12 Runtime

Prism uses graphics, compute, and copy queues with explicit resource/fence ownership. Simulation code must not introduce ad-hoc global GPU waits.

Rendering uses a render graph. Likely passes include visibility/depth, terrain, roads, buildings, vegetation, vehicles, citizens, water, damage, lighting, shadows, atmosphere, tilt-shift, and UI composition.

## 7.6 Tilt-Shift Presentation

The miniature-model aesthetic becomes a native post-processing system using scene depth and a camera-derived focus plane. The effect should support variable depth-of-field blur, bokeh/highlight treatment, and grading. It must not be implemented as a fixed horizontal blur independent of scene geometry.

## 7.7 Hot Reload

Prism distinguishes:

- safe data hot reload;
- shader hot reload;
- gameplay-module reload with explicit schema migration;
- tightly constrained development-only core reload.

Allocator, scheduler, and other foundations are not expected to be safely replaced beneath live memory.

Reloadable gameplay modules declare schema version, component/system registration, migration, load, and unload behavior. Failed migration leaves the existing module active.

## 7.8 Profiling

Profiling is a first-class engine facility. Jobs report identifiers, domains, worker/thread, timestamps, CPU cycles where available, and read/write estimates. GPU jobs use timestamp queries.

The profiler should expose:

- flame graphs;
- task DAG critical path;
- worker utilization;
- synchronization stalls;
- GPU timings;
- transfer bytes;
- memory/allocator usage;
- AMR transition cost;
- archetype migration;
- Chrono throughput;
- VRAM pressure.

Development builds should integrate with ETW/Windows Performance Analyzer where practical and collect hardware counters where available.

## 7.9 SIMD

Runtime feature detection may select AVX2, optional AVX-512, or scalar paths. Strict deterministic mode may pin an instruction path when reproducibility requires it.

## 7.10 Benchmarks

Standard benchmark worlds should include at least:

- TinyTown — approximately 100k population;
- Metro — approximately 1M;
- Megacity — approximately 5M;
- StressRegion — approximately 10M statistical population under heavy traffic, flooding, and redevelopment.

Exact supported scale depends on profiling and hardware tier, but architectural code must not assume one fully ticking heavyweight agent per person.

## 7.11 Verification Hierarchy

Prism testing includes:

1. kernel tests;
2. domain tests;
3. integration scenarios;
4. deterministic replay;
5. 20–50 year generational city simulations.

Property-based tests should cover GUIDs, serialization, archetype transitions, parcel geometry, collapse/reconstruction, and rollback/replay.

Fuzzing should cover persistent formats, save/Chrono parsers, geometry operations, command decoding, schemas, and asset metadata.

Numerical domains maintain strict-mode golden tests plus production GPU tolerance tests.

## 7.12 Crash Diagnostics

Production diagnostics should capture technical state such as engine/game/save versions, world identity, simulation tick, last Chrono sequence, thread stacks, GPU device-removal reason, recent engine events, and hardware profile. Diagnostics should avoid collecting unrelated personal content.

## 7.13 Independent Versioning

Civic Foundry game version, Prism engine version, save version, Chrono format version, and content schema version are independent identifiers.

## 7.14 Migration Phases

Prism is adopted through controlled vertical slices:

### P0 — Prism bootstrap

Native executable, logging, build, allocator foundations, GUID registry, job infrastructure, tests.

### P1 — ECS and deterministic scheduler

Native archetype storage, structural command buffers, deterministic DAG execution, profiling hooks.

### P2 — WorldFoundation and cadastre import

Native geographic authority and cadastral topology with compatibility import from existing state.

### P3 — Save V10 and Chrono genesis

Deterministic V9 import, native checkpoint creation, initial Chrono history.

### P4 — Transportation

Native road network, traffic continuum, routing, accessibility fields.

### P5 — Property and development

Native parcel market, zoning/massing integration, underwriting, construction pipeline.

### P6 — Households and firms

Native labor, housing, social, household, firm, and developer decision systems.

### P7 — Hydrology and multi-physics

Native flooding, thermal, structural condition, infrastructure damage, environmental coupling.

### P8 — Full native renderer

D3D12 city renderer, simulation-driven LOD, tilt-shift, damage/construction rendering, native UI integration.

### P9 — Legacy retirement

Remove TypeScript authority only after all parity, save, determinism, performance, and long-run gates pass.

## 7.15 Parity Harness

Migration scenarios feed the same seed and command streams into the legacy TypeScript domain and the native Prism replacement. Canonical outputs are compared where semantics are meant to remain unchanged.

Comparisons include money, parcels, zoning, buildings, population, employment, development, network topology, and selected transport/economic metrics.

Intentional semantic improvements require explicit architecture decisions rather than being smuggled into a port.

## 7.16 No Dual Authority

At any migration point, exactly one implementation owns each domain. A transitional matrix may show, for example, Prism owning cadastre while TypeScript still owns housing. Two engines may never concurrently commit to the same domain.

The bridge transfers typed, versioned schemas rather than arbitrary language-runtime objects. It is temporary and deleted after migration.

## 7.17 Packaging

The destination product is a conventional native x64 Windows application with signed installer strategy, crash dumps, versioned save location, GPU capability detection, and development diagnostics. Electron is removed from production after native runtime parity.

### Section 7 Acceptance Criteria

Prism becomes Civic Foundry's engine only when:

- authoritative simulation runs natively;
- V9→V10 migration is proven;
- Chrono is canonical;
- native rendering is production-ready;
- determinism and replay suites pass;
- 20–50 year stress runs remain valid;
- benchmark cities meet their performance envelopes;
- the game no longer requires legacy TypeScript execution;
- Windows build/install/run is a supported production path.

---

# Architectural Relationship to Existing Civic Foundry Decisions

## Existing Desktop GPU Runtime

ADR 0002 adopted Electron + PixiJS/WebGL as a first desktop migration tranche while deliberately preserving the authoritative TypeScript simulation. Prism v5.1 does not invalidate the historical correctness of that decision. It changes the destination architecture.

The accepted interpretation is now:

- Electron/PixiJS is transitional scaffolding;
- it may remain useful during the native-engine migration;
- no new Prism subsystem should be designed around browser limitations;
- the final production engine/rendering/runtime target is native Windows with D3D12;
- the transition must preserve current gameplay and save compatibility while native parity is established.

A future ADR should record the formal supersession of ADR 0002's destination assumptions once the first native Prism implementation tranche is ready to begin.

## Existing World and Cadastral Authority

`WorldFoundation` and `CadastralGraph` remain the trusted semantic baseline during migration. Native Prism replacements must preserve their canonical ownership rules and historical identity before the legacy implementations can be retired.

## Existing Save V9

Save V9 remains the trusted import source. Prism does not silently mutate its schema. Save V10 is introduced only when native Prism state exists and the migration path is covered by tests.

---

# Global Verification Matrix

Before Prism v5.1 can be considered architecturally realized, the program must demonstrate:

### Determinism

- stable strict-mode state hashes;
- deterministic PRNG derivation;
- fixed authoritative commit ordering;
- divergence localization by phase/domain.

### Memory and ECS

- stale-handle rejection;
- bounded archetype migration cost;
- no unexpected heap allocation in designated hot loops;
- measurable allocator/NUMA behavior.

### Spatial Fidelity

- LOD cycling preserves macro state;
- reconstruction preserves declared moments;
- observation cannot create historical truth.

### Numerical Systems

- conservation/positivity constraints;
- CFL compliance;
- CPU strict references;
- GPU tolerance envelopes.

### Cadastral and Historical Integrity

- valid topology under split/merge/road mutation;
- permanent lineage;
- protected event retention;
- crash-consistent Chrono commits.

### Behavioral Systems

- statistically plausible long-run responses;
- bounded aggregate behavior;
- explainable major decisions;
- deterministic fallbacks for ML.

### Multi-Physics

- reproducible hazards;
- persistent damage;
- explicit cascading dependencies;
- no silent simulation/render divergence.

### Persistence

- V9→V10 deterministic migration;
- checkpoint/state equality;
- replay correctness;
- bounded long-term storage.

### Performance

- benchmark worlds with documented hardware;
- CPU/GPU critical-path telemetry;
- transition and transfer budgets;
- no performance regressions merged without explicit review.

---

# Implementation Planning Rule

This document defines the target system but does not authorize a monolithic implementation.

Each migration phase must be decomposed into reviewable implementation tranches. Every tranche must define:

- authoritative ownership before and after the change;
- compatibility boundary;
- files/modules touched;
- tests written before production code where practical;
- persistence impact;
- determinism mode impact;
- performance gate;
- rollback strategy;
- exact criteria for retiring legacy behavior.

The first implementation plan should begin with **P0 — Prism bootstrap** and stop before moving any Civic Foundry game-domain authority. P0 exists to prove the native toolchain, test harness, deterministic GUID/entity registry, allocator foundations, job execution model, diagnostics, and Windows executable shell without risking current gameplay state.

No later phase should begin merely because scaffolding exists. Each phase advances only after its explicit verification gate passes.
