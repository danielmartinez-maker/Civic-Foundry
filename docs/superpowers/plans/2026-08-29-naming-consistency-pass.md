# Naming Consistency Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove proven naming drift in the current Civic Foundry runtime without changing authoritative behavior, persisted IDs, or compatibility semantics.

**Architecture:** Keep the current progressive-replacement boundaries intact. Normalize only module/export naming and player-facing terminology where the repository has an unambiguous canonical term; legacy persisted values such as the `garbage` service department remain unchanged.

**Tech Stack:** TypeScript 5.8.3, Node.js 22 built-in test runner, existing repository verification/CI.

**Spec:** `docs/ENGINEERING_STANDARDS.md`

## Global Constraints

- Preserve canonical authority names including `SimulationCore`, `SimulationKernel`, `WorldFoundation`, `CadastralGraph`, `BuildingV2`, and `GpuWorldRenderer`.
- Preserve all save schemas, save versions, historical browser storage slots, entity IDs, enum wire values, and deterministic behavior.
- Keep `garbage` as the compatibility service-department value; use `Waste` only for player-facing terminology.
- Do not rename historical plan/spec files or legacy phase fixtures merely for aesthetics.
- Run the repository's existing verification gates before completion.

---

### Task 1: Add naming regression contracts

**Files:**
- Modify: `tests/audit-hardening.test.ts`

**Interfaces:**
- Consumes: `LegacySimulationCore.ts`, `GameApp.ts`, `Inspector.ts`.
- Produces: regression coverage for the canonical legacy-core export and current player-facing milestone/waste terminology.

- [ ] **Step 1: Write the failing tests**

Add a direct import of `LegacySimulationCore` from `../src/simulation/core/LegacySimulationCore.ts` and assertions that:

```ts
const legacy = new LegacySimulationCore({ terrain: flatTerrain(), seed: 77 });
assert.equal(legacy.seed, 77);
```

Extend the source-contract checks to require:

```ts
assert.match(gameAppSource, /URBAN FABRIC 2\.0 · DESKTOP GPU RUNTIME/);
assert.doesNotMatch(gameAppSource, /PHASE VI/);
assert.match(gameAppSource, /<option value="garbage">Waste<\/option>/);
assert.doesNotMatch(gameAppSource, /<option value="garbage">Garbage<\/option>/);
assert.match(inspectorSource, /Waste backlog:/);
assert.match(inspectorSource, /Waste access:/);
assert.doesNotMatch(inspectorSource, /Garbage backlog:|Garbage access:/);
```

- [ ] **Step 2: Run the test to verify RED**

Run the branch CI/core test gate. Expected failure: `LegacySimulationCore` is not exported under that name and the stale presentation strings are still present.

- [ ] **Step 3: Commit the RED contract**

Commit message:

```text
test: define naming consistency contracts
```

### Task 2: Align the legacy core module/export name

**Files:**
- Modify: `src/simulation/core/LegacySimulationCore.ts`
- Modify: `src/simulation/core/SimulationCore.ts`
- Modify: `tests/support/kernelParity.ts`

**Interfaces:**
- Consumes: the historical V7-compatible core implementation.
- Produces: an exported `LegacySimulationCore` symbol whose name matches its module and all direct consumers.

- [ ] **Step 1: Rename the exported class**

Change:

```ts
export class SimulationCore {
```

to:

```ts
export class LegacySimulationCore {
```

- [ ] **Step 2: Remove import aliases**

In `SimulationCore.ts` and `tests/support/kernelParity.ts`, replace:

```ts
import { SimulationCore as LegacySimulationCore } from './LegacySimulationCore.ts';
```

(or the equivalent relative path) with:

```ts
import { LegacySimulationCore } from './LegacySimulationCore.ts';
```

using each file's existing relative path.

- [ ] **Step 3: Verify the focused naming test passes**

Run the core test gate. Expected: the new export resolves and historical parity code compiles unchanged.

- [ ] **Step 4: Commit**

Commit message:

```text
refactor: align legacy simulation core naming
```

### Task 3: Normalize current player-facing terminology

**Files:**
- Modify: `src/app/GameApp.ts`
- Modify: `src/ui/Inspector.ts`

**Interfaces:**
- Consumes: the current accepted 2R + Desktop GPU runtime and the legacy `garbage` compatibility department value.
- Produces: current milestone wording and consistent `Waste` labels without changing service IDs or simulation APIs.

- [ ] **Step 1: Update the stale runtime banner**

Replace the `PHASE VI · FIRMS, PRODUCTION & FREIGHT` eyebrow with:

```text
URBAN FABRIC 2.0 · DESKTOP GPU RUNTIME
```

- [ ] **Step 2: Normalize service overlay copy**

Keep `value="garbage"` unchanged and change only its visible label from `Garbage` to `Waste`.

- [ ] **Step 3: Normalize inspector copy**

Change `Garbage backlog:` to `Waste backlog:` and `Garbage access:` to `Waste access:`. Do not rename `core.garbage`, `garbageSnapshot`, the `garbage` service department, or save fields.

- [ ] **Step 4: Run tests**

Run the core test gate. Expected: naming contracts and existing behavior tests pass.

- [ ] **Step 5: Commit**

Commit message:

```text
fix: normalize current runtime terminology
```

### Task 4: Full verification and review

**Files:**
- No production files added beyond Tasks 2–3.

**Interfaces:**
- Consumes: completed branch.
- Produces: verification evidence and a reviewable pull request.

- [ ] **Step 1: Run the canonical verification gate**

Run:

```bash
npm run verify
```

Expected: all core gates pass.

- [ ] **Step 2: Run relevant browser smoke coverage**

Run the existing browser/visual smoke workflow through CI because `GameApp` copy changed.

- [ ] **Step 3: Review the diff**

Confirm the change does not alter save schemas, storage keys, service department values, simulation state, or canonical authority names.

- [ ] **Step 4: Open the pull request**

Use a concise summary describing the symbol/module alignment, stale runtime label cleanup, preserved compatibility values, and verification status.
