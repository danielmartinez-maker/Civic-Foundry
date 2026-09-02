#include <civic/socioeconomic/SocioeconomicIntegration.hpp>

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <ranges>
#include <utility>

namespace civic::socioeconomic {
namespace {

constexpr double kDistressHealth = 0.28;
constexpr double kCloseHealth = 0.08;
constexpr double kRecoverHealth = 0.45;
constexpr std::uint32_t kLossCyclesToClose = 4;
constexpr std::uint32_t kRecoveryCyclesToOperate = 2;
constexpr double kHealthMarginScale = 0.012;

[[nodiscard]] constexpr double clamp01(double value) noexcept {
    return std::clamp(value, 0.0, 1.0);
}

[[nodiscard]] bool finite_non_negative(double value) noexcept {
    return std::isfinite(value) && value >= 0.0;
}

[[nodiscard]] Result<void> validate_financial_inputs(const FirmMarginInputs& inputs) {
    if (!finite_non_negative(inputs.revenue) ||
        !finite_non_negative(inputs.input_cost) ||
        !finite_non_negative(inputs.wage_cost) ||
        !finite_non_negative(inputs.utility_cost) ||
        !finite_non_negative(inputs.tax_cost) ||
        !finite_non_negative(inputs.logistics_cost) ||
        !finite_non_negative(inputs.shortage_penalty)) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, "firm margin inputs must be finite and non-negative"));
    }
    return {};
}

[[nodiscard]] std::string primary_constraint(const FirmCycleFinancials& financials) {
    std::array<std::pair<std::string_view, double>, 6> costs{{
        {"input cost", financials.input_cost},
        {"wage cost", financials.wage_cost},
        {"utility cost", financials.utility_cost},
        {"tax burden", financials.tax_cost},
        {"logistics cost", financials.logistics_cost},
        {"shortage penalty", financials.shortage_penalty},
    }};
    std::ranges::sort(costs, [](const auto& left, const auto& right) {
        if (left.second != right.second) return left.second > right.second;
        return left.first < right.first;
    });
    return std::string{costs.front().first};
}

[[nodiscard]] Result<void> validate_lifecycle_memory(const FirmLifecycleMemory& memory) {
    if (!std::isfinite(memory.cash_health) || memory.cash_health < 0.0 || memory.cash_health > 1.0 ||
        !std::isfinite(memory.last_operating_margin)) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid firm lifecycle memory"));
    }
    return {};
}

[[nodiscard]] Result<void> validate_cycle_financials(const FirmCycleFinancials& financials) {
    const std::array values{
        financials.revenue,
        financials.input_cost,
        financials.wage_cost,
        financials.utility_cost,
        financials.tax_cost,
        financials.logistics_cost,
        financials.shortage_penalty,
    };
    if (std::ranges::any_of(values, [](double value) { return !finite_non_negative(value); })) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, "firm lifecycle costs must be finite and non-negative"));
    }
    return {};
}

[[nodiscard]] Result<void> restore_people_transactionally(
    PersonRegistry& people,
    std::span<const PersonView> snapshot,
    PersonId next_id) {
    PersonRegistry replacement;
    auto restored = restore_person_registry(replacement, snapshot, next_id);
    if (!restored) return restored;
    people = std::move(replacement);
    return {};
}

[[nodiscard]] Result<void> add_margin_contribution(
    prism::CausalityTraceStore& traces,
    prism::CausalityTraceId trace,
    std::string domain,
    std::uint64_t entity,
    std::string metric,
    double contribution,
    std::string channel) {
    return traces.add_contribution(
        trace,
        prism::EntityMetric{std::move(domain), entity, std::move(metric)},
        contribution,
        std::move(channel));
}

} // namespace

