#pragma once

#include <cstdint>
#include <expected>
#include <string>
#include <utility>

#include <civic/core/Result.hpp>

namespace civic {

enum class ErrorCode : std::uint32_t {
    none = 0,
    invalid_argument,
    invalid_state,
    serialization_failure,
    invariant_failure,
    unsupported_save_version,
    internal_error,
    not_found = invalid_state,
    conflict = invalid_state,
};

struct Error final {
    ErrorCode code{ErrorCode::none};
    std::string message;

    auto operator<=>(const Error&) const = default;
};

template<class T>
using Result = std::expected<T, Error>;

[[nodiscard]] inline Error make_error(ErrorCode code, std::string message) {
    return Error{code, std::move(message)};
}

[[nodiscard]] inline Error make_error(core::ErrorCode code, std::string message) {
    switch (code) {
        case core::ErrorCode::none:
            return make_error(ErrorCode::none, std::move(message));
        case core::ErrorCode::invalid_argument:
            return make_error(ErrorCode::invalid_argument, std::move(message));
        case core::ErrorCode::invalid_state:
        case core::ErrorCode::not_found:
        case core::ErrorCode::conflict:
            return make_error(ErrorCode::invalid_state, std::move(message));
        case core::ErrorCode::serialization_failure:
            return make_error(ErrorCode::serialization_failure, std::move(message));
        case core::ErrorCode::invariant_failure:
            return make_error(ErrorCode::invariant_failure, std::move(message));
        case core::ErrorCode::unsupported_save_version:
            return make_error(ErrorCode::unsupported_save_version, std::move(message));
        case core::ErrorCode::internal_error:
            return make_error(ErrorCode::internal_error, std::move(message));
    }
    return make_error(ErrorCode::internal_error, std::move(message));
}

} // namespace civic
