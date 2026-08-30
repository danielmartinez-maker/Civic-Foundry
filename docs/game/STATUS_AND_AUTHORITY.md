# Civic Foundry — Status & Authority Matrix

## Why this document exists

Civic Foundry is being rebuilt through progressive replacement. For a period of time, new and inherited systems coexist. This file prevents that coexistence from turning into ambiguous ownership.

## Status definitions

- **Implemented:** accepted current authority or current supported behavior.
- **Transitional:** current compatibility behavior that may still be player-facing but is expected to be replaced.
- **Target:** approved future behavior without current authority.

## Current top-level authority matrix

| Domain | Current authority / owner | Status | Notes |
| --- | --- | --- | --- |
| Simulation scheduling | `SimulationKernel` | Implemented | Coordinates deterministic execution; should not become a giant domain owner. |
| Public gameplay facade | `SimulationCore` | Transitional architectural facade | Keeps existing callers stable while domains migrate. |
| Physical world/geography | `WorldFoundation` | Implemented | Sole authority for terrain, geography, hydrology and world physical state. |
| Legal land/parcels | `CadastralGraph` | Implemented | Sole authority for cadastral topology and parcel identity. |
| Legacy lots | `LotSystem` projection | Transitional | Derived compatibility addressing; never legal-land authority. |
| Parcel zoning | Urban Fabric parcel-zoning state | Implemented | Dimensional zoning on canonical parcels. |
| Canonical physical buildings | `BuildingV2` store / Urban Fabric building systems | Implemented | Separate from inherited legacy building records. |
| Property holdings/transactions | `PropertyMarketSystem` Urban Fabric state | Implemented within current scope | Later real-estate phases deepen markets/finance. |
| Cadastral cross-domain mutation | `CadastralRuntimeMutationService` | Implemented | Coordinates parcel-ID changes across dependent authorities. |
| Roads/traffic | inherited road/traffic systems | Transitional | 3R will establish final lane/movement/signal/parking/crash authority. |
| Transit | inherited transit systems | Transitional | Playable bus/BRT/tram/metro stack; later replacement deepens operations. |
| Firms/economy | inherited economy/firm systems | Transitional | Later Economy 2.0 replaces authority behind parity gates. |
| Population/housing | inherited population/housing systems | Transitional | Later household/property phases replace primary demographic/market authority. |
| Public services | inherited service systems | Transitional | Current routed services remain until Civic Institutions 2.0. |
| Utilities | inherited utility systems | Transitional | Future network infrastructure phase adds explicit graph authority. |
| Taxes/treasury | inherited tax/treasury systems | Transitional | Future government-finance phase deepens accounting and liabilities. |
| World presentation | `GpuWorldRenderer` | Implemented presentation owner | Owns GPU scene state, never simulation truth. |
| Camera/projection | current `IsometricCamera` contract | Implemented | Used for interaction/projection across GPU path. |
| Desktop shell | Electron main process | Implemented host only | Window lifecycle/security; no simulation authority. |
| Persistence | Save V9 current envelope | Implemented | V9 includes World Foundation + Urban Fabric additions. |

## Hard authority boundaries

### Physical world vs legal land

`WorldFoundation` answers questions such as:

- elevation and slope;
- soil/bedrock/groundwater;
- drainage, channels and flood state;
- municipality/district/neighborhood/block geography.

`CadastralGraph` answers questions such as:

- what legal parcels exist;
- parcel geometry and shared boundaries;
- frontage/access/easements;
- ownership identity and parcel lineage.

A parcel exists inside world coordinates but does not become geography authority.

### Cadastre vs legacy lots

The cadastre determines legal land. `LotSystem` provides a stable legacy addressing projection for inherited cell-based consumers.

Never update lots independently and then treat them as canonical parcel truth.

### Canonical vs legacy buildings

Current architecture deliberately retains two building representations during migration:

- legacy building records for inherited gameplay/save compatibility;
- canonical `BuildingV2` records for Urban Fabric.

New Urban Fabric development logic should originate from canonical parcel/building identity. Compatibility reads may project into older representations where required.

### Simulation vs presentation

Rendering/UI can:

- read snapshots/state;
- derive visual geometry;
- animate/interpolate presentation;
- display overlays and selection;
- emit typed player commands/actions.

Rendering/UI cannot:

- create authoritative simulation outcomes;
- secretly mutate saved state;
- own gameplay history;
- invent entity identity that is later treated as canonical.

### Electron vs game runtime

Electron hosts the built application. It owns window lifecycle and desktop security configuration. It does not own city simulation or persistence state.

## Future authority transfers

Authority is transferred only when a replacement phase passes acceptance.

Examples:

- **3R:** inherited traffic authority → lane/movement/signal/parking/crash Transportation 2.0 authority.
- **4R:** simplified service coverage/operations → facility/staff/equipment/queue Civic Institutions authority.
- **6R:** inherited economy → sector/input-output/firm-account Economy 2.0 authority.
- **7R:** partial property economics → explicit ownership/listing/transaction/finance real-estate authority.
- **8:** aggregate population → household/person/cohort demographic authority.
- **9:** inherited utilities → explicit infrastructure-network authority.

Until the gate passes, the old implementation remains the accepted owner for behavior it still controls.

## Derived-state policy

Derived state may be duplicated for performance when it is rebuildable and cannot diverge into a competing owner.

Typical derived state:

- spatial indexes;
- path/route caches;
- rendering geometry;
- heatmaps and accessibility surfaces;
- analytical rollups;
- compatibility projections;
- UI selection and preview state.

If rebuilding a value would lose real historical information, it is probably authoritative and requires deliberate persistence ownership.

## Conflict resolution checklist

When two systems appear to own the same fact:

1. inspect `docs/ARCHITECTURE.md` and accepted ADRs;
2. identify which value is persisted as authoritative state;
3. identify which system validates mutations;
4. identify whether one representation is documented as derived/compatibility state;
5. check current accepted tests and save hydration;
6. do not create a third representation to work around the disagreement.

If ownership is genuinely ambiguous, fix the architecture/documentation before adding more behavior.