Result<void> assign_freight_vehicle_with_transport(
    FreightVehicleStore& vehicles,
    FreightVehicleId vehicle,
    FreightOrderId order,
    std::int64_t cargo,
    FirmId supplier,
    std::uint64_t destination,
    const RouteCostProvider& route_provider) {
    if (vehicle.value() == 0 || order.value() == 0 || cargo <= 0 ||
        supplier.value() == 0 || destination == 0 || !route_provider) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid routed freight assignment"));
    }
    auto quote = route_provider(supplier, destination);
    if (!quote) return std::unexpected(quote.error());
    if (quote->transport_cost < 0 || quote->congestion_reliability_cost < 0 ||
        quote->inventory_risk_cost < 0 || !std::isfinite(quote->travel_time_minutes) ||
        quote->travel_time_minutes <= 0.0) {
        return std::unexpected(make_error(ErrorCode::invalid_state, "native transport returned an invalid freight route quote"));
    }
    return vehicles.assign(FreightVehicle{
        vehicle,
        order,
        cargo,
        quote->travel_time_minutes,
        0.0,
        true,
    });
}

FirmLifecycleMemory FirmLifecycleUpdate::memory() const {
    return FirmLifecycleMemory{
        status,
        cash_health,
        consecutive_loss_cycles,
        consecutive_recovery_cycles,
        last_operating_margin,
        closure_tick,
        distress_reason,
    };
}

Result<FirmLifecycleUpdate> BusinessLifecycleModel::evaluate_cycle(
    const FirmLifecycleMemory& memory,
    const FirmCycleFinancials& financials,
    std::uint64_t tick) const {
    if (auto valid = validate_lifecycle_memory(memory); !valid) return std::unexpected(valid.error());
    if (auto valid = validate_cycle_financials(financials); !valid) return std::unexpected(valid.error());

    const double margin = std::isfinite(financials.operating_margin) ? financials.operating_margin : 0.0;
    const double cash_health = clamp01(memory.cash_health + margin * kHealthMarginScale);
    const bool losing = margin < 0.0;
    const std::uint32_t loss_cycles = losing ? memory.consecutive_loss_cycles + 1U : 0U;
    const std::uint32_t recovery_cycles =
        !losing && cash_health >= kRecoverHealth
            ? memory.consecutive_recovery_cycles + 1U
            : 0U;

    BusinessLifecycleState status = memory.status;
    std::optional<std::uint64_t> closure_tick = memory.closure_tick;
    std::string distress_reason = memory.distress_reason;

    if (memory.status == BusinessLifecycleState::forming) {
        status = BusinessLifecycleState::forming;
    } else if (loss_cycles >= kLossCyclesToClose && cash_health <= kCloseHealth) {
        status = BusinessLifecycleState::closed;
        closure_tick = tick;
        distress_reason = "sustained negative operating health";
    } else if (memory.status == BusinessLifecycleState::distressed &&
               recovery_cycles >= kRecoveryCyclesToOperate) {
        status = BusinessLifecycleState::operating;
        distress_reason.clear();
    } else if (cash_health <= kDistressHealth || loss_cycles >= 2U) {
        status = BusinessLifecycleState::distressed;
        distress_reason = primary_constraint(financials);
    }

    return FirmLifecycleUpdate{
        status,
        cash_health,
        loss_cycles,
        recovery_cycles,
        margin,
        closure_tick,
        std::move(distress_reason),
    };
}

double BusinessLifecycleModel::score_formation(const FormationContext& context) const noexcept {
    if (!context.reachable_gateway) return 0.0;
    const auto safe = [](double value) noexcept {
        return std::isfinite(value) ? clamp01(value) : 0.0;
    };
    const double tax_penalty = std::isfinite(context.tax_rate)
        ? clamp01(context.tax_rate / 0.25)
        : 1.0;
    return clamp01(
        0.25 * safe(context.utility_ratio) +
        0.20 * safe(context.labor_availability) +
        0.20 * safe(context.accessibility) +
        0.20 * safe(context.local_demand) +
        0.15 * safe(context.sector_gap) -
        0.15 * tax_penalty);
}

