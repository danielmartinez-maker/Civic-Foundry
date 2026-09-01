# Prism Engine P0 Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the first native Prism Engine tranche: a Rust 1.98.0 workspace, deterministic 128-bit entity registry, 64-byte-aligned memory foundation, deterministic job-DAG compiler, diagnostics/bootstrap probe, and native Windows executable shell, without moving any existing Civic Foundry gameplay authority.

**Architecture:** Add Prism as a new native workspace under `engine/prism/` while the current TypeScript simulation remains authoritative. P0 proves low-level contracts and Windows-native build/run capability only; it deliberately avoids cadastral import, Save V10, D3D12 rendering, worker-thread execution, Chrono-Lattice, and gameplay-domain migration. The existing Electron/Pixi runtime and browser regression stack remain transitional compatibility gates during this tranche.

**Tech Stack:** Rust 1.98.0, Rust 2024 edition, Cargo resolver 3, Rust standard library only for P0, Node.js 22 repository tooling, GitHub Actions Windows and Ubuntu runners.

**Spec:** `docs/superpowers/specs/2026-08-27-prism-engine-v5.1-design.md`

## Global Constraints

- Native Windows is Prism's destination platform; browser, DOM, WebGL, and Electron constraints must not shape Prism Core APIs.
- P0 moves **zero** Civic Foundry gameplay-domain authority. `SimulationCore`, `WorldFoundation`, `CadastralGraph`, Save V9, and all current gameplay systems remain authoritative.
- Save V9 remains unchanged in P0. Save V10 and Chrono-Lattice begin only when Prism owns persistent game state.
- The current Electron/PixiJS runtime remains transitional scaffolding and must continue passing its inherited regression gates during P0.
- Pin the Rust toolchain to **1.98.0**, released 2026-08-20; use Rust 2024 edition and Cargo resolver 3.
- Add **no third-party Rust crates in P0**. The standard library is sufficient for the bootstrap contracts and minimizes supply-chain surface while the native foundation is being established.
- Commit `engine/prism/Cargo.lock` even though P0 is dependency-light; Prism is an application workspace, not a published library workspace.
- P0 production Rust forbids `unsafe` code. The initial aligned-memory primitive uses `#[repr(align(64))]` storage and safe indexing. Any future relaxation requires explicit review because later native allocators may justify narrowly-audited unsafe code.
- Deterministic IDs, dependency ordering, and diagnostics must never depend on hash-map iteration order, wall-clock completion order, thread scheduling, locale, or filesystem ordering.
- Node.js 22 remains the repository orchestration runtime. Any new Node child-process orchestration uses `shell: false` and cross-platform path APIs.
- Existing `npm run verify` remains the legacy TypeScript core gate during migration. Add `npm run prism:verify` and `npm run verify:all`; do not silently redefine the meaning of the existing gate in the first native tranche.
- Keep commits narrow and Conventional Commit formatted. Each task below ends at a reviewable green checkpoint.

---

## File Map

### Repository/toolchain

- Create `rust-toolchain.toml` — pins Rust 1.98.0 with `rustfmt` and `clippy`.
- Create `engine/prism/Cargo.toml` — Prism workspace root, shared version/edition/lints.
- Create `engine/prism/Cargo.lock` — committed Cargo resolution.
- Modify `.gitignore` — ignore `engine/prism/target/` only; do not ignore `Cargo.lock`.
- Create `scripts/prism-verify.mjs` — cross-platform Cargo verification orchestration.
- Create `tests/prism_build_policy.test.ts` — locks the repository-facing Prism verification command contract.
- Modify `package.json` — adds `prism:verify` and `verify:all`, and includes the new test in Prettier surfaces.
- Modify `.github/workflows/ci.yml` — adds Rust verification to Ubuntu and a dedicated Windows native-host build/smoke job.

### Prism Core

- Create `engine/prism/core/Cargo.toml` — `prism-core` library crate.
- Create `engine/prism/core/src/lib.rs` — public module boundary and engine version.
- Create `engine/prism/core/src/entity/mod.rs` — entity API exports.
- Create `engine/prism/core/src/entity/guid.rs` — 128-bit `EntityGuid`.
- Create `engine/prism/core/src/entity/registry.rs` — deterministic generational registry.
- Create `engine/prism/core/src/memory/mod.rs` — memory API exports.
- Create `engine/prism/core/src/memory/aligned_block.rs` — safe 64-byte aligned bootstrap storage.
- Create `engine/prism/core/src/jobs/mod.rs` — job API exports.
- Create `engine/prism/core/src/jobs/graph.rs` — deterministic dependency/hazard compiler.
- Create `engine/prism/core/src/diagnostics/mod.rs` — deterministic diagnostic record buffer.
- Create `engine/prism/core/src/bootstrap.rs` — P0 cross-subsystem bootstrap probe.

### Native host

- Create `engine/prism/host/Cargo.toml` — native executable crate depending only on `prism-core`.
- Create `engine/prism/host/src/main.rs` — process entry point and deterministic startup report.
- Create `engine/prism/host/tests/bootstrap_smoke.rs` — native executable smoke contract, active on Windows.

### Rust integration/stress tests

- Create `engine/prism/core/tests/entity_registry.rs`.
- Create `engine/prism/core/tests/aligned_block.rs`.
- Create `engine/prism/core/tests/job_graph.rs`.
- Create `engine/prism/core/tests/diagnostics.rs`.
- Create `engine/prism/core/tests/bootstrap.rs`.
- Create `engine/prism/core/tests/p0_invariants.rs`.

### Documentation

- Create `docs/adr/0003-native-prism-bootstrap.md` — records the native Prism destination and P0 exclusions.
- Modify `docs/adr/0002-desktop-gpu-runtime.md` — mark its runtime destination assumptions superseded by ADR 0003 while preserving its historical tranche decision.
- Modify `docs/ENGINEERING_STANDARDS.md` — add Rust/native rules and combined verification gate.
- Modify `docs/TESTING.md` — document Prism test tiers and Windows smoke requirement.
- Modify `README.md` — describe current transitional runtime versus native Prism destination and commands.
- Modify `CONTRIBUTING.md` — add Rust setup and required P0 verification.
- Modify `docs/DEVELOPMENT_LOG.md` — record P0 only after final verification passes.

---

### Task 1: Native Rust workspace and repository verification contract

**Files:**
- Create: `rust-toolchain.toml`
- Create: `engine/prism/Cargo.toml`
- Create: `engine/prism/core/Cargo.toml`
- Create: `engine/prism/core/src/lib.rs`
- Create: `engine/prism/host/Cargo.toml`
- Create: `engine/prism/host/src/main.rs`
- Create via Cargo: `engine/prism/Cargo.lock`
- Create: `scripts/prism-verify.mjs`
- Create: `tests/prism_build_policy.test.ts`
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: existing Node 22 repository orchestration and GitHub Actions CI.
- Produces: `prism-core` library, `prism-host` executable, pinned Rust toolchain, and `npm run prism:verify` / `npm run verify:all` repository commands used by every subsequent P0 task.

- [ ] **Step 1: Write the failing Node build-policy test**

