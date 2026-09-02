#include <node_api.h>

#include <civic/bridge/civic_engine.h>

#include <cmath>
#include <cstdint>
#include <limits>
#include <memory>
#include <string>

namespace {
struct Holder final { cf_engine* engine{}; };

napi_value undefined(napi_env env) {
    napi_value value{};
    napi_get_undefined(env, &value);
    return value;
}

void throwNative(napi_env env, Holder* holder, cf_error_code fallback) {
    cf_error native{fallback, {nullptr, 0}};
    if (holder && holder->engine) (void)cf_engine_get_last_error(holder->engine, &native);
    const std::string text = native.message.data
        ? std::string(reinterpret_cast<const char*>(native.message.data), native.message.size)
        : std::string("native engine error");
    cf_buffer_free(native.message);
    const auto code = native.code;
    napi_value msg{}, error{}, codeValue{};
    napi_create_string_utf8(env, text.c_str(), text.size(), &msg);
    napi_create_error(env, nullptr, msg, &error);
    napi_create_uint32(env, static_cast<std::uint32_t>(code), &codeValue);
    napi_set_named_property(env, error, "code", codeValue);
    napi_throw(env, error);
}

Holder* holderFrom(napi_env env, napi_value value) {
    void* pointer = nullptr;
    if (napi_get_value_external(env, value, &pointer) != napi_ok || !pointer) {
        napi_throw_type_error(env, nullptr, "native engine handle required");
        return nullptr;
    }
    auto* holder = static_cast<Holder*>(pointer);
    if (!holder->engine) {
        napi_throw_error(env, nullptr, "native engine handle is destroyed");
        return nullptr;
    }
    return holder;
}

void finalizeHolder(napi_env, void* data, void*) {
    auto* holder = static_cast<Holder*>(data);
    if (!holder) return;
    if (holder->engine) cf_engine_destroy(holder->engine);
    delete holder;
}

std::string stringArgument(napi_env env, napi_value value) {
    size_t length = 0;
    if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok) return {};
    std::string text(length, '\0');
    size_t written = 0;
    napi_get_value_string_utf8(env, value, text.data(), text.size() + 1, &written);
    text.resize(written);
    return text;
}

napi_value bufferToString(napi_env env, cf_buffer buffer) {
    napi_value result{};
    napi_create_string_utf8(
        env,
        reinterpret_cast<const char*>(buffer.data),
        buffer.size,
        &result);
    cf_buffer_free(buffer);
    return result;
}

napi_value createEngine(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1]{};
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    cf_engine_config config{1, 0, 1};
    if (argc == 1) {
        napi_valuetype type{};
        napi_typeof(env, argv[0], &type);
        if (type == napi_object) {
            napi_value property{};
            bool has = false;
            napi_has_named_property(env, argv[0], "seed", &has);
            if (has) {
                double value = 0;
                napi_get_named_property(env, argv[0], "seed", &property);
                if (napi_get_value_double(env, property, &value) != napi_ok ||
                    !std::isfinite(value) || std::floor(value) != value || value < 0 ||
                    value > static_cast<double>(std::numeric_limits<std::uint32_t>::max())) {
                    napi_throw_type_error(env, nullptr, "seed must be uint32");
                    return undefined(env);
                }
                config.seed = static_cast<std::uint32_t>(value);
            }
            napi_has_named_property(env, argv[0], "startTick", &has);
            if (has) {
                double value = 0;
                napi_get_named_property(env, argv[0], "startTick", &property);
                if (napi_get_value_double(env, property, &value) != napi_ok ||
                    !std::isfinite(value) || std::floor(value) != value || value < 0 ||
                    value > 9007199254740991.0) {
                    napi_throw_type_error(env, nullptr, "startTick must be a non-negative safe integer");
                    return undefined(env);
                }
                config.start_tick = static_cast<std::uint64_t>(value);
            }
            napi_has_named_property(env, argv[0], "speed", &has);
            if (has) {
                std::uint32_t value = 0;
                napi_get_named_property(env, argv[0], "speed", &property);
                if (napi_get_value_uint32(env, property, &value) != napi_ok ||
                    (value != 0U && value != 1U && value != 2U && value != 4U)) {
                    napi_throw_type_error(env, nullptr, "speed must be one of 0, 1, 2, 4");
                    return undefined(env);
                }
                config.speed = value;
            }
        }
    }
    auto holder = std::make_unique<Holder>();
    const auto code = cf_engine_create(&config, &holder->engine);
    if (code != CF_ERROR_NONE) {
        throwNative(env, holder.get(), code);
        return undefined(env);
    }
    napi_value external{};
    auto* raw = holder.release();
    napi_create_external(env, raw, finalizeHolder, nullptr, &external);
    return external;
}

