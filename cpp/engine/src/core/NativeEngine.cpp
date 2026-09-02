#include <civic/core/NativeEngine.hpp>
#include <civic/persistence/TransportationSaveV9.hpp>

#include <algorithm>
#include <cstring>
#include <limits>
#include <sstream>

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
} // namespace

NativeEngine::NativeEngine(const EngineConfig& config) : seed_(config.seed), clock_(config.startTick, config.speed), random_(config.seed) {
    (void)invariants_.registerInvariant(InvariantDefinition{
        "kernel-clock-valid", {1, 0}, [](std::uint64_t) -> Result<void> { return {}; }
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

Result<void> NativeEngine::submit(std::span<const CommandEnvelope> commands) { return commands_.submit(commands, clock_.tick()); }

Result<void> NativeEngine::step(std::uint64_t ticks) {
    if (ticks == 0) return {};
    for (std::uint64_t index = 0; index < ticks; ++index) {
        const auto checkpoint_clock = clock_;
        const auto checkpoint_commands = commands_;
        const auto checkpoint_events = events_;
        const auto checkpoint_random = random_;
        auto rollback = [&] {
            clock_ = checkpoint_clock;
            commands_ = checkpoint_commands;
            events_ = checkpoint_events;
            random_ = checkpoint_random;
        };
        auto advanced = clock_.step(1);
        if (!advanced) { rollback(); return advanced; }
        auto ready = commands_.takeReady(clock_.tick());
        for (const auto& command : ready) events_.append(clock_.tick(), command.type, "shadow-command", command.payload);
        auto due = scheduler_.dueSystems(clock_.tick());
        if (!due) { rollback(); return std::unexpected(due.error()); }
        for (auto* system : *due) {
            if (!system->execute) continue;
            auto executed = system->execute(clock_.tick());
            if (!executed) { rollback(); return executed; }
        }
        auto valid = invariants_.runDue(clock_.tick());
        if (!valid) { rollback(); return valid; }
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
    if (domain == "transportation") return DomainHash{DomainOwnership::owned, 1, transportation_.domain_hash()};
    static constexpr std::string_view unowned[] = {"world", "cadastre", "buildings", "population", "economy", "services"};
    if (std::ranges::find(unowned, domain) != std::end(unowned)) return DomainHash{DomainOwnership::unowned, 1, 0};
    return std::unexpected(make_error(ErrorCode::invalid_argument, "unknown domain hash: " + std::string{domain}));
}

Result<void> NativeEngine::loadV9(std::string_view json) {
    auto parsed = parseSaveV9(json); if (!parsed) return std::unexpected(parsed.error());
    auto transportation = parseTransportationV9(parsed->canonicalJson); if (!transportation) return std::unexpected(transportation.error());
    transport::TransportationAuthority nextTransportation;
    try {
        nextTransportation.restore(*transportation);
    } catch (const std::exception& error) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, error.what()));
    } catch (...) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "unknown transportation restore failure"));
    }
    seed_ = parsed->seed;
    clock_.restore(parsed->tick, parsed->speed);
    random_ = RandomStreamRegistry(seed_);
    commands_ = CommandQueue{};
    events_ = DomainEventJournal{};
    transportation_ = std::move(nextTransportation);
    loaded_save_ = std::move(*parsed);
    return {};
}

Result<std::string> NativeEngine::saveV9() const {
    if (!loaded_save_) return std::unexpected(make_error(ErrorCode::invalid_state, "no Save V9 is loaded"));
    return loaded_save_->canonicalJson;
}

} // namespace civic