Create `tests/prism_build_policy.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { prismVerificationCommands } from "../scripts/prism-verify.mjs";

test("Prism verification keeps the native gate deterministic and explicit", () => {
  assert.deepEqual(prismVerificationCommands, [
    ["fmt", "--all", "--", "--check"],
    ["clippy", "--workspace", "--all-targets", "--locked", "--", "-D", "warnings"],
    ["test", "--workspace", "--locked"],
    ["check", "--workspace", "--all-targets", "--locked"],
  ]);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
node --experimental-strip-types --test tests/prism_build_policy.test.ts
```

Expected: FAIL because `../scripts/prism-verify.mjs` does not exist.

- [ ] **Step 3: Add the pinned Rust workspace**

Create `rust-toolchain.toml`:

```toml
[toolchain]
channel = "1.98.0"
profile = "minimal"
components = ["clippy", "rustfmt"]
```

Create `engine/prism/Cargo.toml`:

```toml
[workspace]
members = ["core", "host"]
resolver = "3"

[workspace.package]
version = "0.1.0"
edition = "2024"
rust-version = "1.98"
license = "UNLICENSED"

[workspace.lints.rust]
unsafe_code = "forbid"
```

Create `engine/prism/core/Cargo.toml`:

```toml
[package]
name = "prism-core"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
license.workspace = true
publish = false

[lints]
workspace = true
```

Create `engine/prism/core/src/lib.rs`:

```rust
#![forbid(unsafe_code)]

pub const PRISM_VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg(test)]
mod tests {
    use super::PRISM_VERSION;

    #[test]
    fn workspace_version_is_exposed() {
        assert_eq!(PRISM_VERSION, "0.1.0");
    }
}
```

Create `engine/prism/host/Cargo.toml`:

```toml
[package]
name = "prism-host"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
license.workspace = true
publish = false

[dependencies]
prism-core = { path = "../core" }

[lints]
workspace = true
```

Create `engine/prism/host/src/main.rs`:

```rust
#![forbid(unsafe_code)]

fn main() {
    println!("Prism native host {}", prism_core::PRISM_VERSION);
}
```

Generate and commit the lockfile:

```bash
cargo generate-lockfile --manifest-path engine/prism/Cargo.toml
```

- [ ] **Step 4: Implement cross-platform Prism verification orchestration**

Create `scripts/prism-verify.mjs`:

```js
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const prismRoot = fileURLToPath(new URL("../engine/prism/", import.meta.url));

export const prismVerificationCommands = Object.freeze([
  Object.freeze(["fmt", "--all", "--", "--check"]),
  Object.freeze([
    "clippy",
    "--workspace",
    "--all-targets",
    "--locked",
    "--",
    "-D",
    "warnings",
  ]),
  Object.freeze(["test", "--workspace", "--locked"]),
  Object.freeze(["check", "--workspace", "--all-targets", "--locked"]),
]);

function runCargo(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("cargo", args, {
      cwd,
      shell: false,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`cargo ${args.join(" ")} exited with code ${code}`));
    });
  });
}

export async function runPrismVerification(cwd = prismRoot) {
  for (const command of prismVerificationCommands) {
    await runCargo([...command], cwd);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runPrismVerification();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
```

Modify `package.json` scripts by adding:

```json
"prism:verify": "node scripts/prism-verify.mjs",
"verify:all": "npm run verify && npm run prism:verify"
```

Add `tests/prism_build_policy.test.ts` to both the `format` and `format:check` Prettier file lists.

Modify `.gitignore` by adding:

```text
engine/prism/target/
```

Do not add `Cargo.lock` to `.gitignore`.

- [ ] **Step 5: Update CI without removing legacy gates**

In the existing Ubuntu `verify` job, after checkout and before `npm run verify`, add:

```yaml
      - name: Rust 1.98.0
        run: |
          rustup toolchain install 1.98.0 --profile minimal --component rustfmt,clippy
          rustup default 1.98.0
```

After `Core verification`, add:

```yaml
      - name: Prism verification
        run: npm run prism:verify
```

Add a second job:

```yaml
  prism-windows:
    runs-on: windows-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v7.0.1
      - name: Rust 1.98.0
        run: |
          rustup toolchain install 1.98.0 --profile minimal --component rustfmt,clippy
          rustup default 1.98.0
      - name: Build native Prism host
        run: cargo build --manifest-path engine/prism/Cargo.toml -p prism-host --release --locked
```

Do not remove the Chromium/browser smoke steps in P0.

- [ ] **Step 6: Run focused and native verification**

Run:

```bash
node --experimental-strip-types --test tests/prism_build_policy.test.ts
npm run prism:verify
```

Expected: PASS. `cargo fmt`, Clippy with warnings denied, workspace tests, and workspace check all complete successfully.

- [ ] **Step 7: Run the inherited repository gate**

Run:

```bash
npm run verify
```

Expected: PASS with no changes to Save V9 or current TypeScript authority.

- [ ] **Step 8: Commit**

```bash
git add rust-toolchain.toml engine/prism .gitignore package.json scripts/prism-verify.mjs tests/prism_build_policy.test.ts .github/workflows/ci.yml
git commit -m "build: bootstrap native Prism workspace"
```

---

### Task 2: 128-bit generational entity identity and deterministic registry

**Files:**
- Create: `engine/prism/core/src/entity/mod.rs`
- Create: `engine/prism/core/src/entity/guid.rs`
- Create: `engine/prism/core/src/entity/registry.rs`
- Modify: `engine/prism/core/src/lib.rs`
- Test: `engine/prism/core/tests/entity_registry.rs`

**Interfaces:**
- Consumes: only Rust standard-library collections.
- Produces: `EntityGuid { index: u64, generation: u64 }`, `EntityRegistry::spawn()`, `EntityRegistry::despawn()`, `EntityRegistry::is_alive()`, `alive_count()`, and `slot_count()` for later ECS/archetype work.

- [ ] **Step 1: Write failing public-contract tests**

Create `engine/prism/core/tests/entity_registry.rs`:

```rust
use prism_core::entity::{EntityGuid, EntityRegistry, EntityRegistryError};

#[test]
fn recycled_slot_increments_generation_and_rejects_stale_guid() {
    let mut registry = EntityRegistry::new();
    let first = registry.spawn().expect("first spawn");
    assert_eq!(first, EntityGuid::new(0, 0));

    registry.despawn(first).expect("despawn first");
    assert!(!registry.is_alive(first));

    let second = registry.spawn().expect("recycled spawn");
    assert_eq!(second, EntityGuid::new(0, 1));
    assert!(registry.is_alive(second));
    assert_eq!(registry.despawn(first), Err(EntityRegistryError::StaleGuid(first)));
}

#[test]
fn free_slots_are_reused_in_lowest_index_order() {
    let mut registry = EntityRegistry::new();
    let a = registry.spawn().unwrap();
    let b = registry.spawn().unwrap();
    let c = registry.spawn().unwrap();

    registry.despawn(c).unwrap();
    registry.despawn(a).unwrap();

    assert_eq!(registry.spawn().unwrap(), EntityGuid::new(a.index, 1));
    assert_eq!(registry.spawn().unwrap(), EntityGuid::new(c.index, 1));
    assert!(registry.is_alive(b));
}

#[test]
fn identical_operation_sequences_produce_identical_guids() {
    fn sequence() -> Vec<EntityGuid> {
        let mut registry = EntityRegistry::new();
        let mut created = Vec::new();
        for _ in 0..8 {
            created.push(registry.spawn().unwrap());
        }
        for guid in [created[6], created[2], created[4]] {
            registry.despawn(guid).unwrap();
        }
        created.extend((0..3).map(|_| registry.spawn().unwrap()));
        created
    }

    assert_eq!(sequence(), sequence());
}
```

