# Civic Foundry Documentation

This directory contains the project's canonical technical documentation, accepted architecture records, implementation/design material, and the repository-backed Civic Foundry wiki.

## Wiki

Start with **[Civic Foundry Wiki Home](wiki/Home.md)** for a structured overview of the product, current status, major simulation domains, rendering, persistence, contribution workflow, known technical debt, and terminology.

## Canonical technical references

- [Architecture](ARCHITECTURE.md) — runtime boundaries and authoritative ownership.
- [Stack 8 architecture baseline & failure map](architecture/STACK_8_BASELINE_AND_FAILURE_MAP.md) — authoritative ownership, integration boundaries, transactions, structured failures, deterministic repro, scheduler/revision contracts, diagnostics, performance and lifecycle audit.
- [Stack 8 cross-domain regression matrix](architecture/STACK_8_REGRESSION_MATRIX.md) — permanent test ownership for integration seams and replay/transaction expectations.
- [Save Format](SAVE_FORMAT.md) — persistence and migration authority.
- [Simulation](SIMULATION.md) — simulation-system behavior and contracts.
- [Testing](TESTING.md) — verification strategy and test gates.
- [Engineering Standards](ENGINEERING_STANDARDS.md) — repository engineering rules.
- [Balancing](BALANCING.md) — balancing/calibration guidance.
- [ADRs](adr/) — accepted architecture decisions.
- [Art documentation](art/) — presentation and asset guidance.
- [Superpowers design/spec material](superpowers/) — approved designs, plans, and historical implementation material.

## Source-of-truth rule

When documents disagree, prefer accepted current code plus fresh verification evidence, then the root `README.md`, `docs/ARCHITECTURE.md`, `docs/SAVE_FORMAT.md`, and accepted ADRs before explanatory or historical planning documents.

A specification describes intent; it does not by itself prove implementation.