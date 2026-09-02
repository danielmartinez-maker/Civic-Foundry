#include <civic/core/NativeEngine.hpp>

#include <algorithm>
#include <cstring>
#include <limits>
#include <memory>
#include <sstream>
#include <string>

#include <json-c/json.h>

#include <civic/socioeconomic/SocioeconomicPersistence.hpp>

namespace civic {
namespace {
constexpr std::string_view socioeconomic_transfer_prefix = "native.socioeconomic.transfer.";
constexpr std::size_t socioeconomic_gate_count = 5;
constexpr std::int64_t socioeconomic_authority_schema_version = 1;

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

[[nodiscard]] std::optional<socioeconomic::SocioeconomicDomainGate> parseSocioeconomicGate(std::string_view suffix) noexcept {
    using Gate = socioeconomic::SocioeconomicDomainGate;
    if (suffix == "inventory_freight") return Gate::inventory_freight;
    if (suffix == "firms_production") return Gate::firms_production;
    if (suffix == "labor") return Gate::labor;
    if (suffix == "households_housing") return Gate::households_housing;
    if (suffix == "personhood_lifecycle") return Gate::personhood_lifecycle;
    return std::nullopt;
}

[[nodiscard]] Result<std::unique_ptr<json_object, decltype(&json_object_put)>> parseJsonObject(std::string_view json) {
    if (json.size() > static_cast<std::size_t>(std::numeric_limits<int>::max())) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "JSON exceeds parser size limit"));
    }
    json_tokener* tokener = json_tokener_new();
    if (!tokener) return std::unexpected(make_error(ErrorCode::internal_error, "failed to allocate JSON parser"));
    json_object* raw = json_tokener_parse_ex(tokener, json.data(), static_cast<int>(json.size()));
    const auto error = json_tokener_get_error(tokener);
    json_tokener_free(tokener);
    std::unique_ptr<json_object, decltype(&json_object_put)> root{raw, json_object_put};
    if (error != json_tokener_success || !root || json_object_get_type(root.get()) != json_type_object) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "expected JSON object"));
    }
    return root;
}

[[nodiscard]] Result<std::uint64_t> readNonNegativeJsonInteger(
    json_object* object,
    const char* member,
    std::string_view context) {
    json_object* value = nullptr;
    if (!object || !json_object_object_get_ex(object, member, &value) ||
        !value || json_object_get_type(value) != json_type_int) {
        return std::unexpected(make_error(
            ErrorCode::serialization_failure,
            std::string{context} + " is missing integer member " + member));
    }
    const auto raw = json_object_get_int64(value);
    if (raw < 0) {
        return std::unexpected(make_error(
            ErrorCode::serialization_failure,
            std::string{context} + " member " + member + " must be non-negative"));
    }
    return static_cast<std::uint64_t>(raw);
}

[[nodiscard]] Result<void> restoreSocioeconomicAuthority(
    json_object* extension,
    socioeconomic::SocioeconomicAuthority& authority) {
    json_object* persisted = nullptr;
    if (!json_object_object_get_ex(extension, "authority", &persisted)) return {};
    if (!persisted || json_object_get_type(persisted) != json_type_object) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "nativeSocioeconomic authority must be an object"));
    }

    auto schema = readNonNegativeJsonInteger(persisted, "schemaVersion", "nativeSocioeconomic authority");
    if (!schema) return std::unexpected(schema.error());
    if (*schema != static_cast<std::uint64_t>(socioeconomic_authority_schema_version)) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "unsupported nativeSocioeconomic authority schema"));
    }
    auto transferred = readNonNegativeJsonInteger(persisted, "transferredCount", "nativeSocioeconomic authority");
    if (!transferred) return std::unexpected(transferred.error());
    if (*transferred > socioeconomic_gate_count) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "nativeSocioeconomic authority transferredCount exceeds known gates"));
    }

    json_object* revisions = nullptr;
    if (!json_object_object_get_ex(persisted, "revisions", &revisions) ||
        !revisions || json_object_get_type(revisions) != json_type_array ||
        json_object_array_length(revisions) != socioeconomic_gate_count) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "nativeSocioeconomic authority revisions must contain exactly five entries"));
    }

    auto restored = authority.transfers().restore_transferred_count(static_cast<std::size_t>(*transferred));
    if (!restored) return std::unexpected(restored.error());
    for (std::size_t position = 0; position < socioeconomic_gate_count; ++position) {
        json_object* value = json_object_array_get_idx(revisions, position);
        if (!value || json_object_get_type(value) != json_type_int) {
            return std::unexpected(make_error(ErrorCode::serialization_failure, "nativeSocioeconomic authority revision must be an integer"));
        }
        const auto raw = json_object_get_int64(value);
        if (raw < 0) {
            return std::unexpected(make_error(ErrorCode::serialization_failure, "nativeSocioeconomic authority revision must be non-negative"));
        }
        authority.restore_revision(
            static_cast<socioeconomic::SocioeconomicDomainGate>(position),
            static_cast<std::uint64_t>(raw));
    }
    return {};
}

