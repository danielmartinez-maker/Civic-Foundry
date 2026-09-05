# Native Authority-Flip Gates

Civic Foundry's TypeScript-to-C++ migration must preserve one gameplay authority per domain at every accepted commit. This document defines the control-plane states and evidence gates used before any native authority transfer.

C006 defines policy only. It does not transfer authority, change simulation behavior, or persist migration state in city saves.

## Authority state machine

Allowed states, in order:

```text
typescript_authoritative
        ↓
shadow
        ↓
parity_accepted
        ↓
native_authoritative
        ↓
typescript_removed
```

The transition order is monotonic. A domain may remain in its current state or advance by one gate at a time. It may not skip a gate or move backward.

Forbidden conditions include:

```text
TypeScript mutates + native mutates same gameplay fact
no authoritative owner
native marked authoritative before evidence
TypeScript removed before native cutover accepted
renderer/UI becomes authority
```

> `shadow` is not dual authority. The native side may compute and compare, but it may not commit accepted gameplay mutations while TypeScript remains authoritative.

## Planning-baseline ownership

The current native ownership contract is:

```text
kernel          owned
world           unowned
cadastre        unowned
buildings       unowned
transportation  unowned
population      unowned
economy         unowned
services        unowned
```

The machine-readable registry is `docs/cpp/NATIVE_AUTHORITY_STATE.json`. It is migration policy, not simulation state, and must never be serialized into city saves.

## Gate A — TypeScript → Shadow

Required:

```text
native implementation exists
focused native tests pass
native path does not mutate accepted gameplay state
TypeScript remains sole gameplay owner
domain hash may remain unowned until meaningful native semantic state exists
```

The native implementation may compute deterministic comparison output and diagnostic hashes. It must not commit gameplay facts that TypeScript still owns.

## Gate B — Shadow → Parity Accepted

Required:

```text
C005 evidence validates
classification is PARITY or accepted CORRECTION
repeat determinism passes
save/load continuation passes when domain is persisted
invariants pass
native performance does not violate current stack budget
```

`DEFERRED` evidence never authorizes a cutover. `CORRECTION` evidence is acceptable only when the correction is accepted and the evidence contains the required regression test and rationale defined by the C005 schema.

## Gate C — Parity Accepted → Native Authoritative

Required:

```text
native C ABI reports domain owned
one authoritative command path points to native
TypeScript mutation path is disabled for that domain
compatibility readers may remain
save/load continuation passes
full relevant integration tests pass
```

A renderer, UI adapter, compatibility facade, or persistence reader cannot become gameplay authority. Compatibility reads must remain read-only with respect to accepted gameplay state.

## Gate D — Native Authoritative → TypeScript Removed

Required:

```text
no runtime import/call relies on TS implementation
replacement behavioral tests exist natively
C003 monotonicity guard passes after deletion
C002 ledger marks affected files ts_removed
repository still builds
```

TypeScript deletion is a separate gate after cutover. Reaching native authority does not by itself authorize immediate removal of compatibility readers or TypeScript files.

## Evidence and persistence rules

- No domain may be recorded as `native_authoritative` unless the native runtime reports ownership=`owned`.
- `native_authoritative` and `typescript_removed` require a non-empty evidence reference.
- `parity_accepted` requires a non-empty evidence reference and still permits TypeScript mutation because cutover has not occurred.
- TypeScript mutation must be disabled for `native_authoritative` and `typescript_removed`.
- Save/load compatibility must survive future authority flips for persisted domains.
- C006 does not change save fixtures, save versions, or C005 expected comparison values.
- Kernel is the pre-existing native-owned planning baseline and retains `docs/cpp/MIGRATION_BASELINE.md` as its evidence reference.

## Mandatory authority-flip checklist

Before changing a domain to `native_authoritative`:

- [ ] C004 focused native round tests green.
- [ ] C005 evidence validates.
- [ ] Evidence classification is `PARITY` or accepted `CORRECTION`.
- [ ] Determinism repeat passes.
- [ ] Domain invariants pass.
- [ ] Save/load continuation passes if persisted.
- [ ] Native runtime returns ownership=`owned`.
- [ ] TypeScript mutation path is disabled.
- [ ] Compatibility reads do not mutate state.
- [ ] C006 registry advances exactly one state.
- [ ] C002 ledger is updated for affected files.
- [ ] C003 monotonicity still passes.
- [ ] Relevant integration tests pass.
- [ ] No renderer/UI ownership was introduced.

Before deleting a TypeScript implementation:

- [ ] Domain already reached `native_authoritative`.
- [ ] All runtime callers have moved.
- [ ] Native replacement tests cover behavior.
- [ ] Registry advances to `typescript_removed`.
- [ ] Ledger files advance to `ts_removed`.
- [ ] Tracked TypeScript count decreases.
- [ ] Build remains green.

## Repository verification

Structural policy checks:

```bash
npm run test:cpp-authority-gate
npm run cpp:authority:verify
```

A focused native ownership check can be run with:

```bash
node scripts/cpp/run-native-round.mjs --regex "DomainHashCanonicalizesSemanticCommandPayloadAndMarksUnownedDomains"
```

If a future stack legitimately changes native ownership, update runtime implementation, evidence, the registry, ledger state, and tests together. Do not weaken the ownership test merely to make a registry change pass.
