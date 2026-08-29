# ADR 0003: Native Prism Engine Bootstrap

- Status: Accepted
- Date: 2026-08-27
- Supersedes: ADR 0002 as the destination runtime architecture; ADR 0002 remains historically valid for its transitional desktop-GPU tranche.

## Context

Civic Foundry now targets a native Windows engine capable of explicit multithreading, cache-conscious data layout, native persistence, D3D12 compute/rendering, and long-horizon deterministic simulation. The Electron + PixiJS/WebGL runtime proved the desktop presentation boundary without risking the validated TypeScript simulation, but browser-runtime constraints are no longer appropriate for Prism Engine's destination architecture.

## Decision

Prism Engine is introduced progressively under `engine/prism/` in Rust. The P0 tranche pins Rust 1.98.0, uses Rust 2024 edition, commits its Cargo lockfile, adds no third-party Rust crates, and establishes only the native engine foundation: entity identity, aligned memory primitives, deterministic job-graph compilation, diagnostics, verification, and a native executable bootstrap shell.

P0 transfers no Civic Foundry gameplay authority. `SimulationCore`, `WorldFoundation`, `CadastralGraph`, Save V9, the current TypeScript simulation, and the Electron/PixiJS presentation remain operational compatibility systems until later Prism migration phases pass their parity gates.

D3D12 rendering, worker-thread execution, archetype ECS storage, Chrono-Lattice, Save V10, cadastral import, and gameplay-domain migration are excluded from P0.

## Consequences

Civic Foundry now has an explicit native-engine destination without requiring a risky all-at-once rewrite. During migration the repository carries both the validated TypeScript runtime and the growing Prism native runtime, with separate verification commands and one authoritative owner per gameplay domain. Browser/Chromium smoke tests remain regression gates only while they still exercise the authoritative transitional game runtime; they are removed only when native equivalents have replaced their coverage.
