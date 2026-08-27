# Isometric Pass B2 — Parking & Public Realm Acceptance Report

## Acceptance baseline

- Frozen Urban Fabric checkpoint: `941a9d5261898b00af103bfd9797065975a660f2`
- Refreshed B1 head: `c7fcd402eec630089d08fa314357b97e5fc3b081`
- Verified B2 implementation head: `8a6eaf0ce2599d5d93c6cdc4c4bb082b102f8b37`
- B1 frozen-parent acceptance workflow run: `33029129233`
- B2 implementation acceptance workflow run: `33029282437`
  - Targeted job `98377788397`: success
  - Full job `98377788324`: success

## Asset contract

- Pass A: 161 entries
- Pass B1: +138 entries
- B1 composed runtime: 299 entries across 9 atlases
- Pass B2: +90 entries
- Final runtime: 389 entries across 10 atlases
- `public_realm` atlas: 2048×1152

## Presentation contract

B2 adds six deterministic context-derived profiles:

- `urban-core`
- `main-street`
- `residential-green`
- `suburban-auto-oriented`
- `industrial-logistics`
- `civic-public-space`

Parking remains presentation-only. B2 does not own or infer authoritative parking capacity, occupancy, pricing, legality, cruising penalty, generalized cost, curb regulation, parking revenue, or zoning-required spaces. Transportation 3R.6 remains the authority boundary for real parking simulation.

The runtime uses a read-only presentation fingerprint/cache, indexed context resolution, pre-indexed asset selection, and a shared deterministic scene-command buffer for cross-object depth ordering.

## Visual acceptance

The exact implementation head passed inherited Pass A interaction smoke and B1 visual regression plus all eight B2 scenes:

- `urban_core_o0.png`
- `main_street_o0.png`
- `residential_green_o0.png`
- `suburban_auto_o0.png`
- `industrial_logistics_o0.png`
- `civic_public_space_o0.png`
- `mixed_profiles_o1.png`
- `mixed_profiles_o2.png`

The full acceptance job also passed Phase 6, Phase 7, and mandatory Urban Fabric browser smoke.

## Integration and scope

Frozen-parent overlap was empty before reconciliation. Refreshed B1 was verified against the frozen checkpoint before B2 ancestry advanced. The final B2 implementation delta relative to refreshed B1 contains 29 intended B2 files and no save serialization, `SimulationCore`, service simulation, traffic economics, treasury, zoning legality, property-market authority, or parking-simulation owner changes.

PR #63 later moved beyond the frozen checkpoint and changed its CI/tooling contract. That later movement is not part of the B2 acceptance baseline. B2 remains draft and unmerged until separately authorized.
