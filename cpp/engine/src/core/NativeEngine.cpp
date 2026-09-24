#include <civic/core/NativeEngine.hpp>

#include <algorithm>
#include <cstring>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <utility>

namespace civic {
namespace {
std::string escapeJson(std::string_view value) {
    std::string output{"\""};
    for (const unsigned char ch : value) {
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
    output.push_back('"'); return output;
}
std::string bytesToString(const std::vector<std::byte>& bytes) {
    return std::string(reinterpret_cast<const char*>(bytes.data()), bytes.size());
}

constexpr std::uint32_t transaction_checkpoint_format_version = 1U;

class CheckpointWriter final {
public:
    void u32(std::uint32_t value) {
        for (unsigned shift = 0; shift < 32U; shift += 8U) {
            bytes_.push_back(static_cast<std::byte>((value >> shift) & 0xffU));
        }
    }

    void u64(std::uint64_t value) {
        for (unsigned shift = 0; shift < 64U; shift += 8U) {
            bytes_.push_back(static_cast<std::byte>((value >> shift) & 0xffULL));
        }
    }

    void string(std::string_view value) {
        u64(static_cast<std::uint64_t>(value.size()));
        for (const unsigned char ch : value) {
            bytes_.push_back(static_cast<std::byte>(ch));
        }
    }

    void blob(std::span<const std::byte> value) {
        u64(static_cast<std::uint64_t>(value.size()));
        bytes_.insert(bytes_.end(), value.begin(), value.end());
    }

    [[nodiscard]] std::vector<std::byte> finish() && {
        return std::move(bytes_);
    }

private:
    std::vector<std::byte> bytes_;
};

class CheckpointReader final {
public:
    explicit CheckpointReader(std::span<const std::byte> bytes) noexcept : bytes_(bytes) {}

    [[nodiscard]] Result<std::uint32_t> u32(std::string_view field) {
        auto available = require(4U, field);
        if (!available) return std::unexpected(available.error());
        std::uint32_t value = 0;
        for (unsigned index = 0; index < 4U; ++index) {
            value |= std::to_integer<std::uint32_t>(bytes_[offset_ + index]) << (index * 8U);
        }
        offset_ += 4U;
        return value;
    }

    [[nodiscard]] Result<std::uint64_t> u64(std::string_view field) {
        auto available = require(8U, field);
        if (!available) return std::unexpected(available.error());
        std::uint64_t value = 0;
        for (unsigned index = 0; index < 8U; ++index) {
            value |= std::to_integer<std::uint64_t>(bytes_[offset_ + index]) << (index * 8U);
        }
        offset_ += 8U;
        return value;
    }

    [[nodiscard]] Result<std::size_t> count(std::string_view field) {
        auto encoded = u64(field);
        if (!encoded) return std::unexpected(encoded.error());
        if (*encoded > static_cast<std::uint64_t>(std::numeric_limits<std::size_t>::max()) ||
            *encoded > static_cast<std::uint64_t>(remaining())) {
            return std::unexpected(make_error(
                ErrorCode::serialization_failure,
                "invalid transaction checkpoint " + std::string(field)
            ));
        }
        return static_cast<std::size_t>(*encoded);
    }

    [[nodiscard]] Result<std::string> string(std::string_view field) {
        auto size = count(field);
        if (!size) return std::unexpected(size.error());
        std::string value;
        value.reserve(*size);
        for (std::size_t index = 0; index < *size; ++index) {
            value.push_back(static_cast<char>(
                std::to_integer<unsigned char>(bytes_[offset_ + index])
            ));
        }
        offset_ += *size;
        return value;
    }

    [[nodiscard]] Result<std::vector<std::byte>> blob(std::string_view field) {
        auto size = count(field);
        if (!size) return std::unexpected(size.error());
        std::vector<std::byte> value;
        value.reserve(*size);
        value.insert(
            value.end(),
            bytes_.begin() + static_cast<std::ptrdiff_t>(offset_),
            bytes_.begin() + static_cast<std::ptrdiff_t>(offset_ + *size)
        );
        offset_ += *size;
        return value;
    }

    [[nodiscard]] Result<void> requireDone() const {
        if (offset_ != bytes_.size()) {
            return std::unexpected(make_error(
                ErrorCode::serialization_failure,
                "transaction checkpoint payload has trailing bytes"
            ));
        }
        return {};
    }

private:
    [[nodiscard]] std::size_t remaining() const noexcept {
        return bytes_.size() - offset_;
    }

    [[nodiscard]] Result<void> require(
        std::size_t count,
        std::string_view field
    ) const {
        if (count > remaining()) {
            return std::unexpected(make_error(
                ErrorCode::serialization_failure,
                "truncated transaction checkpoint " + std::string(field)
            ));
        }
        return {};
    }

    std::span<const std::byte> bytes_;
    std::size_t offset_{};
};

struct ClockTransactionSnapshot final {
    std::uint64_t tick{};
    SpeedMode speed{SpeedMode::normal};
};

std::vector<std::byte> serializeClockCheckpoint(const SimulationClock& clock) {
    CheckpointWriter writer;
    writer.u32(transaction_checkpoint_format_version);
    writer.u64(clock.tick());
    writer.u32(static_cast<std::uint32_t>(clock.speed()));
    return std::move(writer).finish();
}

Result<ClockTransactionSnapshot> deserializeClockCheckpoint(
    std::span<const std::byte> bytes
) {
    CheckpointReader reader(bytes);
    auto version = reader.u32("clock version");
    if (!version) return std::unexpected(version.error());
    if (*version != transaction_checkpoint_format_version) {
        return std::unexpected(make_error(
            ErrorCode::serialization_failure,
            "unsupported transaction checkpoint clock version"
        ));
    }
    auto tick = reader.u64("clock tick");
    if (!tick) return std::unexpected(tick.error());
    auto speed = reader.u32("clock speed");
    if (!speed) return std::unexpected(speed.error());
    if (!validSpeed(*speed)) {
        return std::unexpected(make_error(
            ErrorCode::serialization_failure,
            "invalid transaction checkpoint clock speed"
        ));
    }
    auto done = reader.requireDone();
    if (!done) return std::unexpected(done.error());
    return ClockTransactionSnapshot{*tick, static_cast<SpeedMode>(*speed)};
}

std::vector<std::byte> serializeCommandCheckpoint(
    const CommandQueueSnapshot& snapshot
) {
    CheckpointWriter writer;
    writer.u32(transaction_checkpoint_format_version);
    writer.u64(snapshot.next_sequence);
    writer.u64(static_cast<std::uint64_t>(snapshot.seen_sequences.size()));
    for (const auto sequence : snapshot.seen_sequences) writer.u64(sequence);
    writer.u64(static_cast<std::uint64_t>(snapshot.queue.size()));
    for (const auto& command : snapshot.queue) {
        writer.u32(command.version);
        writer.u64(command.sequence);
        writer.u64(command.tick);
        writer.string(command.type);
        writer.blob(command.payload);
    }
    return std::move(writer).finish();
}

Result<CommandQueueSnapshot> deserializeCommandCheckpoint(
    std::span<const std::byte> bytes
) {
    CheckpointReader reader(bytes);
    auto version = reader.u32("command queue version");
    if (!version) return std::unexpected(version.error());
    if (*version != transaction_checkpoint_format_version) {
        return std::unexpected(make_error(
            ErrorCode::serialization_failure,
            "unsupported transaction checkpoint command queue version"
        ));
    }

    CommandQueueSnapshot snapshot;
    auto next_sequence = reader.u64("command next sequence");
    if (!next_sequence) return std::unexpected(next_sequence.error());
    snapshot.next_sequence = *next_sequence;

    auto seen_count = reader.count("command seen sequence count");
    if (!seen_count) return std::unexpected(seen_count.error());
    for (std::size_t index = 0; index < *seen_count; ++index) {
        auto sequence = reader.u64("command seen sequence");
        if (!sequence) return std::unexpected(sequence.error());
        if (!snapshot.seen_sequences.insert(*sequence).second) {
            return std::unexpected(make_error(
                ErrorCode::serialization_failure,
                "duplicate transaction checkpoint command sequence"
            ));
        }
    }

    auto queue_count = reader.count("command queue count");
    if (!queue_count) return std::unexpected(queue_count.error());
    snapshot.queue.reserve(*queue_count);
    for (std::size_t index = 0; index < *queue_count; ++index) {
        auto command_version = reader.u32("command version");
        if (!command_version) return std::unexpected(command_version.error());
        auto sequence = reader.u64("command sequence");
        if (!sequence) return std::unexpected(sequence.error());
        auto tick = reader.u64("command tick");
        if (!tick) return std::unexpected(tick.error());
        auto type = reader.string("command type");
        if (!type) return std::unexpected(type.error());
        auto payload = reader.blob("command payload");
        if (!payload) return std::unexpected(payload.error());
        snapshot.queue.push_back(CommandEnvelope{
            *sequence,
            *tick,
            std::move(*type),
            std::move(*payload),
            *command_version,
        });
    }

    auto done = reader.requireDone();
    if (!done) return std::unexpected(done.error());
    return snapshot;
}

std::vector<std::byte> serializeEventCheckpoint(
    const DomainEventJournalSnapshot& snapshot
) {
    CheckpointWriter writer;
    writer.u32(transaction_checkpoint_format_version);
    writer.u64(snapshot.next_sequence);
    writer.u64(static_cast<std::uint64_t>(snapshot.events.size()));
    for (const auto& event : snapshot.events) {
        writer.u64(event.sequence);
        writer.u64(event.tick);
        writer.string(event.type);
        writer.string(event.source);
        writer.blob(event.payload);
    }
    return std::move(writer).finish();
}

Result<DomainEventJournalSnapshot> deserializeEventCheckpoint(
    std::span<const std::byte> bytes
) {
    CheckpointReader reader(bytes);
    auto version = reader.u32("event journal version");
    if (!version) return std::unexpected(version.error());
    if (*version != transaction_checkpoint_format_version) {
        return std::unexpected(make_error(
            ErrorCode::serialization_failure,
            "unsupported transaction checkpoint event journal version"
        ));
    }

    DomainEventJournalSnapshot snapshot;
    auto next_sequence = reader.u64("event next sequence");
    if (!next_sequence) return std::unexpected(next_sequence.error());
    snapshot.next_sequence = *next_sequence;

    auto event_count = reader.count("event count");
    if (!event_count) return std::unexpected(event_count.error());
    snapshot.events.reserve(*event_count);
    for (std::size_t index = 0; index < *event_count; ++index) {
        auto sequence = reader.u64("event sequence");
        if (!sequence) return std::unexpected(sequence.error());
        auto tick = reader.u64("event tick");
        if (!tick) return std::unexpected(tick.error());
        auto type = reader.string("event type");
        if (!type) return std::unexpected(type.error());
        auto source = reader.string("event source");
        if (!source) return std::unexpected(source.error());
        auto payload = reader.blob("event payload");
        if (!payload) return std::unexpected(payload.error());
        snapshot.events.push_back(DomainEvent{
            *sequence,
            *tick,
            std::move(*type),
            std::move(*source),
            std::move(*payload),
        });
    }

    auto done = reader.requireDone();
    if (!done) return std::unexpected(done.error());
    return snapshot;
}

std::vector<std::byte> serializeRandomCheckpoint(
    const RandomStreamSnapshot& snapshot
) {
    CheckpointWriter writer;
    writer.u32(transaction_checkpoint_format_version);
    writer.u64(static_cast<std::uint64_t>(snapshot.size()));
    for (const auto& [name, state] : snapshot) {
        writer.string(name);
        writer.u32(state);
    }
    return std::move(writer).finish();
}

Result<RandomStreamSnapshot> deserializeRandomCheckpoint(
    std::span<const std::byte> bytes
) {
    CheckpointReader reader(bytes);
    auto version = reader.u32("random stream version");
    if (!version) return std::unexpected(version.error());
    if (*version != transaction_checkpoint_format_version) {
        return std::unexpected(make_error(
            ErrorCode::serialization_failure,
            "unsupported transaction checkpoint random stream version"
        ));
    }

    RandomStreamSnapshot snapshot;
    auto stream_count = reader.count("random stream count");
    if (!stream_count) return std::unexpected(stream_count.error());
    for (std::size_t index = 0; index < *stream_count; ++index) {
        auto name = reader.string("random stream name");
        if (!name) return std::unexpected(name.error());
        auto state = reader.u32("random stream state");
        if (!state) return std::unexpected(state.error());
        if (!snapshot.emplace(std::move(*name), *state).second) {
            return std::unexpected(make_error(
                ErrorCode::serialization_failure,
                "duplicate transaction checkpoint random stream"
            ));
        }
    }

    auto done = reader.requireDone();
    if (!done) return std::unexpected(done.error());
    return snapshot;
}
} // namespace

EngineConfig EngineConfig::legacyCompatibilityConfig(std::uint32_t seed, std::uint64_t start_tick) {
    EngineConfig config{};
    config.seed = seed;
    config.startTick = start_tick;
    config.demand_weight_mode = DemandWeightMode::legacy_rounded;
    return config;
}

NativeEngine::NativeEngine(const EngineConfig& config)
    : seed_(config.seed),
      demand_weight_mode_(config.demand_weight_mode),
      clock_(config.startTick, config.speed),
      random_(config.seed) {
    (void)invariants_.registerInvariant(InvariantDefinition{
        "kernel-clock-valid", {1, 0}, [](std::uint64_t) -> Result<void> { return {}; }
    });
    (void)snapshots_.registerProvider("kernel", [this]() -> Result<std::string> {
        return kernelCanonicalState();
    });

    const auto register_participant = [this](TransactionParticipant participant) {
        const auto id = participant.id;
        auto registered = transaction_checkpoint_.registerParticipant(std::move(participant));
        if (!registered) {
            throw std::logic_error(
                "failed to register native transaction participant " + id +
                ": " + registered.error().message
            );
        }
    };

    register_participant(TransactionParticipant{
        "kernel-clock",
        [this]() -> Result<std::vector<std::byte>> {
            return serializeClockCheckpoint(clock_);
        },
        [this](std::span<const std::byte> payload) -> Result<void> {
            auto snapshot = deserializeClockCheckpoint(payload);
            if (!snapshot) return std::unexpected(snapshot.error());
            clock_.restore(snapshot->tick, snapshot->speed);
            return {};
        },
    });

    register_participant(TransactionParticipant{
        "kernel-command-queue",
        [this]() -> Result<std::vector<std::byte>> {
            return serializeCommandCheckpoint(commands_.snapshot());
        },
        [this](std::span<const std::byte> payload) -> Result<void> {
            auto snapshot = deserializeCommandCheckpoint(payload);
            if (!snapshot) return std::unexpected(snapshot.error());
            return commands_.restore(*snapshot);
        },
    });

    register_participant(TransactionParticipant{
        "kernel-event-journal",
        [this]() -> Result<std::vector<std::byte>> {
            return serializeEventCheckpoint(events_.snapshot());
        },
        [this](std::span<const std::byte> payload) -> Result<void> {
            auto snapshot = deserializeEventCheckpoint(payload);
            if (!snapshot) return std::unexpected(snapshot.error());
            return events_.restore(*snapshot);
        },
    });

    register_participant(TransactionParticipant{
        "kernel-random-streams",
        [this]() -> Result<std::vector<std::byte>> {
            return serializeRandomCheckpoint(random_.snapshot());
        },
        [this](std::span<const std::byte> payload) -> Result<void> {
            auto snapshot = deserializeRandomCheckpoint(payload);
            if (!snapshot) return std::unexpected(snapshot.error());
            return random_.restore(*snapshot);
        },
    });
}

Result<std::unique_ptr<NativeEngine>> NativeEngine::create(const EngineConfig& config) {
    try {
        return std::unique_ptr<NativeEngine>(new NativeEngine(config));
    } catch (const std::exception& error) {
        return std::unexpected(make_error(ErrorCode::internal_error, error.what()));
    } catch (...) {
        return std::unexpected(make_error(ErrorCode::internal_error, "unknown native engine creation failure"));
    }
}

Result<void> NativeEngine::rejectIfFaulted() const {
    if (!fault_) return {};
    return std::unexpected(make_error(
        ErrorCode::invalid_state,
        "kernel is faulted: " + fault_->message
    ));
}

Result<void> NativeEngine::submit(std::span<const CommandEnvelope> commands) {
    auto mutable_state = rejectIfFaulted();
    if (!mutable_state) return mutable_state;
    return commands_.submit(commands, clock_.tick());
}

Result<void> NativeEngine::registerSystem(SystemDefinition system) {
    auto mutable_state = rejectIfFaulted();
    if (!mutable_state) return mutable_state;
    auto registered = scheduler_.registerSystem(std::move(system));
    if (!registered) return registered;
    dirty_ = true;
    return {};
}

Result<void> NativeEngine::step(std::uint64_t ticks) {
    auto mutable_state = rejectIfFaulted();
    if (!mutable_state) return mutable_state;
    if (ticks == 0) return {};

    if (dirty_) {
        auto compiled = scheduler_.compile();
        if (!compiled) return compiled;
        dirty_ = false;
    }

    for (std::uint64_t index = 0; index < ticks; ++index) {
        auto checkpoint = transaction_checkpoint_.capture();
        if (!checkpoint) return std::unexpected(checkpoint.error());

        auto rollback = [&]() -> Result<void> {
            return transaction_checkpoint_.restore(
                std::span<const TransactionSnapshot>{*checkpoint}
            );
        };

        auto fail_tick = [&](const Error& error) -> Result<void> {
            auto restored = rollback();
            if (!restored) {
                fault_ = make_error(
                    ErrorCode::internal_error,
                    error.message + "; kernel rollback failed: " + restored.error().message
                );
                return std::unexpected(*fault_);
            }
            fault_ = error;
            return std::unexpected(error);
        };

        auto advanced = clock_.step(1);
        if (!advanced) return fail_tick(advanced.error());

        auto ready = commands_.takeReady(clock_.tick());
        for (const auto& command : ready) {
            auto appended = events_.append(
                clock_.tick(),
                command.type,
                "shadow-command",
                command.payload
            );
            if (!appended) return fail_tick(appended.error());
        }

        auto due = scheduler_.dueSystems(clock_.tick());
        if (!due) return fail_tick(due.error());
        for (auto* system : *due) {
            if (!system->execute) continue;
            auto executed = system->execute(clock_.tick());
            if (!executed) return fail_tick(executed.error());
        }

        auto valid = invariants_.runDue(clock_.tick());
        if (!valid) return fail_tick(valid.error());
    }
    return {};
}

std::string NativeEngine::kernelCanonicalState() const {
    std::ostringstream out;
    out << "{\"hashVersion\":1,\"pendingCommands\":[";
    bool first = true;
    for (const auto& command : commands_.pending()) {
        if (!first) out << ',';
        first = false;
        out << "{\"payload\":" << escapeJson(bytesToString(command.payload))
            << ",\"sequence\":" << command.sequence
            << ",\"tick\":" << command.tick
            << ",\"type\":" << escapeJson(command.type) << '}';
    }
    out << "],\"randomStreams\":{";
    first = true;
    for (const auto& [name, state] : random_.snapshot()) {
        if (!first) out << ',';
        first = false;
        out << escapeJson(name) << ':' << state;
    }
    out << "},\"seed\":" << seed_
        << ",\"speed\":" << static_cast<std::uint32_t>(clock_.speed())
        << ",\"tick\":" << clock_.tick() << '}';
    return out.str();
}

Result<SnapshotBlob> NativeEngine::snapshot() const {
    auto captured = snapshots_.capture("kernel");
    if (!captured) return std::unexpected(captured.error());
    return SnapshotBlob{std::move(*captured)};
}

Result<EventBlob> NativeEngine::drainEvents() {
    auto drained = events_.drain();
    std::ostringstream out;
    out << '[';
    for (std::size_t i = 0; i < drained.size(); ++i) {
        if (i != 0) out << ',';
        const auto& event = drained[i];
        out << "{\"payload\":" << escapeJson(bytesToString(event.payload))
            << ",\"sequence\":" << event.sequence
            << ",\"source\":" << escapeJson(event.source)
            << ",\"tick\":" << event.tick
            << ",\"type\":" << escapeJson(event.type) << '}';
    }
    out << ']';
    return EventBlob{out.str()};
}

std::uint64_t NativeEngine::fnv1a64(std::string_view bytes) noexcept {
    std::uint64_t hash = 14695981039346656037ULL;
    for (const unsigned char byte : bytes) {
        hash ^= byte;
        hash *= 1099511628211ULL;
    }
    return hash;
}

Result<DomainHash> NativeEngine::domainHash(std::string_view domain) const {
    if (domain == "kernel") {
        auto captured = snapshots_.capture("kernel");
        if (!captured) return std::unexpected(captured.error());
        return DomainHash{DomainOwnership::owned, 1, fnv1a64(*captured)};
    }
    static constexpr std::string_view unowned[] = {
        "world", "cadastre", "buildings", "transportation", "population", "economy", "services"
    };
    if (std::ranges::find(unowned, domain) != std::end(unowned)) {
        return DomainHash{DomainOwnership::unowned, 1, 0};
    }
    return std::unexpected(make_error(
        ErrorCode::invalid_argument,
        "unknown domain hash: " + std::string{domain}
    ));
}

Result<void> NativeEngine::loadV9(std::string_view json) {
    auto mutable_state = rejectIfFaulted();
    if (!mutable_state) return mutable_state;

    auto parsed = parseSaveV9(json);
    if (!parsed) return std::unexpected(parsed.error());
    seed_ = parsed->seed;
    clock_.restore(parsed->tick, parsed->speed);
    random_ = RandomStreamRegistry(seed_);
    commands_ = CommandQueue{};
    events_ = DomainEventJournal{};
    loaded_save_ = std::move(*parsed);
    return {};
}

Result<std::string> NativeEngine::saveV9() const {
    if (!loaded_save_) {
        return std::unexpected(make_error(ErrorCode::invalid_state, "no Save V9 is loaded"));
    }
    return loaded_save_->canonicalJson;
}

} // namespace civic
