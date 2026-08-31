# Runtime Architecture

[← Wiki Home](Home.md)

## Current runtime

Civic Foundry uses progressive replacement rather than a clean-slate rewrite.

```text
Electron desktop host
  → GameApp
    → SimulationCore facade
      → SimulationKernel
      → WorldFoundation
      → CadastralGraph
      → Urban Fabric systems
      → transitional gameplay domains
    → GpuWorldRenderer
      → PixiJS / WebGL
```

The browser and Electron desktop targets execute the same authoritative TypeScript simulation.

## Authority map

### `SimulationKernel`
Owns orchestration infrastructure: clock, deterministic ordering, scheduler graph, command ordering, RNG stream registry, event journal infrastructure, invariants, snapshots, and performance/replay hooks. It should not own ordinary city-domain state.

### `SimulationCore`
The current public gameplay facade and compatibility boundary. It delegates to domain owners while preserving older APIs during migration. It should not evolve into a permanent giant coordinator.

### `WorldFoundation`
Sole physical/geographic authority for terrain, soils, groundwater, hydrology, flooding, physical geography, and geographic/channel indexing.

### `CadastralGraph`
Canonical legal-land authority for parcel geometry, topology, frontage/access, ownership identity, zoning-district identity, easements, and parcel lineage.

### `LotSystem`
Derived legacy compatibility facade. It lets older cell-based systems address land but cannot become a second land authority.

### Urban Fabric systems
Own parcel-authoritative development concerns: zoning compliance, envelopes, massing, `BuildingV2`, lifecycle, renovation, HBU, property market, site assembly, and cadastral runtime mutation coordination.

### `GpuWorldRenderer`
Presentation only. It owns GPU scene objects, caches, overlays, interpolation, selection visuals, and previews. It cannot determine simulation outcomes or create save-state facts.

### Electron host
Owns application-window lifecycle only. It does not own city simulation or persistence.

## Progressive replacement

For each domain:

1. freeze current behavior with regression fixtures;
2. define the replacement interface and authority;
3. build the new system;
4. compare invariants and player-visible outcomes;
5. migrate persistence;
6. transfer authority;
7. remove the legacy path only after acceptance.

## Determinism

Identical authoritative inputs, seed, and ordered commands should produce the same authoritative future. RNG streams are namespaced so added randomness in one domain does not perturb unrelated domains.

## Prism Engine

**Prism Engine is currently a target/conceptual umbrella architecture, not an integrated authoritative runtime object.** The accepted runtime remains `SimulationKernel` + `SimulationCore` + domain authorities + `GpuWorldRenderer`. Future Prism work must earn authority through the same implementation, determinism, persistence, migration, performance, and documentation gates as every other replacement.