# Stack 2 — C++ Transportation & Mobility Rewrite Status

This branch contains the native transportation authority implementation developed against the accepted TypeScript Transportation Engine 2.0 semantics.

## Implemented native domains

- typed transportation identities and deterministic legacy-road projection;
- authoritative road/segment/carriageway/lane/movement network state;
- lane groups and movement permissions;
- stop/yield/signal intersection control with deterministic signal phases and persisted control state;
- movement-aware deterministic routing with topology/cost revision invalidation;
- generalized route cost hooks for incidents and destination parking;
- parking facilities and weighted reservations;
- incident lifecycle, capacity/speed effects, and cost revisioning;
- lane-aware weighted traffic load metrics with finite zero-capacity handling;
- exact causal trip weights and deterministic trip generation;
- generalized-cost mode choice;
- transit stops, lines, passenger queues, partial boarding, transfers, vehicles, dwell, failure recovery, and in-service capacity;
- transfer-capable multimodal journey planning;
- immutable transportation snapshot/restore validation and deterministic domain hash;
- narrow pure-C transportation ABI with opaque handles and copied buffers;
- optional Node-API smoke binding that stores handles behind numeric registry IDs.

## Verification

The transport subproject is deliberately isolated from the temporary root `cpp/CMakeLists.txt` implementations on the concurrent Stack 0 and Stack 1 branches. Run:

```bash
cmake -S cpp/transport -B build/cpp-transport
cmake --build build/cpp-transport --parallel 2
ctest --test-dir build/cpp-transport --output-on-failure
```

The dedicated workflow also verifies GCC, Clang, Clang ASan/UBSan, and Windows MSVC.

## Integration boundary

Stack 0 and Stack 1 currently diverge from the same TypeScript baseline and both modify the native root build substrate. This branch therefore does not claim production transportation authority yet. Final authority transfer requires the shared native substrate to converge, then:

1. register this transport library/domain with the common `NativeEngine` and generic C ABI;
2. attach Save V9 transportation persistence to the shared save adapter;
3. add TS-vs-C++ differential fixtures and shadow-run hashes;
4. route production `SimulationCore` transportation mutations and snapshots through the native owner;
5. demote legacy TypeScript transportation implementations to compatibility adapters;
6. run the complete Stack 2 acceptance gate before removing legacy mutation paths.