[[nodiscard]] Result<void> persistSocioeconomicAuthority(
    json_object* extension,
    const socioeconomic::SocioeconomicAuthority& authority) {
    std::unique_ptr<json_object, decltype(&json_object_put)> persisted{json_object_new_object(), json_object_put};
    std::unique_ptr<json_object, decltype(&json_object_put)> revisions{json_object_new_array_ext(static_cast<int>(socioeconomic_gate_count)), json_object_put};
    if (!persisted || !revisions) {
        return std::unexpected(make_error(ErrorCode::internal_error, "failed to allocate native socioeconomic authority JSON"));
    }

    json_object_object_add(persisted.get(), "schemaVersion", json_object_new_int64(socioeconomic_authority_schema_version));
    json_object_object_add(
        persisted.get(),
        "transferredCount",
        json_object_new_int64(static_cast<std::int64_t>(authority.transfers().transferred_count())));
    for (std::size_t position = 0; position < socioeconomic_gate_count; ++position) {
        const auto revision = authority.revision(static_cast<socioeconomic::SocioeconomicDomainGate>(position));
        if (revision > static_cast<std::uint64_t>(std::numeric_limits<std::int64_t>::max())) {
            return std::unexpected(make_error(ErrorCode::serialization_failure, "native socioeconomic authority revision exceeds Save V9 integer range"));
        }
        if (json_object_array_add(revisions.get(), json_object_new_int64(static_cast<std::int64_t>(revision))) != 0) {
            return std::unexpected(make_error(ErrorCode::internal_error, "failed to append native socioeconomic authority revision"));
        }
    }
    json_object_object_add(persisted.get(), "revisions", revisions.release());
    json_object_object_add(extension, "authority", persisted.release());
    return {};
}
} // namespace

NativeEngine::NativeEngine(const EngineConfig& config)
    : seed_(config.seed),
      clock_(config.startTick, config.speed),
      random_(config.seed),
      socioeconomic_(config.seed) {
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

Result<void> NativeEngine::applySocioeconomicBridgeCommand(const CommandEnvelope& command) {
    if (!command.type.starts_with(socioeconomic_transfer_prefix)) return {};
    const auto suffix = std::string_view{command.type}.substr(socioeconomic_transfer_prefix.size());
    const auto gate = parseSocioeconomicGate(suffix);
    if (!gate) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, "unknown socioeconomic authority gate: " + std::string{suffix}));
    }
    auto transferred = socioeconomic_.transfers().transfer_to_native(*gate);
    if (!transferred) return std::unexpected(transferred.error());
    socioeconomic_.bump_revision(*gate);
    return {};
}

