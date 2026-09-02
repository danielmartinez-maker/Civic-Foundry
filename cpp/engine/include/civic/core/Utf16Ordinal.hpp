#pragma once

#include <cstdint>
#include <string>
#include <string_view>

namespace civic {
namespace utf16_detail {
inline bool nextCodePoint(std::string_view input, std::size_t& offset, std::uint32_t& code_point) noexcept {
    if (offset >= input.size()) return false;
    const auto lead = static_cast<unsigned char>(input[offset]);
    if (lead < 0x80U) {
        code_point = lead;
        ++offset;
        return true;
    }
    unsigned length = 0;
    std::uint32_t minimum = 0;
    if ((lead & 0xe0U) == 0xc0U) { length = 2; code_point = lead & 0x1fU; minimum = 0x80U; }
    else if ((lead & 0xf0U) == 0xe0U) { length = 3; code_point = lead & 0x0fU; minimum = 0x800U; }
    else if ((lead & 0xf8U) == 0xf0U) { length = 4; code_point = lead & 0x07U; minimum = 0x10000U; }
    else return false;
    if (offset + length > input.size()) return false;
    for (unsigned index = 1; index < length; ++index) {
        const auto byte = static_cast<unsigned char>(input[offset + index]);
        if ((byte & 0xc0U) != 0x80U) return false;
        code_point = (code_point << 6U) | (byte & 0x3fU);
    }
    offset += length;
    return code_point >= minimum && code_point <= 0x10ffffU && !(code_point >= 0xd800U && code_point <= 0xdfffU);
}


inline bool isEcmaTrimCodePoint(std::uint32_t code_point) noexcept {
    if (code_point == 0x0009U || code_point == 0x000aU || code_point == 0x000bU ||
        code_point == 0x000cU || code_point == 0x000dU || code_point == 0x0020U ||
        code_point == 0x00a0U || code_point == 0x1680U || code_point == 0x2028U ||
        code_point == 0x2029U || code_point == 0x202fU || code_point == 0x205fU ||
        code_point == 0x3000U || code_point == 0xfeffU) {
        return true;
    }
    return code_point >= 0x2000U && code_point <= 0x200aU;
}

inline bool validUtf8AndHasNonEcmaTrimCodePoint(std::string_view input) noexcept {
    if (input.empty()) return false;
    bool has_non_trim = false;
    std::size_t offset = 0;
    while (offset < input.size()) {
        std::uint32_t code_point = 0;
        if (!nextCodePoint(input, offset, code_point)) return false;
        has_non_trim = has_non_trim || !isEcmaTrimCodePoint(code_point);
    }
    return has_non_trim;
}

inline std::u16string toUnits(std::string_view input) {
    std::u16string output;
    output.reserve(input.size());
    std::size_t offset = 0;
    while (offset < input.size()) {
        std::uint32_t code_point = 0;
        if (!nextCodePoint(input, offset, code_point)) {
            // Native public string inputs are validated before storage. This fallback
            // keeps the comparator deterministic for defensive internal use.
            output.clear();
            for (const unsigned char byte : input) output.push_back(static_cast<char16_t>(byte));
            return output;
        }
        if (code_point <= 0xffffU) {
            output.push_back(static_cast<char16_t>(code_point));
        } else {
            const auto shifted = code_point - 0x10000U;
            output.push_back(static_cast<char16_t>(0xd800U + (shifted >> 10U)));
            output.push_back(static_cast<char16_t>(0xdc00U + (shifted & 0x3ffU)));
        }
    }
    return output;
}
} // namespace utf16_detail

struct Utf16OrdinalLess final {
    using is_transparent = void;
    bool operator()(std::string_view left, std::string_view right) const {
        return utf16_detail::toUnits(left) < utf16_detail::toUnits(right);
    }
};

} // namespace civic
