#pragma once

#include <cstddef>
#include <cstdint>
#include <functional>
#include <string>
#include <string_view>
#include <vector>

#include <civic/core/Error.hpp>

namespace civic {

using DomainKey = std::string;
using KernelSystemId = std::string;
using CommandType = std::string;
using EventType = std::string;

inline constexpr std::uint32_t command_protocol_version = 1U;

struct CommandEnvelope final {
    std::uint64_t sequence{};
    std::uint64_t tick{};
    CommandType type;
    std::vector<std::byte> payload;
    std::uint32_t version{command_protocol_version};
};

struct DomainEvent final {
    std::uint64_t sequence{};
    std::uint64_t tick{};
    EventType type;
    std::string source;
    std::vector<std::byte> payload;
};

struct SystemCadence final {
    std::uint64_t every{1};
    std::uint64_t offset{0};
};

[[nodiscard]] Result<void> validateCadence(
    const SystemCadence& cadence,
    std::string_view owner
);

[[nodiscard]] constexpr bool isDue(
    const SystemCadence& cadence,
    std::uint64_t tick
) noexcept {
    return cadence.every > 0 &&
           tick >= cadence.offset &&
           ((tick - cadence.offset) % cadence.every) == 0;
}

struct SystemDefinition final {
    KernelSystemId id;
    SystemCadence cadence;
    std::vector<KernelSystemId> after;
    std::vector<KernelSystemId> before;
    std::vector<DomainKey> reads;
    std::vector<DomainKey> writes;
    std::int64_t order{};
    std::function<Result<void>(std::uint64_t)> execute;
};

struct InvariantDefinition final {
    std::string id;
    SystemCadence cadence;
    std::function<Result<void>(std::uint64_t)> check;
};

} // namespace civic