Result<void> NativeEngine::step(std::uint64_t ticks) {
    if (ticks == 0) return {};
    for (std::uint64_t index = 0; index < ticks; ++index) {
        const auto checkpoint_clock = clock_;
        const auto checkpoint_commands = commands_;
        const auto checkpoint_events = events_;
        const auto checkpoint_random = random_;
        const auto checkpoint_socioeconomic = socioeconomic_;
        auto rollback = [&] {
            clock_ = checkpoint_clock;
            commands_ = checkpoint_commands;
            events_ = checkpoint_events;
            random_ = checkpoint_random;
            socioeconomic_ = checkpoint_socioeconomic;
        };
        auto advanced = clock_.step(1);
        if (!advanced) { rollback(); return advanced; }
        auto ready = commands_.takeReady(clock_.tick());
        for (const auto& command : ready) {
            const bool socioeconomic_transfer = command.type.starts_with(socioeconomic_transfer_prefix);
            auto applied = applySocioeconomicBridgeCommand(command);
            if (!applied) { rollback(); return applied; }
            events_.append(
                clock_.tick(),
                command.type,
                socioeconomic_transfer ? "native-authority-transfer" : "shadow-command",
                command.payload);
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

std::uint64_t NativeEngine::transportationDomainHash() const {
    const auto nativeHash = transportation_.domain_hash();
    if (transportation_continuation_.canonical.empty()) return nativeHash;
    std::ostringstream canonical;
    canonical << nativeHash << ':' << transportation_continuation_.canonical;
    return fnv1a64(canonical.str());
}

std::uint64_t NativeEngine::socioeconomicDomainHash(socioeconomic::SocioeconomicDomainGate gate) const {
    std::ostringstream canonical;
    canonical << socioeconomic_.runtime().authoritative_hash()
              << ':' << static_cast<std::uint32_t>(gate)
              << ':' << socioeconomic_.revision(gate);
    return fnv1a64(canonical.str());
}

bool NativeEngine::economyFullyNative() const noexcept {
    using Gate = socioeconomic::SocioeconomicDomainGate;
    return socioeconomic_.transfers().native_write_enabled(Gate::inventory_freight) &&
           socioeconomic_.transfers().native_write_enabled(Gate::firms_production) &&
           socioeconomic_.transfers().native_write_enabled(Gate::labor);
}

bool NativeEngine::populationFullyNative() const noexcept {
    using Gate = socioeconomic::SocioeconomicDomainGate;
    return socioeconomic_.transfers().native_write_enabled(Gate::households_housing) &&
           socioeconomic_.transfers().native_write_enabled(Gate::personhood_lifecycle);
}

Result<DomainHash> NativeEngine::domainHash(std::string_view domain) const {
    using Gate = socioeconomic::SocioeconomicDomainGate;
    if (domain == "kernel") return DomainHash{DomainOwnership::owned, 1, fnv1a64(kernelCanonicalState())};
    if (domain == "transportation") return DomainHash{DomainOwnership::owned, 1, transportationDomainHash()};

    const auto gateHash = [&](Gate gate) -> DomainHash {
        if (!socioeconomic_.transfers().native_write_enabled(gate)) return DomainHash{DomainOwnership::unowned, 1, 0};
        return DomainHash{DomainOwnership::owned, 1, socioeconomicDomainHash(gate)};
    };
    if (domain == "economy.inventory_freight") return gateHash(Gate::inventory_freight);
    if (domain == "economy.firms_production") return gateHash(Gate::firms_production);
    if (domain == "economy.labor") return gateHash(Gate::labor);
    if (domain == "population.households_housing") return gateHash(Gate::households_housing);
    if (domain == "population.personhood_lifecycle") return gateHash(Gate::personhood_lifecycle);

    if (domain == "economy") {
        if (!economyFullyNative()) return DomainHash{DomainOwnership::unowned, 1, 0};
        std::ostringstream canonical;
        canonical << socioeconomicDomainHash(Gate::inventory_freight) << ':'
                  << socioeconomicDomainHash(Gate::firms_production) << ':'
                  << socioeconomicDomainHash(Gate::labor);
        return DomainHash{DomainOwnership::owned, 1, fnv1a64(canonical.str())};
    }
    if (domain == "population") {
        if (!populationFullyNative()) return DomainHash{DomainOwnership::unowned, 1, 0};
        std::ostringstream canonical;
        canonical << socioeconomicDomainHash(Gate::households_housing) << ':'
                  << socioeconomicDomainHash(Gate::personhood_lifecycle);
        return DomainHash{DomainOwnership::owned, 1, fnv1a64(canonical.str())};
    }

    static constexpr std::string_view unowned[] = {"world", "cadastre", "buildings", "services"};
    if (std::ranges::find(unowned, domain) != std::end(unowned)) return DomainHash{DomainOwnership::unowned, 1, 0};
    return std::unexpected(make_error(ErrorCode::invalid_argument, "unknown domain hash: " + std::string{domain}));
}

Result<void> NativeEngine::loadV9(std::string_view json) {
    auto parsed = parseSaveV9(json); if (!parsed) return std::unexpected(parsed.error());
    auto transportation = parseTransportationV9(parsed->canonicalJson); if (!transportation) return std::unexpected(transportation.error());
    auto continuation = parseTransportationContinuationV9(parsed->canonicalJson); if (!continuation) return std::unexpected(continuation.error());
    auto roadTraffic = parseLegacyRoadTrafficV9(parsed->canonicalJson, transportation->network); if (!roadTraffic) return std::unexpected(roadTraffic.error());
    auto traffic = deriveTrafficFlowV9(transportation->network, *roadTraffic); if (!traffic) return std::unexpected(traffic.error());
    transportation->road_traffic = std::move(*roadTraffic);
    transportation->traffic = std::move(*traffic);
    transport::TransportationAuthority nextTransportation;
    try {
        nextTransportation.restore(*transportation);
    } catch (const std::exception& error) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, error.what()));
    } catch (...) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "unknown transportation restore failure"));
    }

    socioeconomic::SocioeconomicAuthority nextSocioeconomic{parsed->seed};
    auto parsedRoot = parseJsonObject(parsed->canonicalJson);
    if (!parsedRoot) return std::unexpected(parsedRoot.error());
    json_object* socioeconomicExtension = nullptr;
    if (json_object_object_get_ex(parsedRoot->get(), "nativeSocioeconomic", &socioeconomicExtension)) {
        if (!socioeconomicExtension || json_object_get_type(socioeconomicExtension) != json_type_object) {
            return std::unexpected(make_error(ErrorCode::serialization_failure, "nativeSocioeconomic must be an object"));
        }
        auto restored = socioeconomic::SocioeconomicPersistence::restore_v9_extension(parsed->canonicalJson);
        if (!restored) return std::unexpected(restored.error());
        if (restored->seed() != parsed->seed) {
            return std::unexpected(make_error(ErrorCode::serialization_failure, "native socioeconomic seed does not match Save V9 root seed"));
        }
        nextSocioeconomic.runtime() = std::move(*restored);
        auto authorityRestored = restoreSocioeconomicAuthority(socioeconomicExtension, nextSocioeconomic);
        if (!authorityRestored) return std::unexpected(authorityRestored.error());
    }

    seed_ = parsed->seed;
    clock_.restore(parsed->tick, parsed->speed);
    random_ = RandomStreamRegistry(seed_);
    commands_ = CommandQueue{};
    events_ = DomainEventJournal{};
    transportation_ = std::move(nextTransportation);
    transportation_continuation_ = std::move(*continuation);
    socioeconomic_ = std::move(nextSocioeconomic);
    loaded_save_ = std::move(*parsed);
    return {};
}

