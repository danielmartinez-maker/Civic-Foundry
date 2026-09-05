# C++ Cross-Runtime Parity Evidence Schema

**Schema version:** `1`  
**Purpose:** Machine-verifiable evidence for every TypeScript-to-C++ migration round.  
**Authority effect:** Diagnostic/control-plane only. This schema does not transfer gameplay authority.

## Deterministic comparison contract

Every parity claim is evaluated from the same deterministic inputs:

```text
same save
+ same seed
+ same ordered command journal
+ same target ticks
→ normalized semantic comparison
```

Evidence must identify the exact migration stack, fixture, target tick, and domain. Semantic evidence is based on normalized snapshots, drained domain events, versioned domain hashes, invariant outcomes, and repeated deterministic runs. Native object memory and unordered container iteration are never admissible semantic evidence.

## Normative evidence object

```json
{
  "schemaVersion": 1,
  "stackId": "K001",
  "fixtureId": "empty-new-city",
  "targetTick": 100,
  "classification": "PARITY",
  "domains": [
    {
      "domain": "kernel",
      "typescript": {
        "ownership": "owned",
        "snapshotSha256": "<64 hex>",
        "eventsSha256": "<64 hex>",
        "domainHashVersion": 1,
        "domainHash": "<unsigned decimal string>",
        "invariants": "pass"
      },
      "native": {
        "ownership": "owned",
        "snapshotSha256": "<64 hex>",
        "eventsSha256": "<64 hex>",
        "domainHashVersion": 1,
        "domainHash": "<unsigned decimal string>",
        "invariants": "pass"
      },
      "comparison": {
        "snapshot": "match",
        "events": "match",
        "domainHash": "match",
        "invariants": "match"
      }
    }
  ],
  "determinism": {
    "typescriptRepeatSha256": "<64 hex>",
    "nativeRepeatSha256": "<64 hex>",
    "typescriptRepeatMatch": true,
    "nativeRepeatMatch": true
  },
  "correction": null,
  "generatedAtCommit": "<40 hex>"
}
```

## Enumerations

Allowed classifications:

```text
PARITY
CORRECTION
DEFERRED
```

Allowed comparison values:

```text
match
mismatch
not_applicable
```

Allowed ownership values:

```text
owned
unowned
```

Invariant outcomes are either `pass` or `fail`.

## Classification rules

### `PARITY`

- TypeScript and native ownership must both be `owned` for every compared domain.
- Every snapshot, event, domain-hash, and invariant comparison must be `match`.
- TypeScript and native deterministic repeat checks must both be `true`.
- `correction` must be `null`.

`PARITY` means the C++ result matches accepted TypeScript behavior.

### `CORRECTION`

A mismatch is admissible only when the evidence records all of:

- a non-empty `correction.issue`;
- a non-empty `correction.regressionTest`;
- a non-empty `correction.rationale`.

Deterministic repeat checks must still pass, and the evidence must retain the mismatch rather than hiding it by changing expected output.

Example:

```json
"correction": {
  "issue": "SIM-016",
  "regressionTest": "FreightConservation.DeliveredOverflowIsPreserved",
  "rationale": "Native implementation intentionally fixes accepted cataloged freight destruction defect."
}
```

### `DEFERRED`

- Native ownership must be `unowned` for every listed domain.
- Native `domainHash` must be the unsigned decimal string `"0"`.
- Snapshot, event, domain-hash, and invariant comparisons must all be `not_applicable`.
- Deterministic repeat checks must still pass.
- `correction` must be `null`.
- No native behavioral parity claim is made.

`DEFERRED` means the domain is still TypeScript-owned and native ownership remains unowned.

## Artifact path convention

Generated parity evidence uses:

```text
test-artifacts/cpp-parity/<stackId>/<fixtureId>-tick-<targetTick>.json
```

Examples:

```text
test-artifacts/cpp-parity/K001/empty-new-city-tick-100.json
test-artifacts/cpp-parity/S004/saved-urban-fabric-v9-tick-500.json
```

Generated evidence is ignored by Git by default. `test-artifacts/cpp-parity/.gitkeep` preserves the artifact directory convention in the repository. CI may upload generated evidence when useful; a migration stack does not need to commit every generated artifact unless that stack explicitly requires it.

## Validator

Validate one evidence artifact with:

```bash
npm run cpp:parity:evidence:verify -- test-artifacts/cpp-parity/K001/empty-new-city-tick-100.json
```

Run the schema validator regression suite with:

```bash
npm run test:cpp-parity-evidence
```

## Required evidence for later rewrite rounds

A round claiming `shadow_complete` must have:

- native focused tests green;
- normalized snapshot evidence;
- normalized event evidence;
- domain hash evidence;
- invariant evidence;
- native repeat determinism green;
- TypeScript oracle repeat determinism green where TypeScript still exists;
- an explicit `PARITY`, `CORRECTION`, or `DEFERRED` classification.

A round claiming `parity_accepted` must additionally have:

- no unexplained mismatch;
- all owned-domain comparisons matching unless classified `CORRECTION`;
- regression proof and rationale for every `CORRECTION`;
- evidence referencing the exact stack and fixture.

No migration ledger entry may move to `native_authoritative` based solely on compilation or unit tests.

## Non-negotiable constraints

- Never hash native object memory.
- Never use unordered container iteration as semantic evidence.
- Never change expected fixture output solely to obtain green parity.
- Classify a mismatch before changing accepted expected output.
- Keep evidence deterministic and reproducible.
- Keep evidence diagnostic/control-plane only.
- Do not transfer gameplay authority through this schema or validator.
