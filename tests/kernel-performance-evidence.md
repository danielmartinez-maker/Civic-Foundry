# Phase 0A Performance Investigation Evidence

This file records diagnostic evidence for the Phase 0A performance acceptance gate. It is not a gameplay contract.

## Initial hosted-CI comparison

The existing `tests/phase6-headless.test.ts` 5,000-tick economy diagnostic was used because it predates kernel integration.

Pre-kernel samples (ms): 1903.3, 1929.4, 2594.6, 2824.1. Median: 2262.0 ms.

Post-kernel samples (ms): 2358.4, 2538.6, 2625.5, 2981.8. Median: 2582.05 ms.

Observed median delta: +14.1%. Because `npm test` runs test files concurrently on GitHub-hosted runners, this triggered investigation rather than immediate acceptance or optimization.

## Kernel hot-path profile

A 100,000-iteration isolated diagnostic on Node 22 reported:

- raw clock: 0.35 ms
- empty kernel: 67.06 ms
- one every-tick no-op system: 112.29 ms
- empty command drain: 10.15 ms
- scheduler `dueSystems`: 68.34 ms
- invariant runner: 23.62 ms

The measured whole one-system kernel cost extrapolates to roughly 5.61 ms over 5,000 ticks, far below the ~320 ms initial median gap. This evidence indicates the initial full-suite timing comparison is dominated by hosted-runner/test-concurrency variance rather than Phase 0A orchestration work.

A controlled isolated pre/post benchmark is required before final acceptance. Do not optimize kernel semantics based solely on the noisy full-suite samples.