AuthoritativeLifecycleScheduler::AuthoritativeLifecycleScheduler(
    std::uint32_t seed,
    LifecycleCadence cadence)
    : rng_(seed), cadence_(cadence) {}

Result<LifecycleOutcome> AuthoritativeLifecycleScheduler::step(
    std::uint64_t tick,
    PersonRegistry& people) {
    if (cadence_.aging_ticks == 0 || cadence_.employment_ticks == 0 || cadence_.migration_ticks == 0) {
        return std::unexpected(make_error(ErrorCode::invalid_state, "lifecycle cadence cannot be zero"));
    }

    auto snapshot = people.snapshot();
    const PersonId next_id = people.next_id();
    LifecycleOutcome outcome{};
    bool mutated = false;

    if (tick % cadence_.aging_ticks == 0) {
        for (auto& person : snapshot) {
            if (person.age < 130) ++person.age;
            ++outcome.aged;
        }
        mutated = !snapshot.empty();
    }

    if (tick % cadence_.employment_ticks == 0) {
        auto stream = rng_.stream("demographics.employment");
        if (!stream) return std::unexpected(stream.error());
        for (auto& person : snapshot) {
            if ((*stream)->next() < 0.01) {
                person.employed = !person.employed;
                ++outcome.employment_changes;
                mutated = true;
            }
        }
    }

    if (tick % cadence_.migration_ticks == 0) {
        auto stream = rng_.stream("demographics.migration");
        if (!stream) return std::unexpected(stream.error());
        for (const auto& person : snapshot) {
            (void)person;
            (void)(*stream)->next();
            ++outcome.migration_checks;
        }
    }

    if (mutated) {
        auto restored = restore_people_transactionally(people, snapshot, next_id);
        if (!restored) return std::unexpected(restored.error());
    }
    return outcome;
}

EconomyPersonhoodIntegrator::EconomyPersonhoodIntegrator(SocioeconomicRuntime& runtime) noexcept
    : runtime_(runtime) {}

Result<void> EconomyPersonhoodIntegrator::bind_worker(
    WorkerId worker,
    PersonId person,
    HouseholdId household) {
    if (worker.value() == 0 || person.value() == 0 || household.value() == 0) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, "worker-person binding uses invalid id"));
    }
    const auto person_view = runtime_.people().get(person);
    const auto household_view = runtime_.households().get(household);
    if (!person_view || !household_view || person_view->household != household) {
        return std::unexpected(make_error(ErrorCode::invalid_state, "worker-person binding references inconsistent personhood state"));
    }
    if (!worker_bindings_.emplace(worker, WorkerPersonBinding{person, household}).second) {
        return std::unexpected(make_error(ErrorCode::invalid_state, "worker is already bound to personhood"));
    }
    return {};
}

Result<std::vector<LaborAllocation>> EconomyPersonhoodIntegrator::clear_labor_and_apply(
    LaborMarket& labor,
    std::uint64_t tick) {
    auto allocations = labor.clear();
    if (!allocations) return std::unexpected(allocations.error());

    auto people_snapshot = runtime_.people().snapshot();
    const PersonId next_person_id = runtime_.people().next_id();
    std::map<PersonId, std::size_t> person_indexes;
    for (std::size_t index = 0; index < people_snapshot.size(); ++index) {
        person_indexes.emplace(people_snapshot[index].id, index);
    }

    for (const auto& allocation : *allocations) {
        const auto binding = worker_bindings_.find(allocation.worker);
        if (binding == worker_bindings_.end()) {
            return std::unexpected(make_error(ErrorCode::invalid_state, "authoritative labor allocation lacks a personhood binding"));
        }
        const auto person_index = person_indexes.find(binding->second.person);
        const auto household = runtime_.households().get(binding->second.household);
        if (person_index == person_indexes.end() || !household ||
            people_snapshot[person_index->second].household != binding->second.household) {
            return std::unexpected(make_error(ErrorCode::invariant_failure, "labor binding became stale before authoritative commit"));
        }
        if (allocation.wage.minor_units() <= 0) {
            return std::unexpected(make_error(ErrorCode::invalid_state, "authoritative labor allocation must carry a positive wage"));
        }
        auto& person = people_snapshot[person_index->second];
        person.employed = true;
        if (person.income.minor_units() > std::numeric_limits<std::int64_t>::max() - allocation.wage.minor_units()) {
            return std::unexpected(make_error(ErrorCode::invariant_failure, "person wage income overflow"));
        }
        person.income = Money{person.income.minor_units() + allocation.wage.minor_units()};
    }

    PersonRegistry replacement;
    auto restored = restore_person_registry(replacement, people_snapshot, next_person_id);
    if (!restored) return std::unexpected(restored.error());

    for (const auto& allocation : *allocations) {
        const auto& binding = worker_bindings_.at(allocation.worker);
        auto paid = runtime_.pay_wage(allocation.firm, binding.household, allocation.wage, tick);
        if (!paid) return std::unexpected(paid.error());
    }

    runtime_.people() = std::move(replacement);
    return *allocations;
}

