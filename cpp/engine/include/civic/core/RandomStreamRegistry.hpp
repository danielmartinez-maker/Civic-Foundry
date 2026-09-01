#pragma once

#include <cstdint>
#include <map>
#include <string>
#include <string_view>

#include <civic/core/Error.hpp>

namespace civic {

class SeededRandom final {
public:
    explicit SeededRandom(std::uint32_t seed) noexcept;
    [[nodiscard]] double next() noexcept;
    [[nodiscard]] Result<std::uint32_t> nextInt(std::uint32_t max_exclusive) noexcept;
    [[nodiscard]] std::uint32_t state() const noexcept { return state_; }
    void restore(std::uint32_t state) noexcept;
private:
    std::uint32_t state_{};
};

using RandomStreamSnapshot = std::map<std::string, std::uint32_t, std::less<>>;

class RandomStreamRegistry final {
public:
    explicit RandomStreamRegistry(std::uint32_t root_seed) noexcept : root_seed_(root_seed) {}
    [[nodiscard]] Result<SeededRandom*> stream(std::string_view name);
    [[nodiscard]] RandomStreamSnapshot snapshot() const;
    [[nodiscard]] Result<void> restore(const RandomStreamSnapshot& snapshot);
private:
    [[nodiscard]] static Result<std::uint32_t> hashName(std::string_view utf8_name);
    [[nodiscard]] static std::uint32_t mix32(std::uint32_t value) noexcept;

    std::uint32_t root_seed_{};
    std::map<std::string, SeededRandom, std::less<>> streams_;
};

} // namespace civic
