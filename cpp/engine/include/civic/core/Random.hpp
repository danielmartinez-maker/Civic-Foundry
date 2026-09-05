#pragma once
#include "Result.hpp"
#include <algorithm>
#include <cstdint>
#include <map>
#include <string>
#include <string_view>
#include <stdexcept>

namespace civic::core {
class SeededRandom final {
public:
  explicit SeededRandom(std::uint32_t seed) noexcept : state_(seed == 0 ? fallback_seed : seed) {}
  [[nodiscard]] double next() noexcept {
    auto x = state_;
    x ^= static_cast<std::uint32_t>(x << 13U);
    x ^= x >> 17U;
    x ^= static_cast<std::uint32_t>(x << 5U);
    state_ = x;
    return static_cast<double>(state_) / 4294967296.0;
  }
  [[nodiscard]] Result<std::uint32_t> next_int(std::uint32_t max_exclusive) noexcept {
    if (max_exclusive == 0) return std::unexpected(error(ErrorCode::invalid_argument, "maxExclusive must be positive"));
    return static_cast<std::uint32_t>(next() * static_cast<double>(max_exclusive));
  }
  [[nodiscard]] std::uint32_t state() const noexcept { return state_; }
  void set_state(std::uint32_t value) noexcept { state_ = value == 0 ? fallback_seed : value; }
  static constexpr std::uint32_t fallback_seed = 0x6d2b79f5U;
private:
  std::uint32_t state_{};
};
[[nodiscard]] constexpr std::uint32_t mix32(std::uint32_t value) noexcept {
  auto x = value;
  x ^= x >> 16U;
  x *= 0x7feb352dU;
  x ^= x >> 15U;
  x *= 0x846ca68bU;
  x ^= x >> 16U;
  return x == 0 ? SeededRandom::fallback_seed : x;
}
[[nodiscard]] inline std::uint32_t hash_name(std::string_view name) noexcept {
  std::uint32_t hash = 0x811c9dc5U;
  for (const unsigned char ch : name) {
    hash ^= static_cast<std::uint32_t>(ch);
    hash *= 0x01000193U;
  }
  return hash;
}
class RandomStreamRegistry final {
public:
  explicit RandomStreamRegistry(std::uint32_t root_seed) noexcept : root_seed_(root_seed) {}
  [[nodiscard]] SeededRandom& stream(std::string_view name) {
    if (name.empty()) throw std::invalid_argument("random stream name must not be empty");
    auto [it, inserted] = streams_.try_emplace(std::string{name}, mix32(root_seed_ ^ hash_name(name)));
    (void)inserted;
    return it->second;
  }
  [[nodiscard]] std::map<std::string,std::uint32_t> snapshot() const {
    std::map<std::string,std::uint32_t> result;
    for (const auto& [name, stream] : streams_) result.emplace(name, stream.state());
    return result;
  }
  Result<void> restore(const std::map<std::string,std::uint32_t>& snapshot) {
    std::map<std::string,SeededRandom> restored;
    for (const auto& [name,state] : snapshot) {
      if (name.empty()) return std::unexpected(error(ErrorCode::invalid_argument,"random stream name must not be empty"));
      SeededRandom stream{mix32(root_seed_ ^ hash_name(name))}; stream.set_state(state); restored.emplace(name,stream);
    }
    streams_ = std::move(restored); return {};
  }
private:
  std::uint32_t root_seed_{};
  std::map<std::string,SeededRandom> streams_{};
};
}