Result<std::string> NativeEngine::saveV9() const {
    if (!loaded_save_) return std::unexpected(make_error(ErrorCode::invalid_state, "no Save V9 is loaded"));

    auto root = parseJsonObject(loaded_save_->canonicalJson);
    if (!root) return std::unexpected(root.error());

    json_object* clock = nullptr;
    if (!json_object_object_get_ex(root->get(), "clock", &clock) || !clock || json_object_get_type(clock) != json_type_object) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "loaded Save V9 clock is missing"));
    }
    if (clock_.tick() > static_cast<std::uint64_t>(std::numeric_limits<std::int64_t>::max())) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "native tick exceeds Save V9 integer range"));
    }
    json_object_object_add(clock, "tick", json_object_new_int64(static_cast<std::int64_t>(clock_.tick())));
    json_object_object_add(clock, "speed", json_object_new_int64(static_cast<std::int64_t>(static_cast<std::uint32_t>(clock_.speed()))));

    json_object* existingSocioeconomic = nullptr;
    const bool loadedWithSocioeconomic =
        json_object_object_get_ex(root->get(), "nativeSocioeconomic", &existingSocioeconomic);
    const bool socioeconomicNative = socioeconomic_.transfers().transferred_count() > 0;
    if (loadedWithSocioeconomic || socioeconomicNative) {
        auto runtimeCopy = socioeconomic_.runtime();
        auto extensionJson = socioeconomic::SocioeconomicPersistence::serialize_v9_extension(runtimeCopy, clock_.tick());
        if (!extensionJson) return std::unexpected(extensionJson.error());
        auto extensionRoot = parseJsonObject(*extensionJson);
        if (!extensionRoot) return std::unexpected(extensionRoot.error());
        json_object* extension = nullptr;
        if (!json_object_object_get_ex(extensionRoot->get(), "nativeSocioeconomic", &extension) || !extension || json_object_get_type(extension) != json_type_object) {
            return std::unexpected(make_error(ErrorCode::serialization_failure, "socioeconomic serializer omitted nativeSocioeconomic object"));
        }
        auto authorityPersisted = persistSocioeconomicAuthority(extension, socioeconomic_);
        if (!authorityPersisted) return std::unexpected(authorityPersisted.error());
        json_object_object_add(root->get(), "nativeSocioeconomic", json_object_get(extension));
    }

    const char* encoded = json_object_to_json_string_ext(root->get(), JSON_C_TO_STRING_PLAIN);
    if (!encoded) return std::unexpected(make_error(ErrorCode::serialization_failure, "failed to encode merged Save V9"));
    auto canonical = parseSaveV9(encoded);
    if (!canonical) return std::unexpected(canonical.error());
    return canonical->canonicalJson;
}

} // namespace civic