Result<double> EconomyPersonhoodIntegrator::housing_relocation_pressure(
    double monthly_cost,
    HousingIncomeBand band) const {
    auto affordability = housing_affordability_score(monthly_cost, band);
    if (!affordability) return std::unexpected(affordability.error());
    return clamp01(1.0 - *affordability);
}

Result<FirmMarginExplanation> EconomyPersonhoodIntegrator::explain_firm_margin(
    FirmId firm,
    const FirmMarginInputs& inputs,
    prism::CausalityTraceStore& traces,
    std::uint64_t tick) const {
    if (firm.value() == 0) return std::unexpected(make_error(ErrorCode::invalid_argument, "firm margin requires a valid firm id"));
    if (auto valid = validate_financial_inputs(inputs); !valid) return std::unexpected(valid.error());

    const double margin =
        inputs.revenue - inputs.input_cost - inputs.wage_cost - inputs.utility_cost -
        inputs.tax_cost - inputs.logistics_cost - inputs.shortage_penalty;
    auto trace = traces.begin(prism::EntityMetric{"economy", firm.value(), "firm.margin"}, tick);
    if (!trace) return std::unexpected(trace.error());

    const std::array contributions{
        std::tuple{"economy", "revenue", inputs.revenue, "sales"},
        std::tuple{"economy", "input.cost", -inputs.input_cost, "production"},
        std::tuple{"personhood", "labor.cost", -inputs.wage_cost, "payroll"},
        std::tuple{"services", "utility.cost", -inputs.utility_cost, "utilities"},
        std::tuple{"economy", "tax.cost", -inputs.tax_cost, "tax"},
        std::tuple{"freight", "logistics.cost", -inputs.logistics_cost, "logistics"},
        std::tuple{"freight", "shortage.penalty", -inputs.shortage_penalty, "inventory-risk"},
    };
    for (const auto& [domain, metric, contribution, channel] : contributions) {
        auto added = add_margin_contribution(
            traces,
            *trace,
            domain,
            firm.value(),
            metric,
            contribution,
            channel);
        if (!added) return std::unexpected(added.error());
    }
    return FirmMarginExplanation{margin, *trace};
}

Result<void> CivicEconomicCompatibilityGateway::publish_service(
    CompatibilityWriter writer,
    const ServiceEconomicInterface& value) {
    if (auto valid = value.validate(); !valid) return std::unexpected(valid.error());
    const auto owner = service_writer_.find(value.service_id);
    const CompatibilityWriter expected = owner == service_writer_.end()
        ? CompatibilityWriter::typescript
        : owner->second;
    if (writer != expected) {
        return std::unexpected(make_error(ErrorCode::invariant_failure, "service compatibility publication attempted by non-owner"));
    }
    const auto previous = services_.find(value.service_id);
    const std::uint64_t revision = previous == services_.end() ? 1U : previous->second.revision + 1U;
    services_[value.service_id] = ServiceCompatibilitySnapshot{value, writer, revision};
    service_writer_[value.service_id] = expected;
    return {};
}

