# Civic Foundry

Civic Foundry is an original browser-based city-management and urban-development simulation built in deterministic vertical slices.

## Project status

- Phase 1 — Playable Foundation: designed and implemented in the prior local workspace.
- Phase 2 — Core City Loop: implemented and verified.
- Phase 3 — Traffic: implemented and verified at the prior local checkpoint `f0bb3d6` with 115/115 tests passing before that execution workspace expired.
- Phase 4 — Public Services: design approved; implementation is next.

## Canonical development model

GitHub is now the durable source of truth for Civic Foundry. New work should be committed here on phase/feature branches and integrated through reviewable checkpoints.

The simulation architecture is renderer-independent and deterministic. Authoritative systems live in `SimulationCore` and focused domain modules; presentation consumes snapshots and submits typed commands. Important statistics must derive from real simulated state rather than fabricated UI values.

## Immediate recovery note

The prior execution runtime lost the mounted Phase 3 TypeScript/Git source tree after its verified checkpoint. The preserved design specifications are being restored here, but the actual Phase 3 source files still need to be recovered from any surviving ZIP, checkout, artifact, or repository copy before Phase 4 implementation can safely resume from the verified codebase.

Do not recreate the missing source from memory and claim continuity with the verified Phase 3 checkpoint.

## Development roadmap

1. Playable foundation
2. Core city loop
3. Traffic
4. Public services
5. Public transport
6. Economic depth
7. Urban depth
8. Metropolitan infrastructure
9. Environment and events
10. Polish
