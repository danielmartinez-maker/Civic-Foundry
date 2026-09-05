#include <civic/core/NativeEngine.hpp>

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <sstream>
#include <utility>

namespace civic {
namespace {
using ByteBuffer = std::vector<std::byte>;

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

void appendU32(ByteBuffer& output, std::uint32_t value) {
    for (std::uint32_t shift = 0; shift < 32U; shift += 8U) {
        output.push_back(static_cast<std::byte>((value >> shift) & 0xffU));
    }
}

void appendU64(ByteBuffer& output, std::uint64_t value) {
    for (std::uint32_t shift = 0; shift < 64U; shift += 8U) {
        output.push_back(static_cast<std::byte>((value >> shift) & 0xffULL));
    }
}

void appendString(ByteBuffer& output, std::string_view value) {
    appendU64(output, static_cast<std::uint64_t>(value.size()));
    for (const char ch : value) {
        output.push_back(static_cast<std::byte>(static_cast<unsigned char>(ch)));
    }
}

void appendBytes(ByteBuffer& output, std::span<const std::byte> value) {
    appendU64(output, static_cast<std::uint64_t>(value.size()));
    output.insert(output.end(), value.begin(), value.end());
}

class ByteReader final {
public:
    ByteReader(std::span<const std::byte> input, std::string_view participant)
        : input_(input), participant_(participant) {}

    [[nodiscard]] Result<std::uint32_t> u32(std::string_view field) {
        if (remaining() < 4U) return truncated(field);
        std::uint32_t value = 0;
        for (std::uint32_t index = 0; index < 4U; ++index) {
            value |= static_cast<std::uint32_t>(std::to_integer<unsigned char>(input_[offset_++])) << (index * 8U);
        }
        return value;
    }

    [[nodiscard]] Result<std::uint64_t> u64(std::string_view field) {
        if (remaining() < 8U) return truncated(field);
        std::uint64_t value = 0;
        for (std::uint32_t index = 0; index < 8U; ++index) {
            value |= static_cast<std::uint64_t>(std::to_integer<unsigned char>(input_[offset_++])) << (index * 8U);
        }
        return value;
    }

    [[nodiscard]] Result<std::size_t> count(std::string_view field) {
        auto raw = u64(field);
        if (!raw) return std::unexpected(raw.error());
        if (*raw > static_cast<std::uint64_t>(std::numeric_limits<std::size_t>::max())) {
            return invalid(field, "length exceeds native address space");
        }
        const auto value = static_cast<std::size_t>(*raw);
        if (value > remaining()) {
            return invalid(field, "container count exceeds remaining payload");
        }
        return value;
    }

    [[nodiscard]] Result<std::string> string(std::string_view field) {
        auto length = u64(field);
        if (!length) return std::unexpected(length.error());
        if (*length > static_cast<std::uint64_t>(std::numeric_limits<std::size_t>::max())) {
            return invalid(field, "string length exceeds native address space");
        }
        const auto size = static_cast<std::size_t>(*length);
        if (size > remaining()) return truncated(field);

        std::string value;
        value.reserve(size);
        for (std::size_t index = 0; index < size; ++index) {
            value.push_back(static_cast<char>(std::to_integer<unsigned char>(input_[offset_ + index])));
        }
        offset_ += size;
        return value;
    }

    [[nodiscard]] Result<ByteBuffer> bytes(std::string_view field) {
        auto length = u64(field);
        if (!length) return std::unexpected(length.error());
        if (*length > static_cast<std::uint64_t>(std::numeric_limits<std::size_t>::max())) {
            return invalid(field, "byte length exceeds native address space");
        }
        const auto size = static_cast<std::size_t>(*length);
        if (size > remaining()) return truncated(field);

        ByteBuffer value;
        value.reserve(size);
        value.insert(value.end(), input_.begin() + static_cast<std::ptrdiff_t>(offset_), input_.begin() + static_cast<std::ptrdiff_t>(offset_ + size));
        offset_ += size;
        return value;
    }

    [[nodiscard]] Result<void> finish() const {
        if (offset_ != input_.size()) {
            return std::unexpected(make_error(
                ErrorCode::serialization_failure,
                "invalid " + participant_ + " transaction checkpoint payload: trailing bytes"
            ));
        }
        return {};
    }

