# Native Engine — Stack 0

## Status

**Transitional / shadow.** TypeScript remains authoritative for all gameplay domains. The native engine owns only deterministic migration infrastructure and a normalized copy of Save V9 when explicitly loaded.

## Toolchain

- C++23
- CMake 3.30+
- vcpkg manifest mode
- MSVC `/W4 /permissive- /EHsc /fp:strict`
- Clang/GCC `-Wall -Wextra -Wpedantic -Wconversion -Wshadow -fno-fast-math`
- GoogleTest + CTest
- Node-API binding for desktop/Node integration

Fast-math is explicitly disabled for native simulation targets.

## Configure and test

From the repository root with `VCPKG_ROOT` set:

```bash
cmake -S cpp -B cpp/build -DCMAKE_TOOLCHAIN_FILE="$VCPKG_ROOT/scripts/buildsystems/vcpkg.cmake" -DCIVIC_BUILD_TESTS=ON -DCIVIC_BUILD_NAPI=ON
cmake --build cpp/build --config Debug
ctest --test-dir cpp/build -C Debug --output-on-failure
```

Sanitizer-capable builds can add `-DCIVIC_ENABLE_SANITIZERS=ON`.

## Boundary

The stable C ABI uses opaque `cf_engine*` handles and caller-owned copies. Every returned `cf_buffer` must be released with `cf_buffer_free`. No STL type, native object pointer, or pointer into internal storage crosses the ABI.

The Node-API module mirrors only batch operations: create/destroy, command batch submission, step, Save V9 load/save, snapshots, events, and domain hashes.

## Command protocol

The native command wire protocol is explicitly versioned. Stack 0 accepts only command envelope version `1`, represented as `{ version, sequence, tick, type, payload }`. Missing or unsupported versions and missing payloads are rejected at the C ABI JSON boundary before a command enters the native engine. The native command queue independently rejects unsupported envelope versions so future native callers cannot bypass the protocol contract.

TypeScript gameplay commands remain the semantic `{ sequence, tick, type, payload }` shape. `NativeEngineBridge` adds `version: 1` only when serializing the native transport copy, while `ShadowSimulationRunner` feeds the unversioned normalized semantic command to the authoritative TypeScript reference runtime. Sequence/tick values must be non-negative safe integers. Payloads are normalized to lossless JSON values before either runtime receives them: non-finite numbers, unsupported JavaScript values, accessors, sparse arrays, cycles, and invalid Unicode surrogate sequences are rejected, while negative zero is normalized to JSON `0`. Protocol metadata is intentionally excluded from the semantic kernel snapshot and domain hash so a transport-version field cannot change gameplay-state identity.

The executable JSON contracts are recorded in:

- `schemas/commands/command-envelope.schema.json`
- `schemas/events/domain-event.schema.json`
- `schemas/snapshots/kernel.schema.json`
- `schemas/snapshots/domain-hash.schema.json`
- `schemas/persistence/save-v9-native-boundary.schema.json`

## Shadow activation

Native shadow execution is opt-in. `createShadowSimulationSessionIfEnabled` constructs the native bridge only when `__CIVIC_NATIVE_SHADOW__` resolves to an enabled value (`true`, `"1"`, `"true"`, or `"on"`). Default-like or absent values leave the production TypeScript runtime unchanged.

## Persistence

Native Save V9 parsing validates the current envelope, rejects non-finite numeric state and duplicate local IDs, validates the V9 Urban Fabric reference surface, and preserves the full compatibility envelope. It never serializes native object layouts, caches, or pointers and does not advance `saveVersion`.

## Domain hashes

Hash protocol version `1` sorts JSON object keys, preserves array order, and canonicalizes semantic state before FNV-1a-64 hashing. Equivalent command payload objects therefore hash identically regardless of input property order. Stack 0 owns only `kernel`. `world`, `cadastre`, `buildings`, `transportation`, `population`, `economy`, and `services` explicitly report `unowned` until later stacks transfer authority.
