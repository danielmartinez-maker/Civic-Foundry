# Civic Foundry Wiki

Civic Foundry is a systems-heavy city, metropolitan, and regional simulation built around deterministic state, explicit authority boundaries, and inspectable causal chains. The player acts as a civic decision-maker: building infrastructure, shaping zoning and policy, operating public systems, and observing how households, firms, developers, services, and networks respond.

## Current status

| Area | Status |
|---|---|
| Phase 0A — Kernel Skeleton & Deterministic Scheduling | **Implemented** |
| Phase 1R — World Foundation 2.0 | **Implemented** |
| Phase 2R — Urban Fabric 2.0 | **Implemented** |
| Desktop GPU Runtime — PixiJS/WebGL + Electron | **Implemented** |
| Existing traffic, transit, economy, housing, services, utilities | **Transitional** |
| Phase 3R — Transportation Engine 2.0 | **Target / next major replacement** |

Current persistence is **Save V9** (`saveVersion: 9`, `gameVersion: 0.9.0-urban-fabric`).

## Start here

### Product and roadmap
- [Vision & Player Experience](Vision-and-Player-Experience.md)
- [Current Status & Roadmap](Current-Status-and-Roadmap.md)

### Simulation and physical city
- [Runtime Architecture](Runtime-Architecture.md)
- [World Foundation](World-Foundation.md)
- [Urban Fabric](Urban-Fabric.md)
- [Transportation & Mobility](Transportation-and-Mobility.md)
- [Economy, Housing & Firms](Economy-Housing-and-Firms.md)
- [Government, Services & Infrastructure](Government-Services-and-Infrastructure.md)

### Presentation and persistence
- [Rendering, Art & Camera](Rendering-Art-and-Camera.md)
- [Save Format, Determinism & Replay](Save-Format-Determinism-and-Replay.md)

### Development
- [Contributor Guide](Contributor-Guide.md)
- [Known Issues & Technical Debt](Known-Issues-and-Technical-Debt.md)
- [Glossary](Glossary.md)

## Core causal model

```text
terrain and geography
→ infrastructure
→ accessibility
→ land economics
→ development
→ households and firms
→ employment and production
→ consumption and freight
→ travel and congestion
→ pollution and service demand
→ municipal finance
→ politics and policy
→ future infrastructure and development
```

The game should let the player inspect these relationships instead of relying on disconnected score meters or unexplained global bonuses.

## Status vocabulary

- **Implemented** — accepted current behavior backed by repository code and verification.
- **Transitional** — current playable/compatibility behavior that remains until a replacement earns authority.
- **Target** — approved future direction; not current runtime capability.

## Canonical technical references

This wiki is an orientation layer. When details conflict, prefer current code and fresh verification, then the repository's root `README.md`, `docs/ARCHITECTURE.md`, `docs/SAVE_FORMAT.md`, accepted ADRs, current-state/authority docs, and active approved phase specifications.