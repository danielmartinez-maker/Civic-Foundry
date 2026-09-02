#pragma once

#include <array>
#include <cstdint>
#include <functional>
#include <map>
#include <span>
#include <string_view>
#include <vector>

#include <civic/core/Error.hpp>
#include <civic/prism/PrismRuntime.hpp>
#include <civic/socioeconomic/SocioeconomicRuntime.hpp>

namespace civic::socioeconomic {

enum class SocioeconomicDomainGate : std::uint8_t {
    inventory_freight = 0,
    firms_production = 1,
    labor = 2,
    households_housing = 3,
    personhood_lifecycle = 4,
};

[[nodiscard]] constexpr std::string_view domain_gate_name(SocioeconomicDomainGate gate) noexcept {
    switch (gate) {
        case SocioeconomicDomainGate::inventory_freight: return "inventory_freight";
        case SocioeconomicDomainGate::firms_production: return "firms_production";
        case SocioeconomicDomainGate::labor: return "labor";
        case SocioeconomicDomainGate::households_housing: return "households_housing";
        case SocioeconomicDomainGate::personhood_lifecycle: return "personhood_lifecycle";
    }
    return "unknown";
}

class AuthorityTransferController final {
public:
    [[nodiscard]] Result<void> transfer_to_native(SocioeconomicDomainGate gate);
    [[nodiscard]] bool native_write_enabled(SocioeconomicDomainGate gate) const noexcept;
    [[nodiscard]] bool typescript_write_enabled(SocioeconomicDomainGate gate) const noexcept;
    [[nodiscard]] Result<void> validate_single_writer(SocioeconomicDomainGate gate) const;
    [[nodiscard]] Result<void> validate_external_writer(SocioeconomicDomainGate gate, bool external_writer_enabled) const;
    [[nodiscard]] bool fully_native() const noexcept;
    [[nodiscard]] std::size_t transferred_count() const noexcept { return transferred_count_; }
private:
    static constexpr std::size_t gate_count = 5;
    [[nodiscard]] static constexpr std::size_t index(SocioeconomicDomainGate gate) noexcept {
        return static_cast<std::size_t>(gate);
    }
    std::array<bool, gate_count> native_writes_{};
    std::size_t transferred_count_{};
};

struct SupplierOffer final {
    FirmId supplier{0};
    std::int64_t production_price{};
    std::int64_t available_quantity{};
};

struct DeliveredCostQuote final {
    std::int64_t transport_cost{};
    std::int64_t congestion_reliability_cost{};
    std::int64_t inventory_risk_cost{};
    double travel_time_minutes{};
};

struct DeliveredSupplierChoice final {
    FirmId supplier{0};
    std::int64_t generalized_cost{};
    double travel_time_minutes{};
};

using RouteCostProvider = std::function<Result<DeliveredCostQuote>(FirmId supplier, std::uint64_t destination)>;

[[nodiscard]] Result<DeliveredSupplierChoice> select_supplier_with_transport(
    std::span<const SupplierOffer> offers,
    std::uint64_t destination,
    const RouteCostProvider& provider);

enum class SocioeconomicCommandType : std::uint8_t {
    create_household,
    create_person,
};

struct SocioeconomicCommand final {
    std::uint64_t sequence{};
    std::uint64_t tick{};
    SocioeconomicCommandType type{SocioeconomicCommandType::create_household};
    std::uint64_t entity{};
    std::int64_t parameter{};
    std::int64_t amount{};
};

class SocioeconomicAuthority final {
public:
    explicit SocioeconomicAuthority(std::uint32_t seed);

    [[nodiscard]] SocioeconomicRuntime& runtime() noexcept { return runtime_; }
    [[nodiscard]] const SocioeconomicRuntime& runtime() const noexcept { return runtime_; }
    [[nodiscard]] AuthorityTransferController& transfers() noexcept { return transfers_; }
    [[nodiscard]] const AuthorityTransferController& transfers() const noexcept { return transfers_; }
    [[nodiscard]] prism::ImmutableSnapshotRegistry& snapshots() noexcept { return snapshots_; }
    [[nodiscard]] const prism::ImmutableSnapshotRegistry& snapshots() const noexcept { return snapshots_; }
    [[nodiscard]] prism::CausalityTraceStore& causality() noexcept { return causality_; }
    [[nodiscard]] prism::PerformanceTelemetry& telemetry() noexcept { return telemetry_; }

    void bump_revision(SocioeconomicDomainGate gate) noexcept;
    [[nodiscard]] std::uint64_t revision(SocioeconomicDomainGate gate) const noexcept;
    [[nodiscard]] Result<std::uint64_t> publish_snapshot(std::uint64_t tick);

    [[nodiscard]] Result<void> apply(const SocioeconomicCommand& command);
    [[nodiscard]] Result<void> replay(std::span<const SocioeconomicCommand> commands);
    [[nodiscard]] const std::vector<SocioeconomicCommand>& journal() const noexcept { return journal_; }

private:
    [[nodiscard]] Result<void> apply_unjournaled(const SocioeconomicCommand& command);

    std::uint32_t seed_{};
    SocioeconomicRuntime runtime_;
    AuthorityTransferController transfers_;
    prism::ImmutableSnapshotRegistry snapshots_;
    prism::CausalityTraceStore causality_;
    prism::PerformanceTelemetry telemetry_;
    std::array<std::uint64_t, 5> revisions_{};
    std::vector<SocioeconomicCommand> journal_;
    std::uint64_t last_sequence_{};
};

} // namespace civic::socioeconomic
