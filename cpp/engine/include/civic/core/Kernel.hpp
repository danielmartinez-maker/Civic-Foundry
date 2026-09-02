#pragma once

#include <cstddef>
#include <cstdint>
#include <functional>
#include <map>
#include <set>
#include <span>
#include <string>
#include <string_view>
#include <vector>

#include <civic/core/Error.hpp>
#include <civic/core/RandomStreamRegistry.hpp>
#include <civic/core/Utf16Ordinal.hpp>

namespace civic {

enum class SpeedMode : std::uint32_t { paused = 0, normal = 1, fast = 2, fastest = 4 };
[[nodiscard]] constexpr bool validSpeed(std::uint32_t value) noexcept { return value == 0U || value == 1U || value == 2U || value == 4U; }

class SimulationClock final {
public:
    explicit SimulationClock(std::uint64_t tick = 0, SpeedMode speed = SpeedMode::normal) noexcept : tick_(tick), speed_(speed) {}
    [[nodiscard]] std::uint64_t tick() const noexcept { return tick_; }
    [[nodiscard]] SpeedMode speed() const noexcept { return speed_; }
    [[nodiscard]] Result<void> setSpeed(SpeedMode speed) noexcept;
    [[nodiscard]] Result<void> step(std::uint64_t ticks) noexcept;
    void restore(std::uint64_t tick, SpeedMode speed) noexcept { tick_ = tick; speed_ = speed; }
private:
    std::uint64_t tick_{};
    SpeedMode speed_{SpeedMode::normal};
};

struct CommandEnvelope final {
    std::uint64_t sequence{};
    std::uint64_t tick{};
    std::string type;
    std::vector<std::byte> payload;
};

struct DomainEvent final {
    std::uint64_t sequence{};
    std::uint64_t tick{};
    std::string type;
    std::string source;
    std::vector<std::byte> payload;
};

class CommandQueue final {
public:
    [[nodiscard]] Result<void> submit(std::span<const CommandEnvelope> commands, std::uint64_t current_tick);
    [[nodiscard]] std::vector<CommandEnvelope> takeReady(std::uint64_t tick);
    [[nodiscard]] const std::vector<CommandEnvelope>& pending() const noexcept { return queue_; }
private:
    std::vector<CommandEnvelope> queue_;
    std::set<std::uint64_t> sequences_;
};

class DomainEventJournal final {
public:
    DomainEvent append(std::uint64_t tick, std::string type, std::string source, std::vector<std::byte> payload = {});
    [[nodiscard]] std::vector<DomainEvent> drain();
    [[nodiscard]] const std::vector<DomainEvent>& list() const noexcept { return events_; }
    [[nodiscard]] std::uint64_t nextSequence() const noexcept { return next_sequence_; }
private:
    std::vector<DomainEvent> events_;
    std::uint64_t next_sequence_{1};
};

struct SystemCadence final { std::uint64_t every{1}; std::uint64_t offset{0}; };
struct SystemDefinition final {
    std::string id;
    SystemCadence cadence;
    std::vector<std::string> after;
    std::vector<std::string> before;
    std::vector<std::string> reads;
    std::vector<std::string> writes;
    std::int64_t order{};
    std::function<Result<void>(std::uint64_t)> execute;
};

class SystemScheduler final {
public:
    [[nodiscard]] Result<void> registerSystem(SystemDefinition system);
    [[nodiscard]] Result<void> compile();
    [[nodiscard]] Result<std::vector<SystemDefinition*>> dueSystems(std::uint64_t tick);
    [[nodiscard]] std::vector<std::string> orderedIds() const;
private:
    std::map<std::string, SystemDefinition, Utf16OrdinalLess> systems_;
    std::vector<std::string> compiled_;
};

struct InvariantDefinition final {
    std::string id;
    SystemCadence cadence;
    std::function<Result<void>(std::uint64_t)> check;
};

class InvariantRunner final {
public:
    [[nodiscard]] Result<void> registerInvariant(InvariantDefinition invariant);
    [[nodiscard]] Result<void> runDue(std::uint64_t tick) const;
private:
    std::map<std::string, InvariantDefinition, Utf16OrdinalLess> invariants_;
};

} // namespace civic