napi_value destroyEngine(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1]{};
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (argc != 1) {
        napi_throw_type_error(env, nullptr, "handle required");
        return undefined(env);
    }
    void* pointer = nullptr;
    if (napi_get_value_external(env, argv[0], &pointer) != napi_ok || !pointer) {
        napi_throw_type_error(env, nullptr, "handle required");
        return undefined(env);
    }
    auto* holder = static_cast<Holder*>(pointer);
    if (holder->engine) {
        cf_engine_destroy(holder->engine);
        holder->engine = nullptr;
    }
    return undefined(env);
}

napi_value step(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value argv[2]{};
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    auto* holder = argc > 0 ? holderFrom(env, argv[0]) : nullptr;
    if (!holder) return undefined(env);
    double ticks = 0;
    if (argc < 2 || napi_get_value_double(env, argv[1], &ticks) != napi_ok ||
        !std::isfinite(ticks) || std::floor(ticks) != ticks || ticks < 0 ||
        ticks > 9007199254740991.0) {
        napi_throw_type_error(env, nullptr, "ticks must be a non-negative safe integer");
        return undefined(env);
    }
    const auto code = cf_engine_step(holder->engine, static_cast<std::uint64_t>(ticks));
    if (code != CF_ERROR_NONE) throwNative(env, holder, code);
    return undefined(env);
}

napi_value textOperation(
    napi_env env,
    napi_callback_info info,
    cf_error_code (*operation)(cf_engine*, const uint8_t*, size_t)) {
    size_t argc = 2;
    napi_value argv[2]{};
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    auto* holder = argc > 0 ? holderFrom(env, argv[0]) : nullptr;
    if (!holder) return undefined(env);
    if (argc < 2) {
        napi_throw_type_error(env, nullptr, "text payload required");
        return undefined(env);
    }
    const auto text = stringArgument(env, argv[1]);
    const auto code = operation(
        holder->engine,
        reinterpret_cast<const uint8_t*>(text.data()),
        text.size());
    if (code != CF_ERROR_NONE) throwNative(env, holder, code);
    return undefined(env);
}

napi_value textOutputOperation(
    napi_env env,
    napi_callback_info info,
    cf_error_code (*operation)(cf_engine*, const uint8_t*, size_t, cf_buffer*)) {
    size_t argc = 2;
    napi_value argv[2]{};
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    auto* holder = argc > 0 ? holderFrom(env, argv[0]) : nullptr;
    if (!holder) return undefined(env);
    if (argc < 2) {
        napi_throw_type_error(env, nullptr, "text payload required");
        return undefined(env);
    }
    const auto text = stringArgument(env, argv[1]);
    cf_buffer buffer{};
    const auto code = operation(
        holder->engine,
        reinterpret_cast<const uint8_t*>(text.data()),
        text.size(),
        &buffer);
    if (code != CF_ERROR_NONE) {
        throwNative(env, holder, code);
        return undefined(env);
    }
    return bufferToString(env, buffer);
}

