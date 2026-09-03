#include <civic/socioeconomic/SocioeconomicAuthority.hpp>

#include <algorithm>
#include <cmath>
#include <limits>

namespace civic::socioeconomic {
namespace {

[[nodiscard]] Result<std::int64_t> checked_cost_add(std::int64_t left, std::int64_t right) {
    if (right < 0) return std::unexpected(make_error(ErrorCode::invalid_argument, "delivered cost components must be non-negative"));
    if (left > std::numeric_limits<std::int64_t>::max() - right) {
        return std::unexpected(make_error(ErrorCode::invariant_failure, "delivered generalized cost overflow"));
    }
    return left + right;
}

[[nodiscard]] constexpr std::size_t gate_index(SocioeconomicDomainGate gate) noexcept {
    return static_cast<std::size_t>(gate);
}

} // namespace

Result<void> AuthorityTransferController::transfer_to_native(SocioeconomicDomainGate gate) {
    const auto requested = index(gate);
    if (requested >= gate_count) return std::unexpected(make_error(ErrorCode::invalid_argument, "unknown socioeconomic authority gate"));
    if (native_writes_[requested]) return std::unexpected(make_error(ErrorCode::invalid_state, "socioeconomic authority gate already transferred"));
    if (requested != transferred_count_) {
        return std::unexpected(make_error(ErrorCode::invalid_state, "socioeconomic authority gates must transfer in declared order"));
    }
    native_writes_[requested] = true;
    ++transferred_count_;
    return validate_single_writer(gate);
}

Result<void> AuthorityTransferController::restore_transferred_count(std::size_t transferred_count) {
    if (transferred_count > gate_count) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "persisted socioeconomic authority count exceeds known gates"));
    }
    native_writes_.fill(false);
    for (std::size_t position = 0; position < transferred_count; ++position) {
        native_writes_[position] = true;
    }
    transferred_count_ = transferred_count;
    for (std::size_t position = 0; position < gate_count; ++position) {
        auto valid = validate_single_writer(static_cast<SocioeconomicDomainGate>(position));
        if (!valid) return valid;
    }
    return {};
}

bool AuthorityTransferController::native_write_enabled(SocioeconomicDomainGate gate) const noexcept {
    const auto position = index(gate);
    return position < gate_count && native_writes_[position];
}

bool AuthorityTransferController::typescript_write_enabled(SocioeconomicDomainGate gate) const noexcept {
    return !native_write_enabled(gate);
}

Result<void> AuthorityTransferController::validate_single_writer(SocioeconomicDomainGate gate) const {
    const auto native = native_write_enabled(gate);
    const auto typescript = typescript_write_enabled(gate);
    if (native == typescript) return std::unexpected(make_error(ErrorCode::invariant_failure, "socioeconomic domain must have exactly one writer"));
    return {};
}

Result<void> AuthorityTransferController::validate_external_writer(SocioeconomicDomainGate gate, bool external_writer_enabled) const {
    if (native_write_enabled(gate) && external_writer_enabled) {
        return std::unexpected(make_error(ErrorCode::invariant_failure, "native and external runtimes cannot both write socioeconomic authority"));
    }
    if (!native_write_enabled(gate) && !external_writer_enabled) {
        return std::unexpected(make_error(ErrorCode::invariant_failure, "socioeconomic domain has no active writer"));
    }
    return {};
}

bool AuthorityTransferController::fully_native() const noexcept {
    return transferred_count_ == gate_count && std::ranges::all_of(native_writes_, [](bool enabled) { return enabled; });
}

Result<DeliveredSupplierChoice> select_supplier_with_transport(
    std::span<const SupplierOffer> offers,
    std::uint64_t destination,
    const RouteCostProvider& provider) {
    if (destination == 0 || !provider) return std::unexpected(make_error(ErrorCode::invalid_argument, "supplier selection requires destination and route provider"));

    std::optional<DeliveredSupplierChoice> best;
    for (const auto& offer : offers) {
        if (offer.supplier.value() == 0 || offer.production_price < 0 || offer.available_quantity <= 0) continue;
        auto quote = provider(offer.supplier, destination);
        if (!quote) continue;
        if (quote->transport_cost < 0 || quote->congestion_reliability_cost < 0 || quote->inventory_risk_cost < 0 ||
            !std::isfinite(quote->travel_time_minutes) || quote->travel_time_minutes < 0.0) {
            return std::unexpected(make_error(ErrorCode::invalid_state, "transport quote must be finite and non-negative"));
        }
        auto cost = checked_cost_add(offer.production_price, quote->transport_cost); if (!cost) return std::unexpected(cost.error());
        cost = checked_cost_add(*cost, quote->congestion_reliability_cost); if (!cost) return std::unexpected(cost.error());
        cost = checked_cost_add(*cost, quote->inventory_risk_cost); if (!cost) return std::unexpected(cost.error());
        const DeliveredSupplierChoice candidate{offer.supplier, *cost, quote->travel_time_minutes};
        if (!best || candidate.generalized_cost < best->generalized_cost ||
            (candidate.generalized_cost == best->generalized_cost && candidate.supplier < best->supplier)) {
            best = candidate;
        }
    }
    if (!best) return std::unexpected(make_error(ErrorCode::invalid_state, "no valid supplier route candidate"));
    return *best;
}