Result<void> CivicEconomicCompatibilityGateway::publish_utility(
    CompatibilityWriter writer,
    const UtilityEconomicInterface& value) {
    if (auto valid = value.validate(); !valid) return std::unexpected(valid.error());
    const auto owner = utility_writer_.find(value.utility_id);
    const CompatibilityWriter expected = owner == utility_writer_.end()
        ? CompatibilityWriter::typescript
        : owner->second;
    if (writer != expected) {
        return std::unexpected(make_error(ErrorCode::invariant_failure, "utility compatibility publication attempted by non-owner"));
    }
    const auto previous = utilities_.find(value.utility_id);
    const std::uint64_t revision = previous == utilities_.end() ? 1U : previous->second.revision + 1U;
    utilities_[value.utility_id] = UtilityCompatibilitySnapshot{value, writer, revision};
    utility_writer_[value.utility_id] = expected;
    return {};
}

Result<void> CivicEconomicCompatibilityGateway::transfer_service_to_native(std::uint64_t service_id) {
    if (service_id == 0 || !services_.contains(service_id)) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, "cannot transfer unknown service compatibility authority"));
    }
    if (service_writer_.at(service_id) == CompatibilityWriter::native) {
        return std::unexpected(make_error(ErrorCode::invalid_state, "service compatibility authority already native"));
    }
    service_writer_[service_id] = CompatibilityWriter::native;
    return {};
}

Result<void> CivicEconomicCompatibilityGateway::transfer_utility_to_native(std::uint64_t utility_id) {
    if (utility_id == 0 || !utilities_.contains(utility_id)) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, "cannot transfer unknown utility compatibility authority"));
    }
    if (utility_writer_.at(utility_id) == CompatibilityWriter::native) {
        return std::unexpected(make_error(ErrorCode::invalid_state, "utility compatibility authority already native"));
    }
    utility_writer_[utility_id] = CompatibilityWriter::native;
    return {};
}

std::optional<ServiceCompatibilitySnapshot> CivicEconomicCompatibilityGateway::service(
    std::uint64_t service_id) const {
    if (const auto it = services_.find(service_id); it != services_.end()) return it->second;
    return std::nullopt;
}

std::optional<UtilityCompatibilitySnapshot> CivicEconomicCompatibilityGateway::utility(
    std::uint64_t utility_id) const {
    if (const auto it = utilities_.find(utility_id); it != utilities_.end()) return it->second;
    return std::nullopt;
}

Result<prism::CausalityTraceId> record_commute_accessibility_trace(
    prism::CausalityTraceStore& traces,
    PersonId person,
    std::uint64_t tick,
    double transport_accessibility,
    double destination_accessibility,
    double service_accessibility) {
    if (person.value() == 0 || !std::isfinite(transport_accessibility) ||
        !std::isfinite(destination_accessibility) || !std::isfinite(service_accessibility)) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid commute accessibility trace input"));
    }
    auto trace = traces.begin(
        prism::EntityMetric{"personhood", person.value(), "commute.accessibility"},
        tick);
    if (!trace) return std::unexpected(trace.error());

    auto transport = traces.add_contribution(
        *trace,
        prism::EntityMetric{"transport", person.value(), "network.accessibility"},
        transport_accessibility,
        "network");
    if (!transport) return std::unexpected(transport.error());
    auto destinations = traces.add_contribution(
        *trace,
        prism::EntityMetric{"land-use", person.value(), "destination.accessibility"},
        destination_accessibility,
        "destinations");
    if (!destinations) return std::unexpected(destinations.error());
    auto services = traces.add_contribution(
        *trace,
        prism::EntityMetric{"services", person.value(), "service.accessibility"},
        service_accessibility,
        "services");
    if (!services) return std::unexpected(services.error());
    return *trace;
}

} // namespace civic::socioeconomic
