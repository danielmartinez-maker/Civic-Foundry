#pragma once

#include <json-c/json.h>

#include <algorithm>
#include <charconv>
#include <cmath>
#include <limits>
#include <memory>
#include <set>
#include <string>
#include <string_view>
#include <vector>

#include <civic/core/Error.hpp>
#include <civic/core/Utf16Ordinal.hpp>

namespace civic::save_v9_detail {
using JsonPtr = std::unique_ptr<json_object, decltype(&json_object_put)>;

inline bool isObject(json_object* value) { return value && json_object_get_type(value) == json_type_object; }
inline bool isArray(json_object* value) { return value && json_object_get_type(value) == json_type_array; }
inline bool nonBlank(std::string_view value) { return value.find_first_not_of(" \t\r\n") != std::string_view::npos; }

inline Result<json_object*> requireField(json_object* object, const char* key, json_type type) {
    json_object* value = nullptr;
    if (!json_object_object_get_ex(object, key, &value) || !value || json_object_get_type(value) != type) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, std::string{key} + " has invalid type"));
    }
    return value;
}

inline Result<std::string> requireStringField(json_object* object, const char* key, std::string_view label) {
    json_object* value = nullptr;
    if (!json_object_object_get_ex(object, key, &value) || !value || json_object_get_type(value) != json_type_string || !nonBlank(json_object_get_string(value))) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, std::string{label} + " must be a non-empty string"));
    }
    return std::string{json_object_get_string(value)};
}

inline void appendEscaped(std::string_view text, std::string& output) {
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
        }
    }
    output.push_back('"');
}

inline Result<void> appendCanonical(json_object* value, std::string& output) {
    switch (json_object_get_type(value)) {
        case json_type_null: output += "null"; return {};
        case json_type_boolean: output += json_object_get_boolean(value) ? "true" : "false"; return {};
        case json_type_int: output += std::to_string(json_object_get_int64(value)); return {};
        case json_type_double: {
            const double number = json_object_get_double(value);
            if (!std::isfinite(number)) return std::unexpected(make_error(ErrorCode::serialization_failure, "save contains non-finite number"));
            char buffer[128]{};
            auto [ptr, error] = std::to_chars(std::begin(buffer), std::end(buffer), number, std::chars_format::general, std::numeric_limits<double>::max_digits10);
            if (error != std::errc{}) return std::unexpected(make_error(ErrorCode::serialization_failure, "failed to serialize number"));
            output.append(buffer, ptr);
            return {};
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
            output.push_back(']');
            return {};
        }
        case json_type_object: {
            std::vector<std::string> keys;
            json_object_object_foreach(value, object_key, object_child) { (void)object_child; keys.emplace_back(object_key); }
            std::ranges::sort(keys, civic::Utf16OrdinalLess{});
            output.push_back('{');
            bool first = true;
            for (const auto& sorted_key : keys) {
                json_object* value_child = nullptr;
                json_object_object_get_ex(value, sorted_key.c_str(), &value_child);
                if (!first) output.push_back(',');
                first = false;
                appendEscaped(sorted_key, output);
                output.push_back(':');
                auto result = appendCanonical(value_child, output);
                if (!result) return result;
            }
            output.push_back('}');
            return {};
        }
    }
    return std::unexpected(make_error(ErrorCode::serialization_failure, "unknown JSON type"));
}

inline Result<std::string> canonical(json_object* value) {
    std::string output;
    auto result = appendCanonical(value, output);
    if (!result) return std::unexpected(result.error());
    return output;
}

inline Result<void> validateRecursive(json_object* value, std::string path) {
    const auto type = json_object_get_type(value);
    if (type == json_type_double && !std::isfinite(json_object_get_double(value))) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, path + " contains non-finite number"));
    }
    if (type == json_type_array) {
        std::set<std::string, std::less<>> ids;
        const auto count = json_object_array_length(value);
        for (std::size_t index = 0; index < count; ++index) {
            auto* child = json_object_array_get_idx(value, index);
            if (isObject(child)) {
                json_object* id = nullptr;
                if (json_object_object_get_ex(child, "id", &id)) {
                    if (!id || json_object_get_type(id) != json_type_string || !nonBlank(json_object_get_string(id))) {
                        return std::unexpected(make_error(ErrorCode::serialization_failure, path + "[" + std::to_string(index) + "] has invalid id"));
                    }
                    const std::string text = json_object_get_string(id);
                    if (!ids.insert(text).second) return std::unexpected(make_error(ErrorCode::serialization_failure, path + " contains duplicate id: " + text));
                }
            }
            auto result = validateRecursive(child, path + "[" + std::to_string(index) + "]");
            if (!result) return result;
        }
    } else if (type == json_type_object) {
        json_object_object_foreach(value, key, child) {
            auto result = validateRecursive(child, path + "." + key);
            if (!result) return result;
        }
    }
    return {};
}
} // namespace civic::save_v9_detail