napi_value submitCommands(napi_env env, napi_callback_info info) {
    return textOperation(env, info, cf_engine_submit_commands);
}
napi_value loadV9(napi_env env, napi_callback_info info) {
    return textOperation(env, info, cf_engine_load_v9);
}
napi_value createWorld(napi_env env, napi_callback_info info) {
    return textOutputOperation(env, info, cf_engine_create_world);
}
napi_value restoreWorld(napi_env env, napi_callback_info info) {
    return textOutputOperation(env, info, cf_engine_restore_world);
}
napi_value createLegacyWorld(napi_env env, napi_callback_info info) {
    return textOutputOperation(env, info, cf_engine_create_legacy_world);
}
napi_value runDesignStorm(napi_env env, napi_callback_info info) {
    return textOutputOperation(env, info, cf_engine_run_design_storm);
}
napi_value rebuildUrbanLegacy(napi_env env, napi_callback_info info) {
    return textOutputOperation(env, info, cf_engine_rebuild_urban_legacy);
}
napi_value restoreUrbanState(napi_env env, napi_callback_info info) {
    return textOutputOperation(env, info, cf_engine_restore_urban_state);
}

napi_value outputOperation(
    napi_env env,
    napi_callback_info info,
    cf_error_code (*operation)(cf_engine*, cf_buffer*)) {
    size_t argc = 1;
    napi_value argv[1]{};
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    auto* holder = argc > 0 ? holderFrom(env, argv[0]) : nullptr;
    if (!holder) return undefined(env);
    cf_buffer buffer{};
    const auto code = operation(holder->engine, &buffer);
    if (code != CF_ERROR_NONE) {
        throwNative(env, holder, code);
        return undefined(env);
    }
    return bufferToString(env, buffer);
}

napi_value saveV9(napi_env env, napi_callback_info info) {
    return outputOperation(env, info, cf_engine_save_v9);
}
napi_value getSnapshot(napi_env env, napi_callback_info info) {
    return outputOperation(env, info, cf_engine_get_snapshot);
}
napi_value getEvents(napi_env env, napi_callback_info info) {
    return outputOperation(env, info, cf_engine_get_events);
}
napi_value getUrbanSnapshot(napi_env env, napi_callback_info info) {
    return outputOperation(env, info, cf_engine_get_urban_snapshot);
}

napi_value getDomainHash(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value argv[2]{};
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    auto* holder = argc > 0 ? holderFrom(env, argv[0]) : nullptr;
    if (!holder) return undefined(env);
    if (argc < 2) {
        napi_throw_type_error(env, nullptr, "domain required");
        return undefined(env);
    }
    const auto domain = stringArgument(env, argv[1]);
    cf_domain_hash hash{};
    const auto code = cf_engine_get_domain_hash(holder->engine, domain.c_str(), &hash);
    if (code != CF_ERROR_NONE) {
        throwNative(env, holder, code);
        return undefined(env);
    }
    napi_value object{}, ownership{}, version{}, value{};
    napi_create_object(env, &object);
    napi_create_uint32(env, hash.ownership, &ownership);
    napi_create_uint32(env, hash.version, &version);
    napi_create_bigint_uint64(env, hash.value, &value);
    napi_set_named_property(env, object, "ownership", ownership);
    napi_set_named_property(env, object, "version", version);
    napi_set_named_property(env, object, "value", value);
    return object;
}

napi_value init(napi_env env, napi_value exports) {
    const napi_property_descriptor properties[] = {
        {"createEngine", nullptr, createEngine, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"destroyEngine", nullptr, destroyEngine, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"submitCommands", nullptr, submitCommands, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"step", nullptr, step, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"loadV9", nullptr, loadV9, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"saveV9", nullptr, saveV9, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"getSnapshot", nullptr, getSnapshot, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"getEvents", nullptr, getEvents, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"getDomainHash", nullptr, getDomainHash, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"createWorld", nullptr, createWorld, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"restoreWorld", nullptr, restoreWorld, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"createLegacyWorld", nullptr, createLegacyWorld, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"runDesignStorm", nullptr, runDesignStorm, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"rebuildUrbanLegacy", nullptr, rebuildUrbanLegacy, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"restoreUrbanState", nullptr, restoreUrbanState, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"getUrbanSnapshot", nullptr, getUrbanSnapshot, nullptr, nullptr, nullptr, napi_default, nullptr},
    };
    napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
    return exports;
}
} // namespace

NAPI_MODULE(civic_native, init)
