# Save Format, Determinism & Replay

[← Wiki Home](Home.md)

## Current persistence

The current default format is **Save V9**:

```text
saveVersion: 9
gameVersion: 0.9.0-urban-fabric
```

V9 extends the complete V8 World Foundation envelope with:

- `urbanFabric: CadastralSnapshot`
- `zoningV2.parcelAssignments`
- `buildingsV2`
- `propertyMarket`

## Hydration order

V9 hydration should:

1. restore the inherited V8 candidate;
2. establish `WorldFoundation`;
3. load the canonical cadastre;
4. rebuild legacy lots from cadastral state;
5. validate all live Urban Fabric parcel references;
6. restore parcel zoning, canonical buildings, and property state;
7. rebuild derived state.

Save V8 remains an explicit historical Phase 1R format rather than being silently reinterpreted as V9.

## Migration principles

A migration must validate source state, preserve existing authoritative facts, initialize new state transparently, avoid fabricated history, rebuild safe derived state, and pass save→load→continue equivalence.

Derived caches such as route caches, spatial indexes, rendering geometry, heatmaps, and some rollups generally should not be persisted when they can be reconstructed safely.

## Deterministic simulation

The core requirement is:

```text
same authoritative state
+ same seed
+ same ordered commands
→ same authoritative future
```

This requires stable iteration order, namespaced RNG streams, deterministic migration, stable events, and conserved population/occupancy/money/inventory/passengers/cargo/ownership.

## Replay direction

Long-term replay should reconstruct simulation evolution from authoritative initial state, deterministic seed, ordered commands/events, and stable simulation/migration rules.

Major systems should eventually have unit tests, integration tests, invariant tests, replay tests, and long-run deterministic scenarios covering day/month/year/decade horizons.

## Integrity expectations

Loads and mutations should reject duplicate IDs, invalid references, malformed topology, non-finite values, over-capacity occupancy, negative inventory, conflicting ownership, double-booked scarce assets, and other violations of domain invariants.