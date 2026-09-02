#pragma once

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cstdint>
#include <iomanip>
#include <map>
#include <optional>
#include <sstream>
#include <string>
#include <string_view>
#include <utility>

namespace civic::parity {

[[nodiscard]] inline std::string shadow_hex(std::uint64_t value) {
  std::ostringstream stream;
  stream << std::hex << std::setfill('0') << std::setw(16) << value;
  return stream.str();
}

class ShadowHash64 final {
public:
  ShadowHash64& mix_u64(std::uint64_t input) noexcept {
    for (std::uint32_t index = 0; index < 8; ++index) {
      value_ ^= (input >> (index * 8U)) & 0xffU;
      value_ *= kPrime;
    }
    return *this;
  }

  ShadowHash64& mix_raw_byte(std::uint8_t input) noexcept {
    value_ ^= input;
    value_ *= kPrime;
    return *this;
  }

  ShadowHash64& mix_string(std::string_view input) noexcept {
    for (const char character : input) {
      mix_raw_byte(static_cast<std::uint8_t>(
          static_cast<unsigned char>(character)));
    }
    mix_raw_byte(0xffU);
    return *this;
  }

  [[nodiscard]] std::uint64_t value() const noexcept { return value_; }
  [[nodiscard]] std::string hex() const { return shadow_hex(value_); }

private:
  static constexpr std::uint64_t kOffset = 1469598103934665603ULL;
  static constexpr std::uint64_t kPrime = 1099511628211ULL;
  std::uint64_t value_{kOffset};
};

struct ShadowDifference final {
  std::string path{};
  nlohmann::json expected{};
  nlohmann::json actual{};
};

[[nodiscard]] inline std::optional<ShadowDifference> first_shadow_difference(
    const nlohmann::json& expected,
    const nlohmann::json& actual,
    std::string path = "$") {
  if (expected == actual) return std::nullopt;

  if (expected.is_array() || actual.is_array()) {
    if (!expected.is_array() || !actual.is_array()) {
      return ShadowDifference{std::move(path), expected, actual};
    }
    const auto length = std::max(expected.size(), actual.size());
    for (std::size_t index = 0; index < length; ++index) {
      if (index >= expected.size() || index >= actual.size()) {
        return ShadowDifference{
            path + "[" + std::to_string(index) + "]",
            index < expected.size() ? expected[index] : nlohmann::json{},
            index < actual.size() ? actual[index] : nlohmann::json{},
        };
      }
      if (auto difference = first_shadow_difference(
              expected[index],
              actual[index],
              path + "[" + std::to_string(index) + "]")) {
        return difference;
      }
    }
    return std::nullopt;
  }

  if (expected.is_object() || actual.is_object()) {
    if (!expected.is_object() || !actual.is_object()) {
      return ShadowDifference{std::move(path), expected, actual};
    }
    std::map<std::string, bool> keys;
    for (auto iterator = expected.begin(); iterator != expected.end(); ++iterator) {
      keys[iterator.key()] = true;
    }
    for (auto iterator = actual.begin(); iterator != actual.end(); ++iterator) {
      keys[iterator.key()] = true;
    }
    for (const auto& [key, ignored] : keys) {
      static_cast<void>(ignored);
      const auto expected_iterator = expected.find(key);
      const auto actual_iterator = actual.find(key);
      if (expected_iterator == expected.end() || actual_iterator == actual.end()) {
        return ShadowDifference{
            path + "." + key,
            expected_iterator == expected.end() ? nlohmann::json{} : *expected_iterator,
            actual_iterator == actual.end() ? nlohmann::json{} : *actual_iterator,
        };
      }
      if (auto difference = first_shadow_difference(
              *expected_iterator,
              *actual_iterator,
              path + "." + key)) {
        return difference;
      }
    }
    return std::nullopt;
  }

  return ShadowDifference{std::move(path), expected, actual};
}

}  // namespace civic::parity
