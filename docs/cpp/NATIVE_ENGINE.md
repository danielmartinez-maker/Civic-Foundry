# Native Engine — Stack 0

## Status

**Transitional / shadow.** TypeScript remains authoritative for all gameplay domains. The native engine owns only deterministic migration infrastructure and a normalized copy of Save V9 when explicitly loaded.

## Toolchain

- C++23
- CMake 3.30+
- vcpkg manifest mode
- MSVC `/W4 /permissive- /EHsc`
- Clang/GCC `-Wall -Wextra -Wpedantic -Wconversion -Wshadow`
- GoogleTest + CTest
- Node-API binding for desktop/Node integration

Authoritative simulation builds must not enable fast-math.

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

## Persistence

Native Save V9 parsing validates the current envelope, rejects non-finite numeric state and duplicate local IDs, validates the V9 Urban Fabric reference surface, and preserves the full compatibility envelope. It never serializes native object layouts, caches, or pointers and does not advance `saveVersion`.

## Domain hashes

Hash protocol version `1` sorts JSON object keys, preserves array order, and canonicalizes semantic state before FNV-1a-64 hashing. Equivalent command payload objects therefore hash identically regardless of input property order. Stack 0 owns only `kernel`. `world`, `cadastre`, `buildings`, `transportation`, `population`, `economy`, and `services` explicitly report `unowned` until later stacks transfer authority.