- [ ] **Step 2: Run RED**

```bash
cargo test --manifest-path engine/prism/Cargo.toml -p prism-core --test entity_registry
```

Expected: FAIL because `prism_core::entity` is not defined.

- [ ] **Step 3: Implement `EntityGuid`**

Create `engine/prism/core/src/entity/guid.rs`:

```rust
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct EntityGuid {
    pub index: u64,
    pub generation: u64,
}

impl EntityGuid {
    #[must_use]
    pub const fn new(index: u64, generation: u64) -> Self {
        Self { index, generation }
    }
}
```

- [ ] **Step 4: Implement deterministic registry semantics**

Create `engine/prism/core/src/entity/registry.rs`:

```rust
use std::cmp::Reverse;
use std::collections::BinaryHeap;

use super::EntityGuid;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EntityRegistryError {
    StaleGuid(EntityGuid),
    GenerationOverflow(u64),
}

#[derive(Debug, Default)]
pub struct EntityRegistry {
    generations: Vec<u64>,
    alive: Vec<bool>,
    free: BinaryHeap<Reverse<u64>>,
    alive_count: usize,
}

impl EntityRegistry {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn spawn(&mut self) -> Result<EntityGuid, EntityRegistryError> {
        if let Some(Reverse(index)) = self.free.pop() {
            let slot = usize::try_from(index).expect("entity index must fit usize");
            let next = self.generations[slot]
                .checked_add(1)
                .ok_or(EntityRegistryError::GenerationOverflow(index));
            let generation = match next {
                Ok(value) => value,
                Err(error) => {
                    self.free.push(Reverse(index));
                    return Err(error);
                }
            };
            self.generations[slot] = generation;
            self.alive[slot] = true;
            self.alive_count += 1;
            return Ok(EntityGuid::new(index, generation));
        }

        let index = u64::try_from(self.generations.len()).expect("entity registry exceeded u64 slots");
        self.generations.push(0);
        self.alive.push(true);
        self.alive_count += 1;
        Ok(EntityGuid::new(index, 0))
    }

    pub fn despawn(&mut self, guid: EntityGuid) -> Result<(), EntityRegistryError> {
        let Ok(slot) = usize::try_from(guid.index) else {
            return Err(EntityRegistryError::StaleGuid(guid));
        };
        let Some(&generation) = self.generations.get(slot) else {
            return Err(EntityRegistryError::StaleGuid(guid));
        };
        if generation != guid.generation || !self.alive[slot] {
            return Err(EntityRegistryError::StaleGuid(guid));
        }

        self.alive[slot] = false;
        self.alive_count -= 1;
        self.free.push(Reverse(guid.index));
        Ok(())
    }

    #[must_use]
    pub fn is_alive(&self, guid: EntityGuid) -> bool {
        let Ok(slot) = usize::try_from(guid.index) else {
            return false;
        };
        self.generations.get(slot).copied() == Some(guid.generation)
            && self.alive.get(slot).copied() == Some(true)
    }

    #[must_use]
    pub const fn alive_count(&self) -> usize {
        self.alive_count
    }

    #[must_use]
    pub fn slot_count(&self) -> usize {
        self.generations.len()
    }
}
```

Create `engine/prism/core/src/entity/mod.rs`:

```rust
mod guid;
mod registry;

pub use guid::EntityGuid;
pub use registry::{EntityRegistry, EntityRegistryError};
```

Modify `engine/prism/core/src/lib.rs`:

```rust
#![forbid(unsafe_code)]

pub mod entity;

pub const PRISM_VERSION: &str = env!("CARGO_PKG_VERSION");
```

- [ ] **Step 5: Run tests and Clippy**

```bash
cargo test --manifest-path engine/prism/Cargo.toml -p prism-core --test entity_registry
cargo clippy --manifest-path engine/prism/Cargo.toml -p prism-core --all-targets --locked -- -D warnings
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add engine/prism/core/src/entity engine/prism/core/src/lib.rs engine/prism/core/tests/entity_registry.rs
git commit -m "feat: add Prism generational entity registry"
```

---

### Task 3: Safe 64-byte aligned memory foundation

**Files:**
- Create: `engine/prism/core/src/memory/mod.rs`
- Create: `engine/prism/core/src/memory/aligned_block.rs`
- Modify: `engine/prism/core/src/lib.rs`
- Test: `engine/prism/core/tests/aligned_block.rs`

**Interfaces:**
- Consumes: Rust owned heap allocation through `Vec`/`Box` only.
- Produces: `AlignedBlock`, `MemoryError`, and `CACHE_LINE_BYTES = 64` as the P0 proof that future hot streams can request cache-line-aligned storage without introducing unsafe code yet.

- [ ] **Step 1: Write failing alignment/bounds tests**

Create `engine/prism/core/tests/aligned_block.rs`:

```rust
use prism_core::memory::{AlignedBlock, MemoryError, CACHE_LINE_BYTES};

#[test]
fn block_is_cache_line_aligned_and_rounds_capacity() {
    let block = AlignedBlock::new(65);
    assert_eq!((block.as_ptr() as usize) % CACHE_LINE_BYTES, 0);
    assert_eq!(block.len_bytes(), 65);
    assert_eq!(block.capacity_bytes(), 128);
}

#[test]
fn block_is_zero_initialized_and_supports_safe_byte_access() {
    let mut block = AlignedBlock::new(96);
    assert_eq!(block.read_byte(5), Ok(0));
    block.write_byte(5, 0xAB).unwrap();
    assert_eq!(block.read_byte(5), Ok(0xAB));
}

#[test]
fn logical_bounds_are_enforced_even_when_capacity_is_padded() {
    let mut block = AlignedBlock::new(65);
    assert_eq!(block.read_byte(65), Err(MemoryError::OutOfBounds { index: 65, len: 65 }));
    assert_eq!(
        block.write_byte(127, 1),
        Err(MemoryError::OutOfBounds { index: 127, len: 65 })
    );
}
```

- [ ] **Step 2: Run RED**

```bash
cargo test --manifest-path engine/prism/Cargo.toml -p prism-core --test aligned_block
```

Expected: FAIL because `prism_core::memory` is not defined.

- [ ] **Step 3: Implement safe aligned storage**

Create `engine/prism/core/src/memory/aligned_block.rs`:

