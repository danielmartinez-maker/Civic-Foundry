#pragma once

#include <cstdint>
#include <map>
#include <optional>
#include <span>
#include <string>
#include <vector>

#include <civic/prism/PrismRuntime.hpp>
#include <civic/socioeconomic/HousingEconomics.hpp>
#include <civic/socioeconomic/SocioeconomicAuthority.hpp>
#include <civic/socioeconomic/SocioeconomicPersistence.hpp>
#include <civic/socioeconomic/SocioeconomicRuntime.hpp>

namespace civic::socioeconomic {

[[nodiscard]] Result<void> assign_freight_vehicle_with_transport(
    FreightVehicleStore& vehicles,
    FreightVehicleId vehicle,
    FreightOrderId order,
    std::int64_t cargo,
    FirmId supplier,
    std::uint64_t destination,
    const RouteCostProvider& route_provider);

struct FirmCycleFinancials final {
    double revenue{};
    double input_cost{};
    double wage_cost{};
    double utility_cost{};
    double tax_cost{};
    double logistics_cost{};
    double shortage_penalty{};
    double operating_margin{};
};

struct FirmLifecycleMemory final {
    BusinessLifecycleState status{BusinessLifecycleState::operating};
    double cash_health{0.6};
    std::uint32_t consecutive_loss_cycles{};
    std::uint32_t consecutive_recovery_cycles{};
    double last_operating_margin{};
    std::optional<std::uint64_t> closure_tick;
    std::string distress_reason;
};

struct FirmLifecycleUpdate final {
    BusinessLifecycleState status{BusinessLifecycleState::operating};
    double cash_health{0.6};
    std::uint32_t consecutive_loss_cycles{};
    std::uint32_t consecutive_recovery_cycles{};
    double last_operating_margin{};
    std::optional<std::uint64_t> closure_tick;
    std::string distress_reason;

    [[nodiscard]] FirmLifecycleMemory memory() const;
};

struct FormationContext final {
    bool reachable_gateway{};
    double utility_ratio{};
    double labor_availability{};
    double accessibility{};
    double local_demand{};
    double sector_gap{};
    double tax_rate{};
};

class BusinessLifecycleModel final {
public:
    [[nodiscard]] Result<FirmLifecycleUpdate> evaluate_cycle(
        const FirmLifecycleMemory& memory,
        const FirmCycleFinancials& financials,
        std::uint64_t tick) const;
    [[nodiscard]] double score_formation(const FormationContext& context) const noexcept;
};

class AuthoritativeLifecycleScheduler final {
public:
    explicit AuthoritativeLifecycleScheduler(
        std::uint32_t seed,
        LifecycleCadence cadence = {});

    [[nodiscard]] Result<LifecycleOutcome> step(
        std::uint64_t tick,
        PersonRegistry& people);

private:
    RandomStreamRegistry rng_;
    LifecycleCadence cadence_;
};

struct WorkerPersonBinding final {
    PersonId person{0};
    HouseholdId household{0};
};

struct FirmMarginInputs final {
    double revenue{};
    double input_cost{};
    double wage_cost{};
    double utility_cost{};
    double tax_cost{};
    double logistics_cost{};
    double shortage_penalty{};
};

struct FirmMarginExplanation final {
    double operating_margin{};
    prism::CausalityTraceId trace{0};
};

class EconomyPersonhoodIntegrator final {
public:
    explicit EconomyPersonhoodIntegrator(SocioeconomicRuntime& runtime) noexcept;

    [[nodiscard]] Result<void> bind_worker(
        WorkerId worker,
        PersonId person,
        HouseholdId household);

    [[nodiscard]] Result<std::vector<LaborAllocation>> clear_labor_and_apply(
        LaborMarket& labor,
        std::uint64_t tick);

    [[nodiscard]] Result<double> housing_relocation_pressure(
        double monthly_cost,
        HousingIncomeBand band) const;

    [[nodiscard]] Result<FirmMarginExplanation> explain_firm_margin(
        FirmId firm,
        const FirmMarginInputs& inputs,
        prism::CausalityTraceStore& traces,
        std::uint64_t tick) const;

private:
    SocioeconomicRuntime& runtime_;
    std::map<WorkerId, WorkerPersonBinding> worker_bindings_;
};

enum class CompatibilityWriter : std::uint8_t {
    typescript,
    native,
};

struct ServiceCompatibilitySnapshot final {
    ServiceEconomicInterface value;
    CompatibilityWriter writer{CompatibilityWriter::typescript};
    std::uint64_t revision{};
};

struct UtilityCompatibilitySnapshot final {
    UtilityEconomicInterface value;
    CompatibilityWriter writer{CompatibilityWriter::typescript};
    std::uint64_t revision{};
};

class CivicEconomicCompatibilityGateway final {
public:
    [[nodiscard]] Result<void> publish_service(
        CompatibilityWriter writer,
        const ServiceEconomicInterface& value);
    [[nodiscard]] Result<void> publish_utility(
        CompatibilityWriter writer,
        const UtilityEconomicInterface& value);

    [[nodiscard]] Result<void> transfer_service_to_native(std::uint64_t service_id);
    [[nodiscard]] Result<void> transfer_utility_to_native(std::uint64_t utility_id);

    [[nodiscard]] std::optional<ServiceCompatibilitySnapshot> service(
        std::uint64_t service_id) const;
    [[nodiscard]] std::optional<UtilityCompatibilitySnapshot> utility(
        std::uint64_t utility_id) const;

private:
    std::map<std::uint64_t, ServiceCompatibilitySnapshot> services_;
    std::map<std::uint64_t, UtilityCompatibilitySnapshot> utilities_;
    std::map<std::uint64_t, CompatibilityWriter> service_writer_;
    std::map<std::uint64_t, CompatibilityWriter> utility_writer_;
};

[[nodiscard]] Result<prism::CausalityTraceId> record_commute_accessibility_trace(
    prism::CausalityTraceStore& traces,
    PersonId person,
    std::uint64_t tick,
    double transport_accessibility,
    double destination_accessibility,
    double service_accessibility);

} // namespace civic::socioeconomic