    [[nodiscard]] std::size_t remaining() const noexcept { return input_.size() - offset_; }

private:
    template<class T>
    [[nodiscard]] Result<T> truncated(std::string_view field) const {
        return std::unexpected(make_error(
            ErrorCode::serialization_failure,
            "invalid " + participant_ + " transaction checkpoint payload: truncated " + std::string{field}
        ));
    }

    template<class T>
    [[nodiscard]] Result<T> invalid(std::string_view field, std::string_view reason) const {
        return std::unexpected(make_error(
            ErrorCode::serialization_failure,
            "invalid " + participant_ + " transaction checkpoint payload: " + std::string{field} + " " + std::string{reason}
        ));
    }

    std::span<const std::byte> input_;
    std::string participant_;
    std::size_t offset_{};
};

ByteBuffer encodeClock(const SimulationClock& clock) {
    ByteBuffer output;
    output.reserve(12U);
    appendU64(output, clock.tick());
    appendU32(output, static_cast<std::uint32_t>(clock.speed()));
    return output;
}

Result<void> restoreClock(std::span<const std::byte> payload, SimulationClock& clock) {
    ByteReader reader(payload, "clock");
    auto tick = reader.u64("tick");
    if (!tick) return std::unexpected(tick.error());
    auto raw_speed = reader.u32("speed");
    if (!raw_speed) return std::unexpected(raw_speed.error());
    if (!validSpeed(*raw_speed)) {
        return std::unexpected(make_error(
            ErrorCode::serialization_failure,
            "invalid clock transaction checkpoint payload: unsupported speed"
        ));
    }
    auto finished = reader.finish();
    if (!finished) return finished;
    clock.restore(*tick, static_cast<SpeedMode>(*raw_speed));
    return {};
}

ByteBuffer encodeCommands(const CommandQueueSnapshot& snapshot) {
    ByteBuffer output;
    appendU64(output, snapshot.next_sequence);
    appendU64(output, static_cast<std::uint64_t>(snapshot.seen_sequences.size()));
    for (const auto sequence : snapshot.seen_sequences) appendU64(output, sequence);
    appendU64(output, static_cast<std::uint64_t>(snapshot.queue.size()));
    for (const auto& command : snapshot.queue) {
        appendU64(output, command.sequence);
        appendU64(output, command.tick);
        appendU32(output, command.version);
        appendString(output, command.type);
        appendBytes(output, command.payload);
    }
    return output;
}

Result<void> restoreCommands(std::span<const std::byte> payload, CommandQueue& commands) {
    ByteReader reader(payload, "commands");
    CommandQueueSnapshot snapshot;

    auto next_sequence = reader.u64("next sequence");
    if (!next_sequence) return std::unexpected(next_sequence.error());
    snapshot.next_sequence = *next_sequence;

    auto seen_count = reader.count("seen sequence count");
    if (!seen_count) return std::unexpected(seen_count.error());
    for (std::size_t index = 0; index < *seen_count; ++index) {
        auto sequence = reader.u64("seen sequence");
        if (!sequence) return std::unexpected(sequence.error());
        if (!snapshot.seen_sequences.insert(*sequence).second) {
            return std::unexpected(make_error(
                ErrorCode::serialization_failure,
                "invalid commands transaction checkpoint payload: duplicate seen sequence"
            ));
        }
    }

    auto queue_count = reader.count("queue count");
    if (!queue_count) return std::unexpected(queue_count.error());
    snapshot.queue.reserve(*queue_count);
    for (std::size_t index = 0; index < *queue_count; ++index) {
        CommandEnvelope command;
        auto sequence = reader.u64("command sequence");
        if (!sequence) return std::unexpected(sequence.error());
        command.sequence = *sequence;
        auto tick = reader.u64("command tick");
        if (!tick) return std::unexpected(tick.error());
        command.tick = *tick;
        auto version = reader.u32("command version");
        if (!version) return std::unexpected(version.error());
        command.version = *version;
        auto type = reader.string("command type");
        if (!type) return std::unexpected(type.error());
        command.type = std::move(*type);
        auto command_payload = reader.bytes("command payload");
        if (!command_payload) return std::unexpected(command_payload.error());
        command.payload = std::move(*command_payload);
        snapshot.queue.push_back(std::move(command));
    }

    auto finished = reader.finish();
    if (!finished) return finished;
    return commands.restore(snapshot);
}

ByteBuffer encodeEvents(const DomainEventJournalSnapshot& snapshot) {
    ByteBuffer output;
    appendU64(output, snapshot.next_sequence);
    appendU64(output, static_cast<std::uint64_t>(snapshot.events.size()));
    for (const auto& event : snapshot.events) {
        appendU64(output, event.sequence);
        appendU64(output, event.tick);
        appendString(output, event.type);
        appendString(output, event.source);
        appendBytes(output, event.payload);
    }
    return output;
}

Result<void> restoreEvents(std::span<const std::byte> payload, DomainEventJournal& events) {
    ByteReader reader(payload, "events");
    DomainEventJournalSnapshot snapshot;

    auto next_sequence = reader.u64("next sequence");
    if (!next_sequence) return std::unexpected(next_sequence.error());
    snapshot.next_sequence = *next_sequence;

    auto event_count = reader.count("event count");
    if (!event_count) return std::unexpected(event_count.error());
    snapshot.events.reserve(*event_count);
    for (std::size_t index = 0; index < *event_count; ++index) {
        DomainEvent event;
        auto sequence = reader.u64("event sequence");
        if (!sequence) return std::unexpected(sequence.error());
        event.sequence = *sequence;
        auto tick = reader.u64("event tick");
        if (!tick) return std::unexpected(tick.error());
        event.tick = *tick;
        auto type = reader.string("event type");
        if (!type) return std::unexpected(type.error());
        event.type = std::move(*type);
        auto source = reader.string("event source");
        if (!source) return std::unexpected(source.error());
        event.source = std::move(*source);
        auto event_payload = reader.bytes("event payload");
        if (!event_payload) return std::unexpected(event_payload.error());
        event.payload = std::move(*event_payload);
        snapshot.events.push_back(std::move(event));
    }

    auto finished = reader.finish();
    if (!finished) return finished;
    return events.restore(snapshot);
}

ByteBuffer encodeRandom(const RandomStreamSnapshot& snapshot) {
    ByteBuffer output;
    appendU64(output, static_cast<std::uint64_t>(snapshot.size()));
    for (const auto& [name, state] : snapshot) {
        appendString(output, name);
        appendU32(output, state);
    }
    return output;
}

Result<void> restoreRandom(std::span<const std::byte> payload, RandomStreamRegistry& random) {
    ByteReader reader(payload, "random");
    RandomStreamSnapshot snapshot;

    auto stream_count = reader.count("stream count");
    if (!stream_count) return std::unexpected(stream_count.error());
    for (std::size_t index = 0; index < *stream_count; ++index) {
        auto name = reader.string("stream name");
        if (!name) return std::unexpected(name.error());
        auto state = reader.u32("stream state");
        if (!state) return std::unexpected(state.error());
        if (!snapshot.emplace(std::move(*name), *state).second) {
            return std::unexpected(make_error(
                ErrorCode::serialization_failure,
                "invalid random transaction checkpoint payload: duplicate stream name"
            ));
        }
    }

    auto finished = reader.finish();
    if (!finished) return finished;
    return random.restore(snapshot);
}
} // namespace

NativeEngine::NativeEngine(const EngineConfig& config) : seed_(config.seed), clock_(config.startTick, config.speed), random_(config.seed) {
    (void)invariants_.registerInvariant(InvariantDefinition{
        "kernel-clock-valid", {1, 0}, [](std::uint64_t) -> Result<void> { return {}; }
    });
}

Result<std::unique_ptr<NativeEngine>> NativeEngine::create(const EngineConfig& config) {
    try {
        auto engine = std::unique_ptr<NativeEngine>(new NativeEngine(config));
        auto registered = engine->registerKernelCheckpointParticipants();
        if (!registered) return std::unexpected(registered.error());
        return engine;
    } catch (const std::exception& error) {
        return std::unexpected(make_error(ErrorCode::internal_error, error.what()));
    } catch (...) {
        return std::unexpected(make_error(ErrorCode::internal_error, "unknown native engine creation failure"));
    }
}

Result<void> NativeEngine::registerKernelCheckpointParticipants() {
    auto registered = transaction_checkpoint_.registerParticipant(TransactionParticipant{
        "clock",
        [this]() -> Result<ByteBuffer> { return encodeClock(clock_); },
        [this](std::span<const std::byte> payload) -> Result<void> { return restoreClock(payload, clock_); },
    });
    if (!registered) return registered;

    registered = transaction_checkpoint_.registerParticipant(TransactionParticipant{
        "commands",
        [this]() -> Result<ByteBuffer> { return encodeCommands(commands_.snapshot()); },
        [this](std::span<const std::byte> payload) -> Result<void> { return restoreCommands(payload, commands_); },
    });
    if (!registered) return registered;

    registered = transaction_checkpoint_.registerParticipant(TransactionParticipant{
        "events",
        [this]() -> Result<ByteBuffer> { return encodeEvents(events_.snapshot()); },
        [this](std::span<const std::byte> payload) -> Result<void> { return restoreEvents(payload, events_); },
    });
    if (!registered) return registered;

    return transaction_checkpoint_.registerParticipant(TransactionParticipant{
        "random",
        [this]() -> Result<ByteBuffer> { return encodeRandom(random_.snapshot()); },
        [this](std::span<const std::byte> payload) -> Result<void> { return restoreRandom(payload, random_); },
    });
}

Result<void> NativeEngine::rejectIfFaulted() const {
    if (!fault_) return {};
    return std::unexpected(make_error(ErrorCode::invalid_state, "kernel is faulted: " + fault_->message));
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

        auto fail_tick = [&](const Error& error) -> Result<void> {
            auto restored = transaction_checkpoint_.restore(*checkpoint);
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
            auto appended = events_.append(clock_.tick(), command.type, "shadow-command", command.payload);
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
    out << "},\"seed\":" << seed_ << ",\"speed\":" << static_cast<std::uint32_t>(clock_.speed()) << ",\"tick\":" << clock_.tick() << '}';
    return out.str();
}

Result<SnapshotBlob> NativeEngine::snapshot() const { return SnapshotBlob{kernelCanonicalState()}; }

Result<EventBlob> NativeEngine::drainEvents() {
    auto drained = events_.drain();
    std::ostringstream out; out << '[';
    for (std::size_t i = 0; i < drained.size(); ++i) {
        if (i != 0) out << ',';
        const auto& event = drained[i];
        out << "{\"payload\":" << escapeJson(bytesToString(event.payload))
            << ",\"sequence\":" << event.sequence
            << ",\"source\":" << escapeJson(event.source)
            << ",\"tick\":" << event.tick
            << ",\"type\":" << escapeJson(event.type) << '}';
    }
    out << ']'; return EventBlob{out.str()};
}

std::uint64_t NativeEngine::fnv1a64(std::string_view bytes) noexcept {
    std::uint64_t hash = 14695981039346656037ULL;
    for (const unsigned char byte : bytes) { hash ^= byte; hash *= 1099511628211ULL; }
    return hash;
}

Result<DomainHash> NativeEngine::domainHash(std::string_view domain) const {
    if (domain == "kernel") return DomainHash{DomainOwnership::owned, 1, fnv1a64(kernelCanonicalState())};
    static constexpr std::string_view unowned[] = {"world", "cadastre", "buildings", "transportation", "population", "economy", "services"};
    if (std::ranges::find(unowned, domain) != std::end(unowned)) return DomainHash{DomainOwnership::unowned, 1, 0};
    return std::unexpected(make_error(ErrorCode::invalid_argument, "unknown domain hash: " + std::string{domain}));
}

Result<void> NativeEngine::loadV9(std::string_view json) {
    auto mutable_state = rejectIfFaulted();
    if (!mutable_state) return mutable_state;

    auto parsed = parseSaveV9(json); if (!parsed) return std::unexpected(parsed.error());
    seed_ = parsed->seed;
    clock_.restore(parsed->tick, parsed->speed);
    random_ = RandomStreamRegistry(seed_);
    commands_ = CommandQueue{};
    events_ = DomainEventJournal{};
    loaded_save_ = std::move(*parsed);
    return {};
}

Result<std::string> NativeEngine::saveV9() const {
    if (!loaded_save_) return std::unexpected(make_error(ErrorCode::invalid_state, "no Save V9 is loaded"));
    return loaded_save_->canonicalJson;
}

} // namespace civic