```rust
pub const CACHE_LINE_BYTES: usize = 64;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MemoryError {
    OutOfBounds { index: usize, len: usize },
}

#[derive(Clone)]
#[repr(C, align(64))]
struct CacheLine([u8; CACHE_LINE_BYTES]);

#[derive(Clone)]
pub struct AlignedBlock {
    lines: Box<[CacheLine]>,
    len_bytes: usize,
}

impl AlignedBlock {
    #[must_use]
    pub fn new(len_bytes: usize) -> Self {
        let line_count = len_bytes.div_ceil(CACHE_LINE_BYTES);
        let lines = vec![CacheLine([0; CACHE_LINE_BYTES]); line_count].into_boxed_slice();
        Self { lines, len_bytes }
    }

    #[must_use]
    pub fn as_ptr(&self) -> *const u8 {
        self.lines.as_ptr().cast::<u8>()
    }

    #[must_use]
    pub const fn len_bytes(&self) -> usize {
        self.len_bytes
    }

    #[must_use]
    pub fn capacity_bytes(&self) -> usize {
        self.lines.len() * CACHE_LINE_BYTES
    }

    pub fn read_byte(&self, index: usize) -> Result<u8, MemoryError> {
        self.check_index(index)?;
        Ok(self.lines[index / CACHE_LINE_BYTES].0[index % CACHE_LINE_BYTES])
    }

    pub fn write_byte(&mut self, index: usize, value: u8) -> Result<(), MemoryError> {
        self.check_index(index)?;
        self.lines[index / CACHE_LINE_BYTES].0[index % CACHE_LINE_BYTES] = value;
        Ok(())
    }

    fn check_index(&self, index: usize) -> Result<(), MemoryError> {
        if index < self.len_bytes {
            Ok(())
        } else {
            Err(MemoryError::OutOfBounds {
                index,
                len: self.len_bytes,
            })
        }
    }
}
```

Create `engine/prism/core/src/memory/mod.rs`:

```rust
mod aligned_block;

pub use aligned_block::{AlignedBlock, MemoryError, CACHE_LINE_BYTES};
```

Add to `engine/prism/core/src/lib.rs`:

```rust
pub mod memory;
```

- [ ] **Step 4: Verify GREEN and formatting**

```bash
cargo test --manifest-path engine/prism/Cargo.toml -p prism-core --test aligned_block
cargo fmt --manifest-path engine/prism/Cargo.toml --all -- --check
cargo clippy --manifest-path engine/prism/Cargo.toml -p prism-core --all-targets --locked -- -D warnings
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add engine/prism/core/src/memory engine/prism/core/src/lib.rs engine/prism/core/tests/aligned_block.rs
git commit -m "feat: add Prism aligned memory block"
```

---

### Task 4: Deterministic job-DAG compiler with explicit hazard rejection

**Files:**
- Create: `engine/prism/core/src/jobs/mod.rs`
- Create: `engine/prism/core/src/jobs/graph.rs`
- Modify: `engine/prism/core/src/lib.rs`
- Test: `engine/prism/core/tests/job_graph.rs`

**Interfaces:**
- Consumes: stable numeric `JobId`/`ResourceId`, explicit `after` dependencies, and read/write declarations.
- Produces: `JobGraph::compile() -> Result<CompiledJobGraph, JobGraphError>` with stable topological order and rejection of duplicate IDs, unknown dependencies, cycles, duplicate per-job resource declarations, and unordered read/write or write/write hazards. P0 compiles scheduling metadata only; parallel execution/work stealing belongs to P1.

- [ ] **Step 1: Write failing scheduler-contract tests**

Create `engine/prism/core/tests/job_graph.rs`:

```rust
use prism_core::jobs::{JobGraph, JobGraphError, JobId, JobSpec, ResourceId};

const WORLD: ResourceId = ResourceId::new(1);
const ECONOMY: ResourceId = ResourceId::new(2);

#[test]
fn compile_order_is_independent_of_registration_order() {
    let specs = [
        JobSpec::new(JobId::new(30), 0).read(WORLD).after(JobId::new(10)),
        JobSpec::new(JobId::new(10), 0).write(WORLD),
        JobSpec::new(JobId::new(20), -1).read(ECONOMY),
    ];

    let mut forward = JobGraph::new();
    for spec in specs.clone() {
        forward.add_job(spec).unwrap();
    }

    let mut reverse = JobGraph::new();
    for spec in specs.into_iter().rev() {
        reverse.add_job(spec).unwrap();
    }

    assert_eq!(forward.compile().unwrap().ordered_jobs(), reverse.compile().unwrap().ordered_jobs());
    assert_eq!(
        forward.compile().unwrap().ordered_jobs(),
        &[JobId::new(20), JobId::new(10), JobId::new(30)]
    );
}

#[test]
fn unordered_writer_reader_hazard_is_rejected() {
    let mut graph = JobGraph::new();
    graph.add_job(JobSpec::new(JobId::new(1), 0).write(WORLD)).unwrap();
    graph.add_job(JobSpec::new(JobId::new(2), 0).read(WORLD)).unwrap();

    assert_eq!(
        graph.compile(),
        Err(JobGraphError::UnorderedHazard {
            resource: WORLD,
            left: JobId::new(1),
            right: JobId::new(2),
        })
    );
}

#[test]
fn explicit_dependency_orders_a_shared_resource() {
    let mut graph = JobGraph::new();
    graph.add_job(JobSpec::new(JobId::new(1), 0).write(WORLD)).unwrap();
    graph
        .add_job(JobSpec::new(JobId::new(2), 0).read(WORLD).after(JobId::new(1)))
        .unwrap();

    assert_eq!(
        graph.compile().unwrap().ordered_jobs(),
        &[JobId::new(1), JobId::new(2)]
    );
}

#[test]
fn dependency_cycle_is_rejected() {
    let mut graph = JobGraph::new();
    graph
        .add_job(JobSpec::new(JobId::new(1), 0).after(JobId::new(2)))
        .unwrap();
    graph
        .add_job(JobSpec::new(JobId::new(2), 0).after(JobId::new(1)))
        .unwrap();

    assert!(matches!(graph.compile(), Err(JobGraphError::Cycle(_))));
}
```

- [ ] **Step 2: Run RED**

```bash
cargo test --manifest-path engine/prism/Cargo.toml -p prism-core --test job_graph
```

Expected: FAIL because `prism_core::jobs` is not defined.

- [ ] **Step 3: Implement stable IDs and job declarations**

Create `engine/prism/core/src/jobs/graph.rs` with these public contracts:

```rust
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct JobId(u64);

impl JobId {
    #[must_use]
    pub const fn new(value: u64) -> Self {
        Self(value)
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct ResourceId(u64);

impl ResourceId {
    #[must_use]
    pub const fn new(value: u64) -> Self {
        Self(value)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum AccessKind {
    Read,
    Write,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ResourceAccess {
    resource: ResourceId,
    kind: AccessKind,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct JobSpec {
    id: JobId,
    order: i32,
    accesses: Vec<ResourceAccess>,
    after: Vec<JobId>,
}

impl JobSpec {
    #[must_use]
    pub fn new(id: JobId, order: i32) -> Self {
        Self {
            id,
            order,
            accesses: Vec::new(),
            after: Vec::new(),
        }
    }

    #[must_use]
    pub fn read(mut self, resource: ResourceId) -> Self {
        self.accesses.push(ResourceAccess { resource, kind: AccessKind::Read });
        self
    }

    #[must_use]
    pub fn write(mut self, resource: ResourceId) -> Self {
        self.accesses.push(ResourceAccess { resource, kind: AccessKind::Write });
        self
    }

    #[must_use]
    pub fn after(mut self, predecessor: JobId) -> Self {
        self.after.push(predecessor);
        self
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum JobGraphError {
    DuplicateJob(JobId),
    DuplicateResourceAccess { job: JobId, resource: ResourceId },
    UnknownDependency { job: JobId, dependency: JobId },
    Cycle(Vec<JobId>),
    UnorderedHazard { resource: ResourceId, left: JobId, right: JobId },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CompiledJobGraph {
    ordered: Vec<JobId>,
}

impl CompiledJobGraph {
    #[must_use]
    pub fn ordered_jobs(&self) -> &[JobId] {
        &self.ordered
    }
}

#[derive(Default)]
pub struct JobGraph {
    jobs: BTreeMap<JobId, JobSpec>,
}
```

