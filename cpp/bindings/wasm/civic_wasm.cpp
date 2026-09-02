#include <civic/bridge/ReferenceFixture.hpp>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define CIVIC_WASM_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define CIVIC_WASM_EXPORT
#endif

extern "C" CIVIC_WASM_EXPORT int civic_wasm_reference_fixture() {
    return civic::bridge::runReferenceFixture();
}

int main() {
    return civic_wasm_reference_fixture();
}
