#include <civic/core/NativeEngine.hpp>

#include <civic/transport/RoadTrafficRuntime.hpp>
#include <civic/transport/TransportationCommands.hpp>

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
                } else output.push_back(static_cast<char>(ch));
        }
    }
    output.push_back('"'); return output;
}
std::string bytesToString(const std::vector<std::byte>& bytes) {
    return std::string(reinterpret_cast<const char*>(bytes.data()), bytes.size());
}
} // namespace

NativeEngine::NativeEngine(const EngineConfig& config) : seed_(config.seed), clock_(config.startTick, config.speed), random_(config.seed) {
    (void)invariants_.registerInvariant(InvariantDefinition{"kernel-clock-valid", {1, 0}, [](std::uint64_t) -> Result<void> { return {}; }});
}

Result<std::unique_ptr<NativeEngine>> NativeEngine::create(const EngineConfig& config) {
    try { return std::unique_ptr<NativeEngine>(new NativeEngine(config)); }
    catch (const std::exception& error) { return std::unexpected(make_error(ErrorCode::internal_error, error.what())); }
    catch (...) { return std::unexpected(make_error(ErrorCode::internal_error, "unknown native engine creation failure")); }
}

Result<void> NativeEngine::submit(std::span<const CommandEnvelope> commands) { return commands_.submit(commands, clock_.tick()); }

Result<void> NativeEngine::applyReadyCommands() {
    const auto checkpoint_commands = commands_;
    const auto checkpoint_events = events_;
    const auto checkpoint_transportation = transportation_;
    const auto checkpoint_legacy_roads = legacy_roads_;
    const auto checkpoint_continuation = transportation_continuation_;
    auto rollback = [&] {
        commands_ = checkpoint_commands;
        events_ = checkpoint_events;
        transportation_ = checkpoint_transportation;
        legacy_roads_ = checkpoint_legacy_roads;
        transportation_continuation_ = checkpoint_continuation;
    };
    auto ready = commands_.takeReady(clock_.tick());
    for (const auto& command : ready) {
        auto applied = applyTransportationCommand(transportation_, legacy_roads_, command);
        if (!applied) { rollback(); return std::unexpected(applied.error()); }
        events_.append(clock_.tick(), command.type, *applied ? "transportation-native" : "shadow-command", command.payload);
    }
    return {};
}