- [ ] **Step 4: Implement deterministic validation and topological compilation**

Complete `JobGraph` with the following algorithm and exact ordering rules:

```rust
impl JobGraph {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add_job(&mut self, spec: JobSpec) -> Result<(), JobGraphError> {
        if self.jobs.contains_key(&spec.id) {
            return Err(JobGraphError::DuplicateJob(spec.id));
        }

        let mut resources = BTreeSet::new();
        for access in &spec.accesses {
            if !resources.insert(access.resource) {
                return Err(JobGraphError::DuplicateResourceAccess {
                    job: spec.id,
                    resource: access.resource,
                });
            }
        }

        self.jobs.insert(spec.id, spec);
        Ok(())
    }

    pub fn compile(&self) -> Result<CompiledJobGraph, JobGraphError> {
        let mut outgoing = BTreeMap::<JobId, BTreeSet<JobId>>::new();
        let mut indegree = BTreeMap::<JobId, usize>::new();

        for id in self.jobs.keys().copied() {
            outgoing.insert(id, BTreeSet::new());
            indegree.insert(id, 0);
        }

        for spec in self.jobs.values() {
            for dependency in &spec.after {
                if !self.jobs.contains_key(dependency) {
                    return Err(JobGraphError::UnknownDependency {
                        job: spec.id,
                        dependency: *dependency,
                    });
                }
                if outgoing.get_mut(dependency).unwrap().insert(spec.id) {
                    *indegree.get_mut(&spec.id).unwrap() += 1;
                }
            }
        }

        let mut available = BTreeSet::<(i32, JobId)>::new();
        for (id, degree) in &indegree {
            if *degree == 0 {
                available.insert((self.jobs[id].order, *id));
            }
        }

        let mut ordered = Vec::with_capacity(self.jobs.len());
        let mut remaining = indegree.clone();
        while let Some(&(order, id)) = available.first() {
            available.remove(&(order, id));
            ordered.push(id);
            for next in outgoing[&id].iter().copied() {
                let degree = remaining.get_mut(&next).unwrap();
                *degree -= 1;
                if *degree == 0 {
                    available.insert((self.jobs[&next].order, next));
                }
            }
        }

        if ordered.len() != self.jobs.len() {
            let participants = remaining
                .into_iter()
                .filter_map(|(id, degree)| (degree > 0).then_some(id))
                .collect();
            return Err(JobGraphError::Cycle(participants));
        }

        let ids: Vec<_> = self.jobs.keys().copied().collect();
        for (offset, left) in ids.iter().copied().enumerate() {
            for right in ids.iter().copied().skip(offset + 1) {
                if let Some(resource) = conflicting_resource(&self.jobs[&left], &self.jobs[&right]) {
                    if !reaches(left, right, &outgoing) && !reaches(right, left, &outgoing) {
                        return Err(JobGraphError::UnorderedHazard { resource, left, right });
                    }
                }
            }
        }

        Ok(CompiledJobGraph { ordered })
    }
}

fn conflicting_resource(left: &JobSpec, right: &JobSpec) -> Option<ResourceId> {
    for left_access in &left.accesses {
        for right_access in &right.accesses {
            if left_access.resource == right_access.resource
                && (left_access.kind == AccessKind::Write || right_access.kind == AccessKind::Write)
            {
                return Some(left_access.resource);
            }
        }
    }
    None
}

fn reaches(start: JobId, target: JobId, outgoing: &BTreeMap<JobId, BTreeSet<JobId>>) -> bool {
    let mut stack: Vec<_> = outgoing[&start].iter().rev().copied().collect();
    let mut seen = BTreeSet::new();
    while let Some(id) = stack.pop() {
        if id == target {
            return true;
        }
        if !seen.insert(id) {
            continue;
        }
        stack.extend(outgoing[&id].iter().rev().copied());
    }
    false
}
```

Create `engine/prism/core/src/jobs/mod.rs`:

```rust
mod graph;

pub use graph::{CompiledJobGraph, JobGraph, JobGraphError, JobId, JobSpec, ResourceId};
```

Add to `engine/prism/core/src/lib.rs`:

```rust
pub mod jobs;
```

- [ ] **Step 5: Verify scheduler behavior**

```bash
cargo test --manifest-path engine/prism/Cargo.toml -p prism-core --test job_graph
cargo clippy --manifest-path engine/prism/Cargo.toml -p prism-core --all-targets --locked -- -D warnings
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add engine/prism/core/src/jobs engine/prism/core/src/lib.rs engine/prism/core/tests/job_graph.rs
git commit -m "feat: add Prism deterministic job graph"
```

---

### Task 5: Deterministic diagnostics and cross-subsystem bootstrap probe

**Files:**
- Create: `engine/prism/core/src/diagnostics/mod.rs`
- Create: `engine/prism/core/src/bootstrap.rs`
- Modify: `engine/prism/core/src/lib.rs`
- Test: `engine/prism/core/tests/diagnostics.rs`
- Test: `engine/prism/core/tests/bootstrap.rs`

**Interfaces:**
- Consumes: `EntityRegistry`, `AlignedBlock`, and `JobGraph` from Tasks 2–4.
- Produces: monotonic deterministic `DiagnosticBuffer` records and `run_bootstrap_probe() -> Result<BootstrapReport, BootstrapError>`. The report is the stable native-host startup contract.

- [ ] **Step 1: Write failing diagnostic tests**

Create `engine/prism/core/tests/diagnostics.rs`:

```rust
use prism_core::diagnostics::{DiagnosticBuffer, Severity};

#[test]
fn diagnostic_sequence_is_monotonic_and_snapshot_order_is_stable() {
    let mut diagnostics = DiagnosticBuffer::new();
    assert_eq!(diagnostics.push(Severity::Info, "bootstrap", "start").unwrap(), 0);
    assert_eq!(diagnostics.push(Severity::Warn, "memory", "pressure").unwrap(), 1);

    let snapshot = diagnostics.snapshot();
    assert_eq!(snapshot.len(), 2);
    assert_eq!(snapshot[0].sequence, 0);
    assert_eq!(snapshot[0].subsystem, "bootstrap");
    assert_eq!(snapshot[1].sequence, 1);
    assert_eq!(snapshot[1].severity, Severity::Warn);
}
```

Create `engine/prism/core/tests/bootstrap.rs`:

```rust
use prism_core::bootstrap::run_bootstrap_probe;

#[test]
fn bootstrap_probe_exercises_p0_contracts_and_formats_stably() {
    let report = run_bootstrap_probe().expect("bootstrap probe");
    assert_eq!(report.entity_generation, 1);
    assert_eq!(report.alignment_bytes, 64);
    assert_eq!(report.compiled_jobs, 2);
    assert_eq!(
        report.to_string(),
        "PRISM_BOOTSTRAP version=0.1.0 entity_generation=1 alignment=64 compiled_jobs=2"
    );
}
```

- [ ] **Step 2: Run RED**

