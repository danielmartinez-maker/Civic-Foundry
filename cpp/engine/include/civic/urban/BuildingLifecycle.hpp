#pragma once

#include "civic/core/Kernel.hpp"
#include "civic/core/Result.hpp"
#include "civic/urban/BuildingMassing.hpp"
#include "civic/urban/UrbanFabric.hpp"

#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <vector>

namespace civic::urban {

struct BuildingLifecycleInput final {
  double maintenance_spend{};
  double occupancy_ratio{};
  double utilization_ratio{};
  double environmental_stress{};
  double service_stress{};
  std::uint64_t cadence_ticks{};
};

class BuildingLifecycleSystem final {
public:
  [[nodiscard]] civic::core::Result<BuildingLifecycle> tick(
      const BuildingV2& building,
      const BuildingTypology& typology,
      const BuildingLifecycleInput& input) const noexcept;
};

[[nodiscard]] civic::core::Result<double> required_maintenance_cost(
    const BuildingV2& building,
    const BuildingTypology& typology) noexcept;

[[nodiscard]] civic::core::Result<double> condition_rent_factor(double condition) noexcept;

enum class RenovationScope : std::uint8_t { light, major, gut };

struct RenovationMarketContext final {
  double current_property_value{};
  double projected_property_value{};
  double hurdle_rate{};
  double financing_rate{};
};

struct RenovationProposal final {
  RenovationScope scope{RenovationScope::light};
  bool feasible{};
  double cost{};
  double financing_cost{};
  double total_investment{};
  double projected_condition{};
  double projected_structural_condition{};
  double projected_systems_condition{};
  double projected_exterior_condition{};
  double projected_effective_age{};
  double expected_return{};
  bool requires_vacancy{};
  std::uint64_t duration_ticks{};
  std::vector<std::string> rejection_reasons{};
  std::optional<UseType> destination_use{};
};

using RenovationEvaluation = RenovationProposal;

class RenovationSystem final {
public:
  [[nodiscard]] civic::core::Result<RenovationProposal> propose(
      const BuildingV2& building,
      const BuildingTypology& typology,
      const RenovationMarketContext& market,
      RenovationScope scope) const noexcept;

  [[nodiscard]] civic::core::Result<RenovationEvaluation> evaluate_adaptive_reuse(
      const BuildingV2& building,
      const BuildingTypology& typology,
      UseType destination_use,
      const ParcelDevelopmentEnvelope& envelope,
      const RenovationMarketContext& market) const noexcept;

  [[nodiscard]] civic::core::Result<BuildingV2> start(
      const BuildingV2& building,
      const RenovationProposal& proposal,
      std::uint64_t tick,
      bool relocation_complete) const noexcept;

  [[nodiscard]] civic::core::Result<BuildingV2> tick(
      const BuildingV2& building,
      std::uint64_t tick) const noexcept;
};

using LifecycleInputProvider = std::function<civic::core::Result<BuildingLifecycleInput>(
    const BuildingV2&,
    std::uint64_t)>;

class BuildingLifecycleDriver final {
public:
  static constexpr std::uint64_t lifecycle_cadence_ticks = 25;

  BuildingLifecycleDriver(
      UrbanFabricStore& store,
      std::vector<BuildingTypology> typologies,
      LifecycleInputProvider provider);

  [[nodiscard]] civic::Result<void> register_with(civic::SystemScheduler& scheduler);

private:
  [[nodiscard]] civic::Result<void> run_renovation_tick(std::uint64_t tick);
  [[nodiscard]] civic::Result<void> run_lifecycle_tick(std::uint64_t tick);
  [[nodiscard]] const BuildingTypology* find_typology(const std::string& id) const noexcept;

  UrbanFabricStore& store_;
  std::vector<BuildingTypology> typologies_;
  LifecycleInputProvider provider_;
  RenovationSystem renovation_{};
  BuildingLifecycleSystem lifecycle_{};
};

}  // namespace civic::urban