SocioeconomicAuthority::SocioeconomicAuthority(std::uint32_t seed) : seed_(seed), runtime_(seed) {}

void SocioeconomicAuthority::bump_revision(SocioeconomicDomainGate gate) noexcept {
    const auto position = gate_index(gate);
    if (position < revisions_.size()) ++revisions_[position];
}

void SocioeconomicAuthority::restore_revision(SocioeconomicDomainGate gate, std::uint64_t revision) noexcept {
    const auto position = gate_index(gate);
    if (position < revisions_.size()) revisions_[position] = revision;
}

std::uint64_t SocioeconomicAuthority::revision(SocioeconomicDomainGate gate) const noexcept {
    const auto position = gate_index(gate);
    return position < revisions_.size() ? revisions_[position] : 0;
}

Result<std::uint64_t> SocioeconomicAuthority::publish_snapshot(std::uint64_t tick) {
    auto payload = runtime_.serialize_v9_extension(tick);
    if (!payload) return std::unexpected(payload.error());
    prism::Snapshot snapshot{};
    snapshot.tick = tick;
    snapshot.schema_version = 1;
    snapshot.payload = std::move(*payload);
    for (std::size_t position = 0; position < revisions_.size(); ++position) {
        const auto gate = static_cast<SocioeconomicDomainGate>(position);
        snapshot.domain_revisions.emplace(std::string{domain_gate_name(gate)}, revisions_[position]);
    }
    return snapshots_.publish(std::move(snapshot));
}

Result<void> SocioeconomicAuthority::apply_unjournaled(const SocioeconomicCommand& command) {
    if (command.sequence == 0) return std::unexpected(make_error(ErrorCode::invalid_argument, "socioeconomic command sequence must be positive"));
    if (command.entity == 0) return std::unexpected(make_error(ErrorCode::invalid_argument, "socioeconomic command entity must be non-zero"));

    switch (command.type) {
        case SocioeconomicCommandType::create_household: {
            if (command.parameter <= 0 || command.amount < 0) return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid create-household command"));
            Household household{};
            household.id = HouseholdId{command.entity};
            household.member_weight = static_cast<double>(command.parameter);
            household.cash = Money{command.amount};
            auto inserted = runtime_.households().insert(household);
            if (!inserted) return inserted;
            bump_revision(SocioeconomicDomainGate::households_housing);
            return {};
        }
        case SocioeconomicCommandType::create_person: {
            if (command.parameter < 0 || command.parameter > 130 || command.amount < 0) return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid create-person command"));
            const HouseholdId household{command.entity};
            if (!runtime_.households().get(household)) return std::unexpected(make_error(ErrorCode::invalid_state, "person command references unknown household"));
            auto created = runtime_.people().create({household, static_cast<std::uint16_t>(command.parameter), 0, 0, false, Money{command.amount}});
            if (!created) return std::unexpected(created.error());
            bump_revision(SocioeconomicDomainGate::personhood_lifecycle);
            return {};
        }
    }
    return std::unexpected(make_error(ErrorCode::invalid_argument, "unknown socioeconomic command type"));
}

Result<void> SocioeconomicAuthority::apply(const SocioeconomicCommand& command) {
    if (command.sequence <= last_sequence_) return std::unexpected(make_error(ErrorCode::invalid_state, "socioeconomic command sequence must increase monotonically"));
    auto applied = apply_unjournaled(command);
    if (!applied) return applied;
    last_sequence_ = command.sequence;
    journal_.push_back(command);
    return {};
}

Result<void> SocioeconomicAuthority::replay(std::span<const SocioeconomicCommand> commands) {
    if (!journal_.empty() || runtime_.people().size() != 0 || !runtime_.households().snapshot().empty()) {
        return std::unexpected(make_error(ErrorCode::invalid_state, "replay target must begin from pristine socioeconomic authority"));
    }
    for (const auto& command : commands) {
        auto applied = apply(command);
        if (!applied) return applied;
    }
    return {};
}

} // namespace civic::socioeconomic