```bash
cargo test --manifest-path engine/prism/Cargo.toml -p prism-core --test diagnostics --test bootstrap
```

Expected: FAIL because diagnostics/bootstrap modules do not exist.

- [ ] **Step 3: Implement deterministic diagnostics**

Create `engine/prism/core/src/diagnostics/mod.rs`:

```rust
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Severity {
    Debug,
    Info,
    Warn,
    Error,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DiagnosticRecord {
    pub sequence: u64,
    pub severity: Severity,
    pub subsystem: String,
    pub message: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DiagnosticError {
    SequenceOverflow,
}

#[derive(Default)]
pub struct DiagnosticBuffer {
    next_sequence: u64,
    records: Vec<DiagnosticRecord>,
}

impl DiagnosticBuffer {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(
        &mut self,
        severity: Severity,
        subsystem: impl Into<String>,
        message: impl Into<String>,
    ) -> Result<u64, DiagnosticError> {
        let sequence = self.next_sequence;
        self.next_sequence = self
            .next_sequence
            .checked_add(1)
            .ok_or(DiagnosticError::SequenceOverflow)?;
        self.records.push(DiagnosticRecord {
            sequence,
            severity,
            subsystem: subsystem.into(),
            message: message.into(),
        });
        Ok(sequence)
    }

    #[must_use]
    pub fn snapshot(&self) -> &[DiagnosticRecord] {
        &self.records
    }
}
```

- [ ] **Step 4: Implement the bootstrap probe**

Create `engine/prism/core/src/bootstrap.rs`:

```rust
use std::fmt;

use crate::entity::{EntityRegistry, EntityRegistryError};
use crate::jobs::{JobGraph, JobGraphError, JobId, JobSpec, ResourceId};
use crate::memory::{AlignedBlock, CACHE_LINE_BYTES};
use crate::PRISM_VERSION;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BootstrapReport {
    pub entity_generation: u64,
    pub alignment_bytes: usize,
    pub compiled_jobs: usize,
}

impl fmt::Display for BootstrapReport {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "PRISM_BOOTSTRAP version={} entity_generation={} alignment={} compiled_jobs={}",
            PRISM_VERSION, self.entity_generation, self.alignment_bytes, self.compiled_jobs
        )
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BootstrapError {
    Entity(EntityRegistryError),
    Job(JobGraphError),
}

impl From<EntityRegistryError> for BootstrapError {
    fn from(value: EntityRegistryError) -> Self {
        Self::Entity(value)
    }
}

impl From<JobGraphError> for BootstrapError {
    fn from(value: JobGraphError) -> Self {
        Self::Job(value)
    }
}

pub fn run_bootstrap_probe() -> Result<BootstrapReport, BootstrapError> {
    let mut entities = EntityRegistry::new();
    let first = entities.spawn()?;
    entities.despawn(first)?;
    let recycled = entities.spawn()?;

    let memory = AlignedBlock::new(128);
    debug_assert_eq!((memory.as_ptr() as usize) % CACHE_LINE_BYTES, 0);

    let state = ResourceId::new(1);
    let mut jobs = JobGraph::new();
    jobs.add_job(JobSpec::new(JobId::new(1), 0).write(state))?;
    jobs.add_job(JobSpec::new(JobId::new(2), 0).read(state).after(JobId::new(1)))?;
    let compiled = jobs.compile()?;

    Ok(BootstrapReport {
        entity_generation: recycled.generation,
        alignment_bytes: CACHE_LINE_BYTES,
        compiled_jobs: compiled.ordered_jobs().len(),
    })
}
```

Add to `engine/prism/core/src/lib.rs`:

```rust
pub mod bootstrap;
pub mod diagnostics;
```

- [ ] **Step 5: Verify GREEN**

```bash
cargo test --manifest-path engine/prism/Cargo.toml -p prism-core --test diagnostics --test bootstrap
npm run prism:verify
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add engine/prism/core/src/diagnostics engine/prism/core/src/bootstrap.rs engine/prism/core/src/lib.rs engine/prism/core/tests/diagnostics.rs engine/prism/core/tests/bootstrap.rs
git commit -m "feat: add Prism bootstrap diagnostics"
```

---

### Task 6: Native host startup contract and Windows smoke gate

**Files:**
- Modify: `engine/prism/host/src/main.rs`
- Create: `engine/prism/host/tests/bootstrap_smoke.rs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `prism_core::bootstrap::run_bootstrap_probe()`.
- Produces: a native executable that exits nonzero on bootstrap failure and prints one deterministic `PRISM_BOOTSTRAP ...` line on success. This is a native process shell only; no windowing, D3D12, game loop, or gameplay authority enters P0.

- [ ] **Step 1: Write failing native-host smoke test**

Create `engine/prism/host/tests/bootstrap_smoke.rs`:

```rust
#[cfg(windows)]
#[test]
fn native_host_emits_stable_bootstrap_report() {
    use std::process::Command;

    let output = Command::new(env!("CARGO_BIN_EXE_prism-host"))
        .output()
        .expect("run prism-host");

    assert!(output.status.success());
    assert_eq!(
        String::from_utf8(output.stdout).unwrap(),
        "PRISM_BOOTSTRAP version=0.1.0 entity_generation=1 alignment=64 compiled_jobs=2\n"
    );
    assert!(output.stderr.is_empty());
}
```

- [ ] **Step 2: Run RED on Windows**

On a Windows executor:

```powershell
cargo test --manifest-path engine/prism/Cargo.toml -p prism-host --test bootstrap_smoke --locked
```

Expected: FAIL because `prism-host` still prints the temporary Task 1 message.

On non-Windows development machines, compile the test crate but do not treat the skipped Windows-only test as final acceptance.

- [ ] **Step 3: Replace the temporary host body**

Set `engine/prism/host/src/main.rs` to:

```rust
#![forbid(unsafe_code)]

use std::process::ExitCode;

