#include <civic/core/RandomStreamRegistry.hpp>

#include <algorithm>
#include <array>
#include <limits>

namespace civic {
namespace {
constexpr std::uint32_t fallback_seed = 0x6d2b79f5U;

Result<std::uint32_t> nextCodePoint(std::string_view input, std::size_t& offset) {
    const auto lead = static_cast<unsigned char>(input[offset]);
    if (lead < 0x80U) {
        ++offset;
        return lead;
    }
    unsigned length = 0;
    std::uint32_t cp = 0;
    std::uint32_t minimum = 0;
    if ((lead & 0xe0U) == 0xc0U) { length = 2; cp = lead & 0x1fU; minimum = 0x80U; }
    else if ((lead & 0xf0U) == 0xe0U) { length = 3; cp = lead & 0x0fU; minimum = 0x800U; }
    else if ((lead & 0xf8U) == 0xf0U) { length = 4; cp = lead & 0x07U; minimum = 0x10000U; }
    else return std::unexpected(make_error(ErrorCode::invalid_argument, "random stream name is not valid UTF-8"));
    if (offset + length > input.size()) return std::unexpected(make_error(ErrorCode::invalid_argument, "random stream name is not valid UTF-8"));
    for (unsigned i = 1; i < length; ++i) {
        const auto byte = static_cast<unsigned char>(input[offset + i]);
        if ((byte & 0xc0U) != 0x80U) return std::unexpected(make_error(ErrorCode::invalid_argument, "random stream name is not valid UTF-8"));
        cp = (cp << 6U) | (byte & 0x3fU);
    }
    offset += length;
    if (cp < minimum || cp > 0x10ffffU || (cp >= 0xd800U && cp <= 0xdfffU)) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, "random stream name is not valid UTF-8"));
    }
    return cp;
}

void fnvUnit(std::uint32_t unit, std::uint32_t& hash) noexcept {
    hash ^= unit;
    hash *= 0x01000193U;
}

bool isEcmaTrimCodePoint(std::uint32_t cp) noexcept {
    if (cp == 0x0009U || cp == 0x000aU || cp == 0x000bU || cp == 0x000cU || cp == 0x000dU || cp == 0x0020U || cp == 0x00a0U || cp == 0x1680U || cp == 0x2028U || cp == 0x2029U || cp == 0x202fU || cp == 0x205fU || cp == 0x3000U || cp == 0xfeffU) {
        return true;
    }
    return cp >= 0x2000U && cp <= 0x200aU;
}
} // namespace

SeededRandom::SeededRandom(std::uint32_t seed) noexcept : state_(seed == 0U ? fallback_seed : seed) {}

double SeededRandom::next() noexcept {
    auto x = state_;
    x ^= x << 13U;
    x ^= x >> 17U;
    x ^= x << 5U;
    state_ = x;
    return static_cast<double>(state_) / 4294967296.0;
}

Result<std::uint32_t> SeededRandom::nextInt(std::uint32_t max_exclusive) noexcept {
    if (max_exclusive == 0U) return std::unexpected(make_error(ErrorCode::invalid_argument, "maxExclusive must be a positive integer"));
    return static_cast<std::uint32_t>(next() * static_cast<double>(max_exclusive));
}

void SeededRandom::restore(std::uint32_t state) noexcept { state_ = state == 0U ? fallback_seed : state; }

Result<std::uint32_t> RandomStreamRegistry::hashName(std::string_view name) {
    if (name.empty()) return std::unexpected(make_error(ErrorCode::invalid_argument, "random stream name must not be empty"));
    std::uint32_t hash = 0x811c9dc5U;
    bool has_non_trim_code_point = false;
    std::size_t offset = 0;
    while (offset < name.size()) {
        auto decoded = nextCodePoint(name, offset);
        if (!decoded) return std::unexpected(decoded.error());
        const auto cp = *decoded;
        has_non_trim_code_point = has_non_trim_code_point || !isEcmaTrimCodePoint(cp);
        if (cp <= 0xffffU) {
            fnvUnit(cp, hash);
        } else {
            const auto shifted = cp - 0x10000U;
            fnvUnit(0xd800U + (shifted >> 10U), hash);
            fnvUnit(0xdc00U + (shifted & 0x3ffU), hash);
        }
    }
    if (!has_non_trim_code_point) return std::unexpected(make_error(ErrorCode::invalid_argument, "random stream name must not be empty"));
    return hash;
}

std::uint32_t RandomStreamRegistry::mix32(std::uint32_t value) noexcept {
    auto x = value;
    x ^= x >> 16U;
    x *= 0x7feb352dU;
    x ^= x >> 15U;
    x *= 0x846ca68bU;
    x ^= x >> 16U;
    return x == 0U ? fallback_seed : x;
}

Result<SeededRandom*> RandomStreamRegistry::stream(std::string_view name) {
    auto hash = hashName(name);
    if (!hash) return std::unexpected(hash.error());
    auto it = streams_.find(name);
    if (it == streams_.end()) {
        auto [inserted, ignored] = streams_.emplace(std::string{name}, SeededRandom{mix32(root_seed_ ^ *hash)});
        (void)ignored;
        it = inserted;
    }
    return &it->second;
}

RandomStreamSnapshot RandomStreamRegistry::snapshot() const {
    RandomStreamSnapshot output;
    for (const auto& [name, stream] : streams_) output.emplace(name, stream.state());
    return output;
}

Result<void> RandomStreamRegistry::restore(const RandomStreamSnapshot& snapshot) {
    std::map<std::string, SeededRandom, Utf16OrdinalLess> restored;
    for (const auto& [name, state] : snapshot) {
        auto hash = hashName(name);
        if (!hash) return std::unexpected(hash.error());
        SeededRandom stream{mix32(root_seed_ ^ *hash)};
        stream.restore(state);
        restored.emplace(name, stream);
    }
    streams_ = std::move(restored);
    return {};
}

} // namespace civic
