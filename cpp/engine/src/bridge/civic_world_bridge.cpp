#include <civic/bridge/civic_engine.h>

#include <civic/core/NativeEngine.hpp>

#include <cstdlib>
#include <cstring>
#include <memory>
#include <string_view>
#include <utility>

struct cf_engine {
    std::unique_ptr<civic::NativeEngine> value;
    civic::Error last_error{};
};

namespace {
cf_error_code map(civic::ErrorCode code) noexcept {
    return static_cast<cf_error_code>(static_cast<std::uint32_t>(code));
}

cf_error_code fail(cf_engine* engine, civic::Error error) {
    if (engine) engine->last_error = std::move(error);
    return map(engine ? engine->last_error.code : civic::ErrorCode::internal_error);
}

cf_error_code copy_buffer(std::string_view source, cf_buffer* output) {
    if (!output) return CF_ERROR_INVALID_ARGUMENT;
    output->data = nullptr;
    output->size = 0;
    if (source.empty()) return CF_ERROR_NONE;
    auto* memory = static_cast<std::uint8_t*>(std::malloc(source.size()));
    if (!memory) return CF_ERROR_INTERNAL;
    std::memcpy(memory, source.data(), source.size());
    output->data = memory;
    output->size = source.size();
    return CF_ERROR_NONE;
}

template<class Operation>
cf_error_code json_operation(
    cf_engine* engine,
    const std::uint8_t* data,
    std::size_t size,
    cf_buffer* output,
    Operation&& operation) noexcept {
    if (!engine || !engine->value || !output) return CF_ERROR_INVALID_ARGUMENT;
    output->data = nullptr;
    output->size = 0;
    if (!data) {
        if (size != 0U) {
            return fail(engine, civic::make_error(
                civic::ErrorCode::invalid_argument,
                "native world JSON buffer is null"));
        }
        return fail(engine, civic::make_error(
            civic::ErrorCode::serialization_failure,
            "native world JSON buffer is empty"));
    }

    try {
        engine->last_error = {};
        const std::string_view input{reinterpret_cast<const char*>(data), size};
        auto result = operation(input);
        if (!result) return fail(engine, result.error());
        const auto copied = copy_buffer(result->json, output);
        if (copied != CF_ERROR_NONE) {
            return fail(engine, civic::make_error(
                civic::ErrorCode::internal_error,
                "failed to allocate native world response buffer"));
        }
        return CF_ERROR_NONE;
    } catch (const std::exception& error) {
        return fail(engine, civic::make_error(civic::ErrorCode::internal_error, error.what()));
    } catch (...) {
        return fail(engine, civic::make_error(
            civic::ErrorCode::internal_error,
            "unknown native world bridge exception"));
    }
}
} // namespace

extern "C" {
cf_error_code cf_engine_create_world(
    cf_engine* engine,
    const uint8_t* data,
    size_t size,
    cf_buffer* out_buffer) {
    return json_operation(engine, data, size, out_buffer, [&](std::string_view input) {
        return engine->value->createWorld(input);
    });
}

cf_error_code cf_engine_restore_world(
    cf_engine* engine,
    const uint8_t* data,
    size_t size,
    cf_buffer* out_buffer) {
    return json_operation(engine, data, size, out_buffer, [&](std::string_view input) {
        return engine->value->restoreWorld(input);
    });
}

cf_error_code cf_engine_create_legacy_world(
    cf_engine* engine,
    const uint8_t* data,
    size_t size,
    cf_buffer* out_buffer) {
    return json_operation(engine, data, size, out_buffer, [&](std::string_view input) {
        return engine->value->createLegacyWorld(input);
    });
}

cf_error_code cf_engine_run_design_storm(
    cf_engine* engine,
    const uint8_t* data,
    size_t size,
    cf_buffer* out_buffer) {
    return json_operation(engine, data, size, out_buffer, [&](std::string_view input) {
        return engine->value->runDesignStorm(input);
    });
}
}
