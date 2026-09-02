#include <civic/bridge/civic_engine.h>

#include <civic/core/NativeEngine.hpp>
#include <civic/core/Utf16Ordinal.hpp>

#include <json-c/json.h>

#include <algorithm>
#include <charconv>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <memory>
#include <new>
#include <string>
#include <string_view>
#include <vector>

struct cf_engine {
    std::unique_ptr<civic::NativeEngine> value;
    civic::Error last_error{};
};

namespace {
void appendEscaped(std::string_view text, std::string& output) {
    output.push_back('"');
    for (const unsigned char ch : text) {
        switch (ch) {
            case '"': output += "\\\""; break;
            case '\\': output += "\\\\"; break;
            case '\b': output += "\\b"; break;
            case '\f': output += "\\f"; break;
            case '\n': output += "\\n"; break;
            case '\r': output += "\\r"; break;
            case '\t': output += "\\t"; break;
            default:
                if (ch < 0x20U) {
                    constexpr char hex[] = "0123456789abcdef";
                    output += "\\u00";
                    output.push_back(hex[(ch >> 4U) & 0xfU]);
                    output.push_back(hex[ch & 0xfU]);
                } else {
                    output.push_back(static_cast<char>(ch));
                }
                break;
        }
    }
    output.push_back('"');
}

civic::Result<void> appendCanonical(json_object* value, std::string& output) {
    switch (json_object_get_type(value)) {
        case json_type_null: output += "null"; return {};
        case json_type_boolean: output += json_object_get_boolean(value) ? "true" : "false"; return {};
        case json_type_int: output += std::to_string(json_object_get_int64(value)); return {};
        case json_type_double: {
            const auto number = json_object_get_double(value);
            if (!std::isfinite(number)) return std::unexpected(civic::make_error(civic::ErrorCode::serialization_failure, "command payload contains non-finite number"));
            char buffer[128]{};
            const auto [ptr, error] = std::to_chars(std::begin(buffer), std::end(buffer), number, std::chars_format::general, std::numeric_limits<double>::max_digits10);
            if (error != std::errc{}) return std::unexpected(civic::make_error(civic::ErrorCode::serialization_failure, "failed to canonicalize command number"));
            output.append(buffer, ptr); return {};
        }
        case json_type_string: appendEscaped(json_object_get_string(value), output); return {};
        case json_type_array: {
            output.push_back('[');
            const auto count = json_object_array_length(value);
            for (std::size_t index = 0; index < count; ++index) {
                if (index != 0) output.push_back(',');
                auto result = appendCanonical(json_object_array_get_idx(value, index), output);
                if (!result) return result;
            }
            output.push_back(']'); return {};
        }
        case json_type_object: {
            std::vector<std::string> keys;
            json_object_object_foreach(value, object_key, object_child) { (void)object_child; keys.emplace_back(object_key); }
            std::ranges::sort(keys, civic::Utf16OrdinalLess{});
            output.push_back('{');
            bool first = true;
            for (const auto& key : keys) {
                json_object* child = nullptr; json_object_object_get_ex(value, key.c_str(), &child);
                if (!first) output.push_back(',');
                first = false;
                appendEscaped(key, output); output.push_back(':');
                auto result = appendCanonical(child, output); if (!result) return result;
            }
            output.push_back('}'); return {};
        }
    }
    return std::unexpected(civic::make_error(civic::ErrorCode::serialization_failure, "unknown command payload type"));
}

civic::Result<std::string> canonicalJson(json_object* value) {
    std::string output;
    auto result = appendCanonical(value, output);
    if (!result) return std::unexpected(result.error());
    return output;
}
cf_error_code map(civic::ErrorCode code) noexcept { return static_cast<cf_error_code>(static_cast<std::uint32_t>(code)); }
void clear(cf_engine* engine) { if (engine) engine->last_error = {}; }
cf_error_code fail(cf_engine* engine, civic::Error error) { if (engine) engine->last_error = std::move(error); return map(engine ? engine->last_error.code : civic::ErrorCode::internal_error); }
cf_error_code copyBuffer(std::string_view source, cf_buffer* output) {
    if (!output) return CF_ERROR_INVALID_ARGUMENT;
    output->data = nullptr; output->size = 0;
    if (source.empty()) return CF_ERROR_NONE;
    auto* memory = static_cast<uint8_t*>(std::malloc(source.size()));
    if (!memory) return CF_ERROR_INTERNAL;
    std::memcpy(memory, source.data(), source.size()); output->data = memory; output->size = source.size(); return CF_ERROR_NONE;
}

template<class Operation>
cf_error_code guarded(cf_engine* engine, Operation&& operation) noexcept {
    if (!engine || !engine->value) return CF_ERROR_INVALID_ARGUMENT;
    try {
        clear(engine);
        auto result = operation();
        if (!result) return fail(engine, result.error());
        return CF_ERROR_NONE;
    } catch (const std::exception& error) {
        return fail(engine, civic::make_error(civic::ErrorCode::internal_error, error.what()));
    } catch (...) {
        return fail(engine, civic::make_error(civic::ErrorCode::internal_error, "unknown native exception"));
    }
}

bool hasOnlyJsonWhitespace(const uint8_t* data, size_t size, size_t offset) {
    if (offset > size) return false;
    for (size_t index = offset; index < size; ++index) {
        const auto ch = static_cast<char>(data[index]);
        if (ch != ' ' && ch != '\t' && ch != '\r' && ch != '\n') return false;
    }
    return true;
}

civic::Result<std::vector<civic::CommandEnvelope>> parseCommands(const uint8_t* data, size_t size) {
    if (!data && size != 0) return std::unexpected(civic::make_error(civic::ErrorCode::invalid_argument, "command buffer is null"));
    if (size > static_cast<size_t>(std::numeric_limits<int>::max())) return std::unexpected(civic::make_error(civic::ErrorCode::serialization_failure, "command JSON exceeds parser size limit"));
    json_tokener* tokener = json_tokener_new();
    if (!tokener) return std::unexpected(civic::make_error(civic::ErrorCode::internal_error, "failed to allocate command parser"));
    json_object* raw = json_tokener_parse_ex(tokener, reinterpret_cast<const char*>(data), static_cast<int>(size));
    const auto parse_error = json_tokener_get_error(tokener);
    const auto parse_end = json_tokener_get_parse_end(tokener);
    json_tokener_free(tokener);
    std::unique_ptr<json_object, decltype(&json_object_put)> root{raw, json_object_put};
    if (parse_error != json_tokener_success || !root || json_object_get_type(root.get()) != json_type_array || !hasOnlyJsonWhitespace(data, size, parse_end)) return std::unexpected(civic::make_error(civic::ErrorCode::serialization_failure, "commands must be one complete JSON array"));
    std::vector<civic::CommandEnvelope> commands;
    for (std::size_t i = 0; i < json_object_array_length(root.get()); ++i) {
        auto* item = json_object_array_get_idx(root.get(), i);
        if (!item || json_object_get_type(item) != json_type_object) return std::unexpected(civic::make_error(civic::ErrorCode::serialization_failure, "command must be an object"));
        json_object *sequence=nullptr,*tick=nullptr,*type=nullptr,*payload=nullptr;
        if (!json_object_object_get_ex(item,"sequence",&sequence)||json_object_get_type(sequence)!=json_type_int||json_object_get_int64(sequence)<=0) return std::unexpected(civic::make_error(civic::ErrorCode::serialization_failure,"command.sequence must be positive"));
        if (!json_object_object_get_ex(item,"tick",&tick)||json_object_get_type(tick)!=json_type_int||json_object_get_int64(tick)<0) return std::unexpected(civic::make_error(civic::ErrorCode::serialization_failure,"command.tick must be non-negative"));
        if (!json_object_object_get_ex(item,"type",&type)||json_object_get_type(type)!=json_type_string) return std::unexpected(civic::make_error(civic::ErrorCode::serialization_failure,"command.type must be a string"));
        std::string payloadText="null";
        if (json_object_object_get_ex(item,"payload",&payload)) {
            auto canonical = canonicalJson(payload);
            if (!canonical) return std::unexpected(canonical.error());
            payloadText = std::move(*canonical);
        }
        std::vector<std::byte> bytes(payloadText.size()); std::memcpy(bytes.data(),payloadText.data(),payloadText.size());
        commands.push_back({static_cast<uint64_t>(json_object_get_int64(sequence)),static_cast<uint64_t>(json_object_get_int64(tick)),json_object_get_string(type),std::move(bytes)});
    }
    return commands;
}
} // namespace

