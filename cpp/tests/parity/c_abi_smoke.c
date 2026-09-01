#include <civic/bridge/civic_engine.h>
#include <assert.h>

int main(void) {
    cf_engine* engine = 0;
    const cf_engine_config config = {9u, 0u, 1u};
    assert(cf_engine_create(&config, &engine) == CF_ERROR_NONE);
    assert(engine != 0);
    assert(cf_engine_step(engine, 0u) == CF_ERROR_NONE);
    assert(cf_engine_step(engine, 1u) == CF_ERROR_NONE);
    cf_buffer snapshot = {0};
    assert(cf_engine_get_snapshot(engine, &snapshot) == CF_ERROR_NONE);
    assert(snapshot.size > 0u);
    cf_buffer_free(snapshot);
    cf_engine_destroy(engine);
    return 0;
}
