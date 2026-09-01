#ifndef CIVIC_ENGINE_H
#define CIVIC_ENGINE_H

#include <stddef.h>
#include <stdint.h>

#if defined(_WIN32) && !defined(CIVIC_ENGINE_STATIC)
  #ifdef CIVIC_ENGINE_EXPORTS
    #define CF_API __declspec(dllexport)
  #else
    #define CF_API __declspec(dllimport)
  #endif
#elif defined(__GNUC__) && !defined(CIVIC_ENGINE_STATIC)
  #define CF_API __attribute__((visibility("default")))
#else
  #define CF_API
#endif

#ifdef __cplusplus
extern "C" {
#endif

typedef struct cf_engine cf_engine;

typedef enum cf_error_code {
    CF_ERROR_NONE = 0,
    CF_ERROR_INVALID_ARGUMENT = 1,
    CF_ERROR_INVALID_STATE = 2,
    CF_ERROR_SERIALIZATION_FAILURE = 3,
    CF_ERROR_INVARIANT_FAILURE = 4,
    CF_ERROR_UNSUPPORTED_SAVE_VERSION = 5,
    CF_ERROR_INTERNAL = 6
} cf_error_code;

typedef struct cf_engine_config { uint32_t seed; uint64_t start_tick; uint32_t speed; } cf_engine_config;
typedef struct cf_buffer { uint8_t* data; size_t size; } cf_buffer;
typedef struct cf_error { cf_error_code code; cf_buffer message; } cf_error;
typedef struct cf_domain_hash { uint32_t ownership; uint32_t version; uint64_t value; } cf_domain_hash;

CF_API cf_error_code cf_engine_create(const cf_engine_config* config, cf_engine** out_engine);
CF_API void cf_engine_destroy(cf_engine* engine);
CF_API cf_error_code cf_engine_submit_commands(cf_engine* engine, const uint8_t* data, size_t size);
CF_API cf_error_code cf_engine_step(cf_engine* engine, uint64_t ticks);
CF_API cf_error_code cf_engine_load_v9(cf_engine* engine, const uint8_t* data, size_t size);
CF_API cf_error_code cf_engine_save_v9(cf_engine* engine, cf_buffer* out_buffer);
CF_API cf_error_code cf_engine_get_snapshot(cf_engine* engine, cf_buffer* out_buffer);
CF_API cf_error_code cf_engine_get_events(cf_engine* engine, cf_buffer* out_buffer);
CF_API cf_error_code cf_engine_get_domain_hash(cf_engine* engine, const char* domain, cf_domain_hash* out_hash);
CF_API cf_error_code cf_engine_get_last_error(cf_engine* engine, cf_error* out_error);
CF_API void cf_buffer_free(cf_buffer buffer);

#ifdef __cplusplus
}
#endif
#endif