fn main() -> ExitCode {
    match prism_core::bootstrap::run_bootstrap_probe() {
        Ok(report) => {
            println!("{report}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("PRISM_BOOTSTRAP_ERROR {error:?}");
            ExitCode::FAILURE
        }
    }
}
```

- [ ] **Step 4: Strengthen the Windows CI job from build-only to build-and-run**

Replace the P0 Windows build step with:

```yaml
      - name: Verify native Prism host
        shell: pwsh
        run: |
          cargo test --manifest-path engine/prism/Cargo.toml -p prism-host --test bootstrap_smoke --locked
          if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
          $output = cargo run --manifest-path engine/prism/Cargo.toml -p prism-host --release --locked --quiet
          if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
          if ($output -ne "PRISM_BOOTSTRAP version=0.1.0 entity_generation=1 alignment=64 compiled_jobs=2") {
            throw "Unexpected Prism bootstrap output: $output"
          }
```

- [ ] **Step 5: Verify local cross-platform core gate and Windows host gate**

Run everywhere:

```bash
npm run prism:verify
```

Run on Windows:

```powershell
cargo test --manifest-path engine/prism/Cargo.toml -p prism-host --test bootstrap_smoke --locked
cargo run --manifest-path engine/prism/Cargo.toml -p prism-host --release --locked --quiet
```

Expected Windows output exactly:

```text
PRISM_BOOTSTRAP version=0.1.0 entity_generation=1 alignment=64 compiled_jobs=2
```

- [ ] **Step 6: Commit**

```bash
git add engine/prism/host/src/main.rs engine/prism/host/tests/bootstrap_smoke.rs .github/workflows/ci.yml
git commit -m "feat: add Prism native host smoke"
```

---

### Task 7: P0 determinism, bounded-reuse, and scale invariants

**Files:**
- Create: `engine/prism/core/tests/p0_invariants.rs`
- Modify: `scripts/prism-verify.mjs`
- Modify: `tests/prism_build_policy.test.ts`

**Interfaces:**
- Consumes: final P0 entity registry, aligned storage, and job graph.
- Produces: a release-mode stress gate proving deterministic steady-state entity recycling, bounded registry slot growth, stable scheduler ordering under reversed registration, and 1 MiB aligned-block integrity. This is the P0 performance gate; it measures structural boundedness rather than fragile wall-clock timing.

- [ ] **Step 1: Add the failing release-invariant test**

Create `engine/prism/core/tests/p0_invariants.rs`:

```rust
use prism_core::entity::{EntityGuid, EntityRegistry};
use prism_core::jobs::{JobGraph, JobId, JobSpec, ResourceId};
use prism_core::memory::{AlignedBlock, CACHE_LINE_BYTES};

#[test]
fn registry_recycles_one_hundred_thousand_slots_without_growth() {
    const COUNT: usize = 100_000;
    let mut registry = EntityRegistry::new();
    let first_generation: Vec<_> = (0..COUNT).map(|_| registry.spawn().unwrap()).collect();
    assert_eq!(registry.slot_count(), COUNT);

    for guid in first_generation.iter().rev().copied() {
        registry.despawn(guid).unwrap();
    }

    let second_generation: Vec<_> = (0..COUNT).map(|_| registry.spawn().unwrap()).collect();
    assert_eq!(registry.slot_count(), COUNT);
    assert_eq!(registry.alive_count(), COUNT);
    assert_eq!(second_generation[0], EntityGuid::new(0, 1));
    assert_eq!(second_generation[COUNT - 1], EntityGuid::new((COUNT - 1) as u64, 1));
}

#[test]
fn four_hundred_job_chain_compiles_identically_in_reverse_registration_order() {
    const JOBS: u64 = 400;
    let resource = ResourceId::new(9);

    fn build(reverse: bool, resource: ResourceId) -> Vec<JobId> {
        let mut specs = Vec::new();
        for index in 0..JOBS {
            let mut spec = if index % 2 == 0 {
                JobSpec::new(JobId::new(index), (index % 7) as i32).write(resource)
            } else {
                JobSpec::new(JobId::new(index), (index % 7) as i32).read(resource)
            };
            if index > 0 {
                spec = spec.after(JobId::new(index - 1));
            }
            specs.push(spec);
        }
        if reverse {
            specs.reverse();
        }

        let mut graph = JobGraph::new();
        for spec in specs {
            graph.add_job(spec).unwrap();
        }
        graph.compile().unwrap().ordered_jobs().to_vec()
    }

    assert_eq!(build(false, resource), build(true, resource));
}

#[test]
fn one_mebibyte_aligned_block_preserves_logical_bounds_and_data() {
    let mut block = AlignedBlock::new(1024 * 1024);
    assert_eq!((block.as_ptr() as usize) % CACHE_LINE_BYTES, 0);
    assert_eq!(block.capacity_bytes(), 1024 * 1024);

    for index in (0..block.len_bytes()).step_by(4096) {
        block.write_byte(index, (index / 4096) as u8).unwrap();
    }
    for index in (0..block.len_bytes()).step_by(4096) {
        assert_eq!(block.read_byte(index).unwrap(), (index / 4096) as u8);
    }
}
```

- [ ] **Step 2: Run the new stress test in release mode**

```bash
cargo test --manifest-path engine/prism/Cargo.toml -p prism-core --release --test p0_invariants --locked
```

Expected: PASS once Tasks 2–4 are complete. If it fails, fix the underlying boundedness/determinism defect rather than weakening the counts.

- [ ] **Step 3: Add release invariants to the canonical Prism verification command list**

Update `prismVerificationCommands` in `scripts/prism-verify.mjs` so it becomes exactly:

```js
export const prismVerificationCommands = Object.freeze([
  Object.freeze(["fmt", "--all", "--", "--check"]),
  Object.freeze([
    "clippy",
    "--workspace",
    "--all-targets",
    "--locked",
    "--",
    "-D",
    "warnings",
  ]),
  Object.freeze(["test", "--workspace", "--locked"]),
  Object.freeze([
    "test",
    "-p",
    "prism-core",
    "--release",
    "--test",
    "p0_invariants",
    "--locked",
  ]),
  Object.freeze(["check", "--workspace", "--all-targets", "--locked"]),
]);
```

Update `tests/prism_build_policy.test.ts` to expect the same five commands.

- [ ] **Step 4: Run complete Prism gate twice**

```bash
npm run prism:verify
npm run prism:verify
```

Expected: both runs PASS with identical test behavior.

- [ ] **Step 5: Commit**

```bash
git add engine/prism/core/tests/p0_invariants.rs scripts/prism-verify.mjs tests/prism_build_policy.test.ts
git commit -m "test: add Prism P0 invariant stress gate"
```

---

### Task 8: Record the native-runtime decision and update engineering documentation

**Files:**
- Create: `docs/adr/0003-native-prism-bootstrap.md`
- Modify: `docs/adr/0002-desktop-gpu-runtime.md`
- Modify: `docs/ENGINEERING_STANDARDS.md`
- Modify: `docs/TESTING.md`
- Modify: `README.md`
- Modify: `CONTRIBUTING.md`

**Interfaces:**
- Consumes: verified P0 build/test commands and the approved Prism design.
- Produces: unambiguous repository guidance that Electron/PixiJS is transitional, Prism is native Windows/Rust, P0 does not yet own gameplay state, and contributors must run both legacy and Prism verification while the migration is dual-stack.

- [ ] **Step 1: Create ADR 0003 with the exact decision boundary**

Create `docs/adr/0003-native-prism-bootstrap.md`:

```markdown
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
```

At the top of `docs/adr/0002-desktop-gpu-runtime.md`, change metadata to:

```markdown
- Status: Superseded as destination architecture; retained as accepted transitional tranche
- Date: 2026-08-27
- Superseded by: ADR 0003
```

Do not rewrite ADR 0002's original decision body.

- [ ] **Step 2: Add Rust/Prism rules to engineering standards**

Add a `## Native Prism / Rust` section to `docs/ENGINEERING_STANDARDS.md` containing these exact requirements:

```markdown
## Native Prism / Rust

Prism production code lives under `engine/prism/`. P0 pins Rust 1.98.0, Rust 2024 edition, Cargo resolver 3, and a committed `engine/prism/Cargo.lock`.

P0 Rust uses the standard library only and forbids unsafe code. New Rust dependencies or any relaxation of the unsafe-code rule require explicit architecture review with ownership, performance, licensing, and determinism rationale.

Use deterministic ordered collections when iteration order can affect authoritative output. Thread completion order, wall-clock time, hash-table iteration, locale, and filesystem enumeration must not become authoritative ordering inputs.

`npm run prism:verify` is the native Prism gate. During progressive migration, `npm run verify:all` is the combined local gate and runs the existing TypeScript verification followed by Prism verification. Windows-native host behavior additionally requires the `prism-windows` CI job.
```

Update the existing Verification section so it explicitly says `npm run verify` remains the legacy authoritative runtime gate while `npm run verify:all` is the full transitional repository gate from P0 onward.

- [ ] **Step 3: Document native testing and contributor commands**

Add to `docs/TESTING.md`:

```markdown
## Prism P0 native gate

Prism P0 adds a separate native test stack without removing inherited TypeScript/browser regression coverage.

Required native command:

```bash
npm run prism:verify
```

It runs Rust formatting, Clippy with warnings denied, workspace tests, release-mode P0 invariant stress tests, and workspace checking from the committed Cargo lockfile.

The Windows-only `prism-windows` CI job must additionally execute `prism-host` and require the exact deterministic bootstrap line. A P0 change is not native-green until that Windows job passes.
```

Update `CONTRIBUTING.md` setup to require Node.js 22, Python 3 for inherited smoke tooling, and Rust 1.98.0 from the committed `rust-toolchain.toml`. Replace the single pre-review command block with:

```bash
npm run verify:all
```

and state that Windows host changes additionally require the Windows CI smoke.

- [ ] **Step 4: Correct README runtime wording**

Update the README introduction/runtime sections so they distinguish:

```text
Current authoritative compatibility runtime:
Electron → TypeScript SimulationCore → PixiJS/WebGL

Destination runtime under active migration:
CivicFoundry.exe → Prism Engine (Rust) → native game domains → D3D12
```

In the Toolchain section add:

```text
- Rust 1.98.0 / Rust 2024 for Prism Engine P0;
- Cargo resolver 3 with committed engine/prism/Cargo.lock;
- no third-party Rust crates in P0.
```

In Commands add:

```bash
npm run prism:verify
npm run verify:all
cargo run --manifest-path engine/prism/Cargo.toml -p prism-host --release --locked
```

Clearly state that `npm run desktop` launches the transitional Electron runtime and is not the final Prism production host.

- [ ] **Step 5: Format and verify documentation surfaces**

Run:

```bash
npm run format
npm run format:check
npm run verify:all
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add docs/adr/0002-desktop-gpu-runtime.md docs/adr/0003-native-prism-bootstrap.md docs/ENGINEERING_STANDARDS.md docs/TESTING.md README.md CONTRIBUTING.md
git commit -m "docs: record native Prism bootstrap boundary"
```

---

### Task 9: Final P0 verification, development-log checkpoint, and review gate

**Files:**
- Modify after all gates are green: `docs/DEVELOPMENT_LOG.md`

**Interfaces:**
- Consumes: Tasks 1–8 at one exact branch head.
- Produces: verified P0 completion evidence and a clean handoff boundary before P1. P1 must not start from a partially green P0 head.

- [ ] **Step 1: Run full legacy + Prism repository verification**

Run:

```bash
npm run verify:all
```

Expected: PASS.

- [ ] **Step 2: Run all inherited functional/visual smoke gates unchanged**

Run the same smoke stack currently required by CI:

```bash
npm run test:smoke
npm run test:smoke:phase7
npm run test:smoke:urban-fabric
npm run test:smoke:isometric
python tests/smoke/isometric_visual_smoke.py
```

Expected: PASS. P0 has no permission to weaken or remove these transitional regressions.

- [ ] **Step 3: Require Windows-native exact-head success**

The exact implementation head must pass the `prism-windows` CI job, including:

```text
PRISM_BOOTSTRAP version=0.1.0 entity_generation=1 alignment=64 compiled_jobs=2
```

If the executor is not Windows, do not infer success from Linux compilation. Use the Windows GitHub Actions result as the native-host acceptance evidence.

- [ ] **Step 4: Inspect scope against the approved P0 boundary**

Confirm the branch contains none of the following:

```text
Save V10 schema
Chrono-Lattice persistence
D3D12 renderer or compute backend
native cadastral/world import
TypeScript gameplay authority removal
worker-pool/work-stealing execution
archetype component storage
third-party Rust dependencies
```

Any of those changes belongs to a separately reviewed phase/tranche and must be removed from P0 before completion.

- [ ] **Step 5: Append the durable P0 development-log entry**

Append to `docs/DEVELOPMENT_LOG.md`:

```markdown
## 2026-08-27 — Prism Engine P0 Native Bootstrap

Established the first native Prism Engine foundation without transferring Civic Foundry gameplay authority. P0 introduced the pinned Rust 1.98.0 workspace, 128-bit generational entity registry, safe 64-byte aligned memory primitive, deterministic read/write-aware job-DAG compiler, deterministic diagnostics/bootstrap probe, native `prism-host` executable shell, release-mode invariant stress coverage, and dedicated Windows CI smoke.

The existing TypeScript `SimulationCore`, `WorldFoundation`, `CadastralGraph`, Save V9, Electron/PixiJS compatibility runtime, and inherited browser/visual regression stack remain authoritative and unchanged in ownership. Prism P0 contains no Save V10, Chrono-Lattice, D3D12 rendering, gameplay migration, or dual authority.
```

Run:

```bash
npm run format:check
npm run verify:all
```

Expected: PASS.

- [ ] **Step 6: Commit the verified checkpoint**

```bash
git add docs/DEVELOPMENT_LOG.md
git commit -m "docs: record Prism P0 verification"
```

- [ ] **Step 7: Review final diff against the P0 base**

Run:

```bash
git diff --stat main...HEAD
git diff --check main...HEAD
```

Review every changed path against this plan. Expected implementation surface is limited to the Rust workspace, verification/CI wiring, P0 tests, and documentation listed above.

---

## P0 Completion Gate

P0 is complete only when all of the following are true on the same exact head:

- [ ] Rust 1.98.0 is pinned by `rust-toolchain.toml`.
- [ ] `engine/prism/Cargo.lock` is committed and `cargo ... --locked` succeeds.
- [ ] `npm run prism:verify` passes twice consecutively.
- [ ] 128-bit generational IDs reject stale handles and deterministically reuse the lowest free slot.
- [ ] 64-byte aligned bootstrap storage passes alignment, bounds, and 1 MiB integrity tests with no unsafe Rust.
- [ ] job-graph compilation is registration-order independent and rejects unordered hazards/cycles/unknown dependencies.
- [ ] deterministic diagnostics/bootstrap report tests pass.
- [ ] Windows `prism-host` runs and emits the exact expected startup line.
- [ ] the 100,000-slot recycle stress test demonstrates bounded slot growth.
- [ ] the 400-job reverse-registration stress test produces identical compiled order.
- [ ] `npm run verify` and every inherited Chromium/visual smoke still pass.
- [ ] Save V9 schema/authority is unchanged.
- [ ] no TypeScript gameplay authority has moved into Prism.
- [ ] no third-party Rust dependency has entered P0.
- [ ] ADR 0003 and repository docs describe Electron/PixiJS as transitional and native Prism as the destination.
- [ ] exact-head Ubuntu and Windows CI are green.

## Explicit P1 Boundary

P0 stops after proving the native foundation. The next plan, P1, may build the real archetype ECS and parallel deterministic scheduler/worker pool on these interfaces. P1 must begin from a green P0 checkpoint and requires its own implementation plan and review gate before code changes.