Result<void> NativeEngine::step(std::uint64_t ticks) {
    if (ticks == 0) return {};
    for (std::uint64_t index = 0; index < ticks; ++index) {
        const auto checkpoint_clock = clock_;
        const auto checkpoint_commands = commands_;
        const auto checkpoint_events = events_;
        const auto checkpoint_random = random_;
        const auto checkpoint_transportation = transportation_;
        const auto checkpoint_legacy_roads = legacy_roads_;
        const auto checkpoint_continuation = transportation_continuation_;
        auto rollback = [&] {
            clock_ = checkpoint_clock; commands_ = checkpoint_commands; events_ = checkpoint_events; random_ = checkpoint_random;
            transportation_ = checkpoint_transportation; legacy_roads_ = checkpoint_legacy_roads; transportation_continuation_ = checkpoint_continuation;
        };
        auto advanced = clock_.step(1);
        if (!advanced) { rollback(); return advanced; }
        auto commandsApplied = applyReadyCommands();
        if (!commandsApplied) { rollback(); return commandsApplied; }
        try {
            transportation_.incidents().step(clock_.tick());
            const auto network = transportation_.network().snapshot();
            (void)transport::step_road_traffic(transportation_.road_traffic(), network, transportation_.controls(), transportation_.incidents(), clock_.tick());
            transportation_.traffic().restore(transportation_.road_traffic().flow_snapshot());
        } catch (const std::exception& error) {
            rollback(); return std::unexpected(make_error(ErrorCode::invalid_state, error.what()));
        }
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
    std::ostringstream out; out << "{\"hashVersion\":1,\"pendingCommands\":[";
    bool first = true;
    for (const auto& command : commands_.pending()) {
        if (!first) out << ','; first = false;
        out << "{\"payload\":" << escapeJson(bytesToString(command.payload)) << ",\"sequence\":" << command.sequence
            << ",\"tick\":" << command.tick << ",\"type\":" << escapeJson(command.type) << '}';
    }
    out << "],\"randomStreams\":{"; first = true;
    for (const auto& [name, state] : random_.snapshot()) { if (!first) out << ','; first = false; out << escapeJson(name) << ':' << state; }
    out << "},\"seed\":" << seed_ << ",\"speed\":" << static_cast<std::uint32_t>(clock_.speed()) << ",\"tick\":" << clock_.tick() << '}';
    return out.str();
}

Result<SnapshotBlob> NativeEngine::snapshot() const {
    auto transportationJson = transportationSnapshotJson(transportation_.snapshot());
    if (!transportationJson) return std::unexpected(transportationJson.error());
    auto json = kernelCanonicalState();
    if (json.empty() || json.back() != '}') return std::unexpected(make_error(ErrorCode::internal_error, "kernel snapshot is not an object"));
    json.pop_back(); json += ",\"transportation\":"; json += *transportationJson; json.push_back('}');
    return SnapshotBlob{std::move(json)};
}

Result<EventBlob> NativeEngine::drainEvents() {
    auto drained = events_.drain(); std::ostringstream out; out << '[';
    for (std::size_t i = 0; i < drained.size(); ++i) {
        if (i != 0) out << ','; const auto& event = drained[i];
        out << "{\"payload\":" << escapeJson(bytesToString(event.payload)) << ",\"sequence\":" << event.sequence
            << ",\"source\":" << escapeJson(event.source) << ",\"tick\":" << event.tick << ",\"type\":" << escapeJson(event.type) << '}';
    }
    out << ']'; return EventBlob{out.str()};
}

std::uint64_t NativeEngine::fnv1a64(std::string_view bytes) noexcept { std::uint64_t hash = 14695981039346656037ULL; for (const unsigned char byte : bytes) { hash ^= byte; hash *= 1099511628211ULL; } return hash; }
std::uint64_t NativeEngine::transportationDomainHash() const { const auto nativeHash = transportation_.domain_hash(); if (transportation_continuation_.canonical.empty()) return nativeHash; std::ostringstream canonical; canonical << nativeHash << ':' << transportation_continuation_.canonical; return fnv1a64(canonical.str()); }

Result<DomainHash> NativeEngine::domainHash(std::string_view domain) const {
    if (domain == "kernel") return DomainHash{DomainOwnership::owned, 1, fnv1a64(kernelCanonicalState())};
    if (domain == "transportation") return DomainHash{DomainOwnership::owned, 1, transportationDomainHash()};
    static constexpr std::string_view unowned[] = {"world", "cadastre", "buildings", "population", "economy", "services"};
    if (std::ranges::find(unowned, domain) != std::end(unowned)) return DomainHash{DomainOwnership::unowned, 1, 0};
    return std::unexpected(make_error(ErrorCode::invalid_argument, "unknown domain hash: " + std::string{domain}));
}

Result<void> NativeEngine::loadV9(std::string_view json) {
    auto parsed = parseSaveV9(json); if (!parsed) return std::unexpected(parsed.error());
    auto legacyRoads = parseLegacyRoadAuthorityV9(parsed->canonicalJson); if (!legacyRoads) return std::unexpected(legacyRoads.error());
    auto nativeTransportation = parseNativeTransportationV9(parsed->canonicalJson); if (!nativeTransportation) return std::unexpected(nativeTransportation.error());
    transport::TransportationSnapshot transportation;
    if (nativeTransportation->has_value()) transportation = std::move(nativeTransportation->value());
    else {
        auto migrated = parseTransportationV9(parsed->canonicalJson); if (!migrated) return std::unexpected(migrated.error()); transportation = std::move(*migrated);
        auto roadTraffic = parseLegacyRoadTrafficV9(parsed->canonicalJson, transportation.network); if (!roadTraffic) return std::unexpected(roadTraffic.error());
        auto traffic = deriveTrafficFlowV9(transportation.network, *roadTraffic); if (!traffic) return std::unexpected(traffic.error());
        transportation.road_traffic = std::move(*roadTraffic); transportation.traffic = std::move(*traffic);
    }
    auto continuation = parseTransportationContinuationV9(parsed->canonicalJson); if (!continuation) return std::unexpected(continuation.error());
    transport::TransportationAuthority nextTransportation;
    try { nextTransportation.restore(transportation); }
    catch (const std::exception& error) { return std::unexpected(make_error(ErrorCode::serialization_failure, error.what())); }
    catch (...) { return std::unexpected(make_error(ErrorCode::serialization_failure, "unknown transportation restore failure")); }
    seed_ = parsed->seed; clock_.restore(parsed->tick, parsed->speed); random_ = RandomStreamRegistry(seed_); commands_ = CommandQueue{}; events_ = DomainEventJournal{};
    transportation_ = std::move(nextTransportation); legacy_roads_ = std::move(*legacyRoads); transportation_continuation_ = std::move(*continuation); loaded_save_ = std::move(*parsed); return {};
}

Result<std::string> NativeEngine::saveV9() const {
    if (!loaded_save_) return std::unexpected(make_error(ErrorCode::invalid_state, "no Save V9 is loaded"));
    return writeNativeEngineV9(loaded_save_->canonicalJson, legacy_roads_, transportation_.snapshot(), clock_.tick(), static_cast<std::uint32_t>(clock_.speed()));
}

} // namespace civic