extern "C" {
cf_error_code cf_engine_create(const cf_engine_config* config, cf_engine** out_engine) {
    if (!out_engine) return CF_ERROR_INVALID_ARGUMENT;
    *out_engine = nullptr;
    try {
        const auto speed_value = config ? config->speed : 1U;
        if (!civic::validSpeed(speed_value)) return CF_ERROR_INVALID_ARGUMENT;
        const civic::EngineConfig native{config ? config->seed : 1U, config ? config->start_tick : 0U, static_cast<civic::SpeedMode>(speed_value)};
        auto created = civic::NativeEngine::create(native); if (!created) return map(created.error().code);
        auto holder = std::make_unique<cf_engine>(); holder->value = std::move(*created); *out_engine = holder.release(); return CF_ERROR_NONE;
    } catch (...) { return CF_ERROR_INTERNAL; }
}
void cf_engine_destroy(cf_engine* engine) { delete engine; }
cf_error_code cf_engine_submit_commands(cf_engine* engine, const uint8_t* data, size_t size) { return guarded(engine,[&]()->civic::Result<void>{ auto parsed=parseCommands(data,size); if(!parsed)return std::unexpected(parsed.error()); return engine->value->submit(*parsed); }); }
cf_error_code cf_engine_step(cf_engine* engine, uint64_t ticks) { return guarded(engine,[&](){ return engine->value->step(ticks); }); }
cf_error_code cf_engine_load_v9(cf_engine* engine, const uint8_t* data, size_t size) { return guarded(engine,[&]()->civic::Result<void>{ if(!data&&size!=0)return std::unexpected(civic::make_error(civic::ErrorCode::invalid_argument,"save buffer is null")); return engine->value->loadV9(std::string_view(reinterpret_cast<const char*>(data),size)); }); }
cf_error_code cf_engine_save_v9(cf_engine* engine, cf_buffer* out_buffer) { return guarded(engine,[&]()->civic::Result<void>{ auto result=engine->value->saveV9(); if(!result)return std::unexpected(result.error()); const auto copied=copyBuffer(*result,out_buffer); if(copied!=CF_ERROR_NONE)return std::unexpected(civic::make_error(civic::ErrorCode::internal_error,"failed to allocate save buffer")); return {}; }); }
cf_error_code cf_engine_get_snapshot(cf_engine* engine, cf_buffer* out_buffer) { return guarded(engine,[&]()->civic::Result<void>{ auto result=engine->value->snapshot(); if(!result)return std::unexpected(result.error()); const auto copied=copyBuffer(result->json,out_buffer); if(copied!=CF_ERROR_NONE)return std::unexpected(civic::make_error(civic::ErrorCode::internal_error,"failed to allocate snapshot buffer")); return {}; }); }
cf_error_code cf_engine_get_events(cf_engine* engine, cf_buffer* out_buffer) { return guarded(engine,[&]()->civic::Result<void>{ auto result=engine->value->drainEvents(); if(!result)return std::unexpected(result.error()); const auto copied=copyBuffer(result->json,out_buffer); if(copied!=CF_ERROR_NONE)return std::unexpected(civic::make_error(civic::ErrorCode::internal_error,"failed to allocate event buffer")); return {}; }); }
cf_error_code cf_engine_get_domain_hash(cf_engine* engine, const char* domain, cf_domain_hash* out_hash) { return guarded(engine,[&]()->civic::Result<void>{ if(!domain||!out_hash)return std::unexpected(civic::make_error(civic::ErrorCode::invalid_argument,"domain/hash output required")); auto result=engine->value->domainHash(domain); if(!result)return std::unexpected(result.error()); out_hash->ownership=static_cast<uint32_t>(result->ownership); out_hash->version=result->version; out_hash->value=result->value; return {}; }); }
cf_error_code cf_engine_get_last_error(cf_engine* engine, cf_error* out_error) { if(!engine||!out_error)return CF_ERROR_INVALID_ARGUMENT; out_error->code=map(engine->last_error.code); return copyBuffer(engine->last_error.message,&out_error->message); }
void cf_buffer_free(cf_buffer buffer) { std::free(buffer.data); }
}
