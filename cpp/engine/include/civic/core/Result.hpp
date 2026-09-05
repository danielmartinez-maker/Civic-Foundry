#pragma once
#include <cstdint>
#include <expected>
#include <string>
#include <utility>

namespace civic::core {
enum class ErrorCode : std::uint32_t {
  none = 0,
  invalid_argument,
  invalid_state,
  serialization_failure,
  invariant_failure,
  unsupported_save_version,
  not_found,
  conflict,
  internal_error,
};
struct Error final {
  ErrorCode code{ErrorCode::none};
  std::string message{};
  auto operator<=>(const Error&) const = default;
};
template<class T> using Result = std::expected<T, Error>;
using VoidResult = std::expected<void, Error>;
inline Error error(ErrorCode code, std::string message) { return Error{code, std::move(message)}; }
}
