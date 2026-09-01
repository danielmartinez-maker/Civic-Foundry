# C++ Migration Reference Baseline

**Stack:** `STACK_0_CPP_MIGRATION_FOUNDATION_ABI_DETERMINISM_AND_SAVE`  
**Implementation baseline:** `main` at `9ed741834e49d211555d2ee3131f1bb6797b4b0a`  
**Native status:** **Transitional / shadow**  
**Gameplay authority:** TypeScript

## Authority freeze

The C++ substrate introduced by Stack 0 is not a gameplay authority transfer. The accepted TypeScript owners at this baseline remain:

| Domain / fact | Accepted owner |
| --- | --- |
| orchestration, clock, command ordering, scheduler, RNG streams, event journal, invariants, snapshots | `SimulationKernel` |
| public gameplay compatibility facade | `SimulationCore` |
| physical geography, terrain, hydrology, flood state | `WorldFoundation` |
| legal parcels, topology, easements, lineage | `CadastralGraph` |
| legacy lot addressing | `LotSystem` derived compatibility facade |
| parcel zoning | `ZoningSystem` parcel assignments |
| canonical Urban Fabric buildings | `BuildingSystem` `BuildingV2` store |
| property holdings and transaction history | `PropertyMarketSystem` |
| current traffic/transit/economy/services/housing gameplay | existing TypeScript compatibility domains |
| production world presentation | `GpuWorldRenderer` (read-only presentation) |
| application window lifecycle | Electron host |

C++ owns only its isolated shadow kernel infrastructure and copies of normalized persistence/diagnostic data. An `unowned` native domain hash is intentional and preferable to fabricated authority.

## Public compatibility surface

`SimulationCore` inherits the public compatibility surface exposed by `SimulationCoreBase` and `LegacySimulationCoreBase`. Current consumers include direct domain properties plus the mutation/control methods `buildRoad`, `paintZone`, `bulldozeAt`, `placeUtility`, `placeServiceFacility`, `setServiceFunding`, `setDevelopmentPolicy`, `restoreHousingState`, `step`, and Urban Fabric/cadastral mutation services. Stack 0 does not redirect those methods to C++.

The migration adapter adds a separate coarse-grained boundary:

```text
normalized command batch
→ native shadow step
→ snapshot / events / domain hashes
```

## Fixture corpus

`tests/fixtures/cpp-migration/manifest.json` binds six required scenarios to the accepted TypeScript regression corpus:

1. empty/new city;
2. small road/zoning city;
3. saved Urban Fabric V9 city;
4. active transit city;
5. active freight/economy city;
6. city containing cadastral history.

The older Phase 0A parity oracle remains immutable under `tests/fixtures/kernel-v7-parity/baseline.json`. V9-specific scenarios are additionally exercised through the current `save-v9` regression suites and the native differential round-trip gate.

## Divergence classification

Every observed TS/native mismatch must be recorded before changing expected output:

- `PARITY`: native shadow behavior must match accepted TypeScript behavior.
- `CORRECTION`: a documented defect is intentionally corrected with a regression proving the new contract.
- `DEFERRED`: the domain remains TypeScript-owned and native reports it as unowned.

The historical bug catalog predates this implementation baseline and is evidence, not current runtime authority. Stack 0 does not intentionally reproduce cataloged defects merely to obtain byte parity. If a fixture touches a cataloged behavior whose current status is uncertain, it remains `DEFERRED` until current source plus fresh verification establishes the accepted contract.

## Determinism rule

The migration oracle is normalized before hashing. A repeated run from the same save, seed, ordered command journal, and target ticks must produce byte-identical normalized output. Hashes are over semantic canonical state, never native object memory or container iteration order.
