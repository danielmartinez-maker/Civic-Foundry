#include <civic/bridge/civic_engine.h>
int main() { cf_engine* engine = nullptr; const cf_engine_config config{1, 0, 1}; return cf_engine_create(&config, &engine) == CF_ERROR_NONE ? (cf_engine_destroy(engine), 0) : 1; }
