# C++ WASM Reference Path

## Status

**Implemented as a deterministic reference/smoke path.**

The Stack 4 C++ migration builds the native deterministic engine core with Emscripten and executes the same `runReferenceFixture()` contract used by the native test suite. CI pins the Emscripten SDK, builds `civic_wasm.cjs`, and executes it under Node.

This path exists to prove that the portable C++ engine substrate can compile and preserve its deterministic command/step/hash/snapshot contract under WebAssembly. It is not the shipping presentation runtime.

## Shared authoritative fixture

Both native and WASM validation use `civic::bridge::runReferenceFixture()` from `cpp/engine/include/civic/bridge/ReferenceFixture.hpp`.

The fixture:

1. creates two engines from the same seed/configuration;
2. submits the same versioned command envelope to both engines;
3. advances both by the same tick count;
4. compares the authoritative `kernel` domain hash;
5. compares serialized snapshots byte-for-byte.

A mismatch or rejected command returns a non-zero stage code and fails CI.

## Current capability differences

| Capability | Windows native client | C++ WASM reference path |
| --- | --- | --- |
| Deterministic engine core | Yes | Yes |
| Shared command-envelope fixture | Yes | Yes |
| Domain hash / snapshot parity check | Yes | Yes |
| D3D12 renderer | Yes | No |
| Win32 window/input | Yes | No |
| ImGui native UI | Yes | No |
| XAudio2 output | Yes | No |
| Native Windows save-file UX | Yes | No |
| CPack Windows distribution | Yes | No |
| Browser presentation shell | No; native shipping target | No; this target is engine-only |
| Production authority cutover | Gated by domain ownership | Not a cutover surface |

## Boundary rules

- WebAssembly does not own a second simulation implementation. It compiles the same portable C++ engine code.
- WASM-specific code must remain a thin entrypoint around portable engine contracts.
- Presentation/UI/browser APIs must not become authoritative state.
- The WASM path must not weaken command validation or determinism to make a fixture pass.
- The shipping Windows package must not require Node, Electron, Pixi, a browser runtime, or a CDN.

## CI gate

`.github/workflows/cpp-native-presentation.yml` owns the `wasm-reference` job. The gate pins Emscripten, configures the Emscripten toolchain through vcpkg, builds `civic_wasm.cjs`, and executes the shared deterministic fixture.

This reference path should remain available as long as it provides useful cross-toolchain determinism coverage. It does not by itself prove that all gameplay domains have transferred native authority.
