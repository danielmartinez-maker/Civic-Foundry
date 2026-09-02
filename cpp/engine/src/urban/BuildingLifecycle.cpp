#include "civic/urban/BuildingLifecycle.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <span>
#include <utility>

namespace civic::urban {
namespace {

constexpr double kTicksPerYear = 250.0;
constexpr double kEpsilon = 1e-9;

struct RenovationScopeDefinition final {
  double cost_per_m2{};
  std::uint64_t duration_ticks{};
  double target_condition{};
  double effective_age_multiplier{};
  bool requires_vacancy{};
};

[[nodiscard]] constexpr RenovationScopeDefinition renovation_definition(RenovationScope scope) noexcept {
  switch (scope) {
    case RenovationScope::light: return {180.0, 20, 68.0, 0.90, false};
    case RenovationScope::major: return {520.0, 55, 82.0, 0.55, true};
    case RenovationScope::gut: return {900.0, 90, 94.0, 0.25, true};
  }
  return {};
}

[[nodiscard]] double clamp(double value, double minimum, double maximum) noexcept {
  return std::max(minimum, std::min(maximum, value));
}

[[nodiscard]] civic::core::Result<void> validate_lifecycle(const BuildingLifecycle& state) noexcept {
  const double non_negative_values[]{
      state.condition,
      state.structural_condition,
      state.systems_condition,
      state.exterior_condition,
      state.maintenance_backlog,
      state.effective_age,
      state.vacancy_duration_ticks,
      state.distress_score,
  };
  for (const double value : non_negative_values) {
    if (!std::isfinite(value) || value < 0.0) {
      return std::unexpected(civic::core::error(
          civic::core::ErrorCode::invalid_argument,
          "BuildingV2 lifecycle values must be finite and non-negative"));
    }
  }
  const double bounded_values[]{
      state.condition,
      state.structural_condition,
      state.systems_condition,
      state.exterior_condition,
      state.distress_score,
  };
  for (const double value : bounded_values) {
    if (value > 100.0) {
      return std::unexpected(civic::core::error(
          civic::core::ErrorCode::invalid_argument,
          "BuildingV2 lifecycle condition/distress values must not exceed 100"));
    }
  }
  return {};
}

[[nodiscard]] civic::core::Result<void> validate_lifecycle_building(
    const BuildingV2& building,
    const BuildingTypology& typology) noexcept {
  if (building.typology_id != typology.id) {
    return std::unexpected(civic::core::error(
        civic::core::ErrorCode::invalid_argument,
        "building typology mismatch"));
  }
  if (!std::isfinite(building.gross_floor_area_m2) || building.gross_floor_area_m2 < 0.0) {
    return std::unexpected(civic::core::error(
        civic::core::ErrorCode::invalid_argument,
        "building gross floor area must be finite and non-negative"));
  }
  if (!std::isfinite(typology.maintenance_cost_per_m2) || typology.maintenance_cost_per_m2 < 0.0) {
    return std::unexpected(civic::core::error(
        civic::core::ErrorCode::invalid_argument,
        "typology maintenance cost must be finite and non-negative"));
  }
  if (!std::isfinite(typology.complexity_factor) || typology.complexity_factor <= 0.0) {
    return std::unexpected(civic::core::error(
        civic::core::ErrorCode::invalid_argument,
        "typology complexity factor must be positive and finite"));
  }
  return validate_lifecycle(building.lifecycle);
}

[[nodiscard]] civic::core::Result<void> validate_lifecycle_input(const BuildingLifecycleInput& input) noexcept {
  const double values[]{
      input.maintenance_spend,
      input.occupancy_ratio,
      input.utilization_ratio,
      input.environmental_stress,
      input.service_stress,
  };
  for (const double value : values) {
    if (!std::isfinite(value)) {
      return std::unexpected(civic::core::error(
          civic::core::ErrorCode::invalid_argument,
          "building lifecycle input must be finite"));
    }
  }
  if (input.maintenance_spend < 0.0) {
    return std::unexpected(civic::core::error(
        civic::core::ErrorCode::invalid_argument,
        "maintenance spend must be non-negative"));
  }
  const double ratios[]{
      input.occupancy_ratio,
      input.utilization_ratio,
      input.environmental_stress,
      input.service_stress,
  };
  for (const double value : ratios) {
    if (value < 0.0 || value > 1.0) {
      return std::unexpected(civic::core::error(
          civic::core::ErrorCode::invalid_argument,
          "building lifecycle ratios must be within [0, 1]"));
    }
  }
  if (input.cadence_ticks == 0) {
    return std::unexpected(civic::core::error(
        civic::core::ErrorCode::invalid_argument,
        "building lifecycle cadence must be positive"));
  }
  return {};
}

[[nodiscard]] civic::core::Result<void> validate_renovation_building(
    const BuildingV2& building,
    const BuildingTypology& typology) noexcept {
  if (building.typology_id != typology.id) {
    return std::unexpected(civic::core::error(
        civic::core::ErrorCode::invalid_argument,
        "building typology mismatch"));
  }
  if (!std::isfinite(building.gross_floor_area_m2) || building.gross_floor_area_m2 <= 0.0) {
    return std::unexpected(civic::core::error(
        civic::core::ErrorCode::invalid_argument,
        "building gross floor area must be positive and finite"));
  }
  if (!std::isfinite(building.lifecycle.effective_age) || building.lifecycle.effective_age < 0.0) {
    return std::unexpected(civic::core::error(
        civic::core::ErrorCode::invalid_argument,
        "building lifecycle effective age must be finite and non-negative"));
  }
  const double conditions[]{
      building.lifecycle.condition,
      building.lifecycle.structural_condition,
      building.lifecycle.systems_condition,
      building.lifecycle.exterior_condition,
  };
  for (const double value : conditions) {
    if (!std::isfinite(value) || value < 0.0 || value > 100.0) {
      return std::unexpected(civic::core::error(
          civic::core::ErrorCode::invalid_argument,
          "building lifecycle condition must be within [0, 100]"));
    }
  }
  return {};
}

[[nodiscard]] civic::core::Result<void> validate_market(const RenovationMarketContext& market) noexcept {
  const double values[]{
      market.current_property_value,
      market.projected_property_value,
      market.hurdle_rate,
      market.financing_rate,
  };
  for (const double value : values) {
    if (!std::isfinite(value) || value < 0.0) {
      return std::unexpected(civic::core::error(
          civic::core::ErrorCode::invalid_argument,
          "renovation market inputs must be finite and non-negative"));
    }
  }
  if (market.hurdle_rate > 1.0 || market.financing_rate > 1.0) {
    return std::unexpected(civic::core::error(
        civic::core::ErrorCode::invalid_argument,
        "renovation rates must not exceed 1"));
  }
  return {};
}

[[nodiscard]] bool contains_use(const std::vector<UseType>& uses, UseType use) noexcept {
  return std::find(uses.begin(), uses.end(), use) != uses.end();
}

[[nodiscard]] bool contains_parcel(
    const std::vector<civic::core::ParcelId>& parcels,
    civic::core::ParcelId parcel) noexcept {
  return std::find(parcels.begin(), parcels.end(), parcel) != parcels.end();
}

[[nodiscard]] civic::core::Result<double> required_target(
    const std::optional<double>& value,
    const char* label) noexcept {
  if (!value || !std::isfinite(*value) || *value < 0.0 || *value > 100.0) {
    return std::unexpected(civic::core::error(
        civic::core::ErrorCode::invalid_state,
        std::string{"renovation project is missing valid target "} + label));
  }
  return *value;
}

[[nodiscard]] BuildingRenovationScope persisted_scope(RenovationScope scope) noexcept {
  switch (scope) {
    case RenovationScope::light: return BuildingRenovationScope::light;
    case RenovationScope::major: return BuildingRenovationScope::major;
    case RenovationScope::gut: return BuildingRenovationScope::gut;
  }
  return BuildingRenovationScope::light;
}

[[nodiscard]] RenovationScope runtime_scope(BuildingRenovationScope scope) noexcept {
  switch (scope) {
    case BuildingRenovationScope::light: return RenovationScope::light;
    case BuildingRenovationScope::major: return RenovationScope::major;
    case BuildingRenovationScope::gut: return RenovationScope::gut;
  }
  return RenovationScope::light;
}

[[nodiscard]] civic::Error scheduler_error(const civic::core::Error& error) {
  switch (error.code) {
    case civic::core::ErrorCode::invalid_argument:
      return civic::make_error(civic::ErrorCode::invalid_argument, error.message);
    case civic::core::ErrorCode::invariant_failure:
      return civic::make_error(civic::ErrorCode::invariant_failure, error.message);
    case civic::core::ErrorCode::serialization_failure:
      return civic::make_error(civic::ErrorCode::serialization_failure, error.message);
    case civic::core::ErrorCode::unsupported_save_version:
      return civic::make_error(civic::ErrorCode::unsupported_save_version, error.message);
    case civic::core::ErrorCode::internal_error:
      return civic::make_error(civic::ErrorCode::internal_error, error.message);
    case civic::core::ErrorCode::none:
      return civic::make_error(civic::ErrorCode::none, error.message);
    case civic::core::ErrorCode::invalid_state:
    case civic::core::ErrorCode::not_found:
    case civic::core::ErrorCode::conflict:
      return civic::make_error(civic::ErrorCode::invalid_state, error.message);
  }
  return civic::make_error(civic::ErrorCode::internal_error, error.message);
}

}  // namespace

civic::core::Result<double> required_maintenance_cost(
    const BuildingV2& building,
    const BuildingTypology& typology) noexcept {
  auto valid = validate_lifecycle_building(building, typology);
  if (!valid) return std::unexpected(valid.error());
  const double effective_age = std::max(0.0, building.lifecycle.effective_age);
  const double age_factor = 1.0 + std::min(effective_age, 100.0) / 100.0;
  const double complexity_factor = std::max(0.50, typology.complexity_factor);
  return building.gross_floor_area_m2 * typology.maintenance_cost_per_m2 * age_factor * complexity_factor;
}

civic::core::Result<BuildingLifecycle> BuildingLifecycleSystem::tick(
    const BuildingV2& building,
    const BuildingTypology& typology,
    const BuildingLifecycleInput& input) const noexcept {
  auto valid_building = validate_lifecycle_building(building, typology);
  if (!valid_building) return std::unexpected(valid_building.error());
  auto valid_input = validate_lifecycle_input(input);
  if (!valid_input) return std::unexpected(valid_input.error());
  auto required_result = required_maintenance_cost(building, typology);
  if (!required_result) return std::unexpected(required_result.error());

  const auto& previous = building.lifecycle;
  const double required = *required_result;
  const double cadence_years = static_cast<double>(input.cadence_ticks) / kTicksPerYear;
  const double shortfall = std::max(0.0, required - input.maintenance_spend);
  const double surplus = std::max(0.0, input.maintenance_spend - required);
  const double shortfall_ratio = required > kEpsilon ? shortfall / required : 0.0;
  const double backlog_repayment = std::min(previous.maintenance_backlog, surplus * 0.75);
  const double maintenance_backlog = std::max(0.0, previous.maintenance_backlog + shortfall - backlog_repayment);
  const double backlog_ratio = required > kEpsilon ? maintenance_backlog / required : 0.0;

  const std::uint64_t deferred_maintenance_ticks = shortfall > kEpsilon
      ? previous.deferred_maintenance_ticks + input.cadence_ticks
      : previous.deferred_maintenance_ticks > input.cadence_ticks
          ? previous.deferred_maintenance_ticks - input.cadence_ticks
          : 0U;

  const bool chronic_vacancy = input.occupancy_ratio < 0.20;
  const bool healthy_occupancy = input.occupancy_ratio >= 0.50;
  const double vacancy_duration_ticks = chronic_vacancy
      ? previous.vacancy_duration_ticks + static_cast<double>(input.cadence_ticks)
      : healthy_occupancy
          ? std::max(0.0, previous.vacancy_duration_ticks - static_cast<double>(input.cadence_ticks) * 2.0)
          : std::max(0.0, previous.vacancy_duration_ticks - static_cast<double>(input.cadence_ticks) * 0.25);

  if (input.cadence_ticks > std::numeric_limits<std::uint64_t>::max() - previous.age_ticks) {
    return std::unexpected(civic::core::error(
        civic::core::ErrorCode::invalid_state,
        "building lifecycle age tick overflow"));
  }
  const std::uint64_t age_ticks = previous.age_ticks + input.cadence_ticks;
  const double effective_age = std::max(0.0, previous.effective_age + cadence_years);
  const double age_stress = std::min(2.0, effective_age / 50.0);
  const double vacancy_stress = chronic_vacancy
      ? 1.0 - input.occupancy_ratio
      : std::max(0.0, 0.35 - input.occupancy_ratio) * 0.5;
  const double utilization_stress = input.utilization_ratio > 0.90
      ? (input.utilization_ratio - 0.90) * 2.0
      : input.utilization_ratio < 0.20
          ? (0.20 - input.utilization_ratio) * 0.5
          : 0.0;
  const double backlog_stress = std::min(3.0, backlog_ratio);
  const double base_decay = cadence_years * (0.45 + age_stress * 0.35);
  const double maintenance_decay = cadence_years * (shortfall_ratio * 2.4 + backlog_stress * 0.55);
  const double vacancy_decay = cadence_years * vacancy_stress * 2.0;
  const double utilization_decay = cadence_years * utilization_stress * 0.7;
  const double environmental_decay = cadence_years * input.environmental_stress;
  const double service_decay = cadence_years * input.service_stress * 0.7;
  const double restoration = required > kEpsilon
      ? std::min(0.75 * cadence_years, surplus / required * 0.5)
      : 0.0;

  const double structural_condition = clamp(
      previous.structural_condition - base_decay * 0.55 - maintenance_decay * 0.40 -
          vacancy_decay * 0.15 - environmental_decay * 0.25 + restoration * 0.35,
      0.0,
      100.0);
  const double systems_condition = clamp(
      previous.systems_condition - base_decay * 0.90 - maintenance_decay * 1.10 -
          utilization_decay * 0.70 - service_decay * 0.65 + restoration * 0.90,
      0.0,
      100.0);
  const double exterior_condition = clamp(
      previous.exterior_condition - base_decay * 0.75 - maintenance_decay * 0.70 -
          vacancy_decay * 1.10 - environmental_decay * 1.15 + restoration * 0.75,
      0.0,
      100.0);
  const double condition = clamp(
      structural_condition * 0.40 + systems_condition * 0.35 + exterior_condition * 0.25,
      0.0,
      100.0);

  const double vacancy_years = vacancy_duration_ticks / kTicksPerYear;
  const double condition_distress = (100.0 - condition) * 0.62;
  const double vacancy_distress = std::min(20.0, vacancy_years * 5.0);
  const double backlog_distress = std::min(18.0, backlog_stress * 6.0);
  const double deferred_distress = std::min(
      10.0,
      static_cast<double>(deferred_maintenance_ticks) / kTicksPerYear * 2.5);
  const double distress_score = clamp(
      condition_distress + vacancy_distress + backlog_distress + deferred_distress,
      0.0,
      100.0);

  BuildingLifecycle next = previous;
  next.age_ticks = age_ticks;
  next.condition = condition;
  next.structural_condition = structural_condition;
  next.systems_condition = systems_condition;
  next.exterior_condition = exterior_condition;
  next.maintenance_backlog = maintenance_backlog;
  next.deferred_maintenance_ticks = deferred_maintenance_ticks;
  next.effective_age = effective_age;
  next.vacancy_duration_ticks = vacancy_duration_ticks;
  next.distress_score = distress_score;
  return next;
}

civic::core::Result<double> condition_rent_factor(double condition) noexcept {
  if (!std::isfinite(condition)) {
    return std::unexpected(civic::core::error(
        civic::core::ErrorCode::invalid_argument,
        "condition must be finite"));
  }
  const double value = clamp(condition, 0.0, 100.0);
  if (value >= 80.0) return 0.95 + ((value - 80.0) / 20.0) * 0.05;
  if (value >= 60.0) return 0.88 + ((value - 60.0) / 20.0) * 0.07;
  if (value >= 35.0) return 0.70 + ((value - 35.0) / 25.0) * 0.18;
  if (value >= 20.0) return 0.50 + ((value - 20.0) / 15.0) * 0.20;
  return 0.30 + (value / 20.0) * 0.20;
}

civic::core::Result<RenovationProposal> RenovationSystem::propose(
    const BuildingV2& building,
    const BuildingTypology& typology,
    const RenovationMarketContext& market,
    RenovationScope scope) const noexcept {
  auto valid_building = validate_renovation_building(building, typology);
  if (!valid_building) return std::unexpected(valid_building.error());
  auto valid_market = validate_market(market);
  if (!valid_market) return std::unexpected(valid_market.error());
  const auto definition = renovation_definition(scope);

  RenovationProposal proposal;
  proposal.scope = scope;
  proposal.cost = building.gross_floor_area_m2 * definition.cost_per_m2;
  proposal.financing_cost = proposal.cost * market.financing_rate *
      (static_cast<double>(definition.duration_ticks) / kTicksPerYear);
  proposal.total_investment = proposal.cost + proposal.financing_cost;
  const double value_gain = market.projected_property_value - market.current_property_value;
  proposal.expected_return = proposal.total_investment > 0.0
      ? (value_gain - proposal.total_investment) / proposal.total_investment
      : value_gain > 0.0 ? std::numeric_limits<double>::infinity() : 0.0;
  proposal.projected_condition = std::max(building.lifecycle.condition, definition.target_condition);
  proposal.projected_structural_condition = std::max(building.lifecycle.structural_condition, definition.target_condition);
  proposal.projected_systems_condition = std::max(building.lifecycle.systems_condition, definition.target_condition);
  proposal.projected_exterior_condition = std::max(building.lifecycle.exterior_condition, definition.target_condition);
  proposal.projected_effective_age = std::min(
      building.lifecycle.effective_age,
      building.lifecycle.effective_age * definition.effective_age_multiplier);
  proposal.requires_vacancy = definition.requires_vacancy;
  proposal.duration_ticks = definition.duration_ticks;
  if (market.projected_property_value <= market.current_property_value) {
    proposal.rejection_reasons.emplace_back("no-value-uplift");
  }
  if (proposal.expected_return < market.hurdle_rate) {
    proposal.rejection_reasons.emplace_back("return-below-hurdle");
  }
  proposal.feasible = proposal.rejection_reasons.empty();
  return proposal;
}

civic::core::Result<RenovationEvaluation> RenovationSystem::evaluate_adaptive_reuse(
    const BuildingV2& building,
    const BuildingTypology& typology,
    UseType destination_use,
    const ParcelDevelopmentEnvelope& envelope,
    const RenovationMarketContext& market) const noexcept {
  auto proposal = propose(building, typology, market, RenovationScope::gut);
  if (!proposal) return std::unexpected(proposal.error());
  proposal->destination_use = destination_use;
  if (!contains_use(envelope.permitted_uses, destination_use)) {
    proposal->rejection_reasons.insert(proposal->rejection_reasons.begin(), "destination-use-prohibited");
  }
  if (!typology.conversion_suitability || *typology.conversion_suitability <= 0.0) {
    proposal->rejection_reasons.emplace_back("conversion-unsuitable");
  }
  if (!contains_parcel(building.parcel_ids, envelope.parcel_id)) {
    proposal->rejection_reasons.emplace_back("parcel-mismatch");
  }
  proposal->feasible = proposal->rejection_reasons.empty();
  return *proposal;
}

civic::core::Result<BuildingV2> RenovationSystem::start(
    const BuildingV2& building,
    const RenovationProposal& proposal,
    std::uint64_t tick,
    bool relocation_complete) const noexcept {
  if (!proposal.feasible) {
    return std::unexpected(civic::core::error(
        civic::core::ErrorCode::invalid_state,
        "cannot start infeasible renovation"));
  }
  if (building.status != BuildingStatus::occupied &&
      building.status != BuildingStatus::vacant &&
      building.status != BuildingStatus::abandoned) {
    return std::unexpected(civic::core::error(
        civic::core::ErrorCode::invalid_state,
        "building status does not permit renovation"));
  }
  if (building.project && building.project->phase != BuildingProjectPhase::none) {
    return std::unexpected(civic::core::error(
        civic::core::ErrorCode::conflict,
        "building already has an active project"));
  }
  if (proposal.requires_vacancy && !relocation_complete) {
    return std::unexpected(civic::core::error(
        civic::core::ErrorCode::invalid_state,
        "relocation must be complete before renovation can start"));
  }
  if (proposal.duration_ticks > std::numeric_limits<std::uint64_t>::max() - tick) {
    return std::unexpected(civic::core::error(
        civic::core::ErrorCode::invalid_argument,
        "renovation completion tick overflow"));
  }

  BuildingV2 next = building;
  next.status = BuildingStatus::renovation;
  BuildingProjectState project;
  project.phase = BuildingProjectPhase::fit_out;
  project.started_tick = tick;
  project.completion_tick = tick + proposal.duration_ticks;
  project.progress = 0.0;
  project.kind = proposal.destination_use
      ? BuildingProjectKind::adaptive_reuse
      : BuildingProjectKind::renovation;
  project.renovation_scope = persisted_scope(proposal.scope);
  project.target_condition = proposal.projected_condition;
  project.target_structural_condition = proposal.projected_structural_condition;
  project.target_systems_condition = proposal.projected_systems_condition;
  project.target_exterior_condition = proposal.projected_exterior_condition;
  project.target_effective_age = proposal.projected_effective_age;
  project.destination_use = proposal.destination_use;
  next.project = project;
  return next;
}

civic::core::Result<BuildingV2> RenovationSystem::tick(
    const BuildingV2& building,
    std::uint64_t tick) const noexcept {
  if (building.status != BuildingStatus::renovation || !building.project ||
      building.project->phase != BuildingProjectPhase::fit_out) {
    return building;
  }
  const auto& project = *building.project;
  if (!project.started_tick || !project.completion_tick) {
    return std::unexpected(civic::core::error(
        civic::core::ErrorCode::invalid_state,
        "renovation project is missing timing state"));
  }
  if (!project.renovation_scope) {
    return std::unexpected(civic::core::error(
        civic::core::ErrorCode::invalid_state,
        "renovation project is missing scope"));
  }

  BuildingV2 next = building;
  if (tick < *project.completion_tick) {
    const std::uint64_t duration = std::max<std::uint64_t>(1U, *project.completion_tick - *project.started_tick);
    const double elapsed = tick >= *project.started_tick
        ? static_cast<double>(tick - *project.started_tick)
        : 0.0;
    next.project->progress = clamp(elapsed / static_cast<double>(duration), 0.0, 1.0);
    return next;
  }

  auto target_condition = required_target(project.target_condition, "condition");
  auto target_structural = required_target(project.target_structural_condition, "structural condition");
  auto target_systems = required_target(project.target_systems_condition, "systems condition");
  auto target_exterior = required_target(project.target_exterior_condition, "exterior condition");
  auto target_age = required_target(project.target_effective_age, "effective age");
  if (!target_condition) return std::unexpected(target_condition.error());
  if (!target_structural) return std::unexpected(target_structural.error());
  if (!target_systems) return std::unexpected(target_systems.error());
  if (!target_exterior) return std::unexpected(target_exterior.error());
  if (!target_age) return std::unexpected(target_age.error());

  const RenovationScope scope = runtime_scope(*project.renovation_scope);
  next.lifecycle.condition = std::max(building.lifecycle.condition, *target_condition);
  next.lifecycle.structural_condition = std::max(building.lifecycle.structural_condition, *target_structural);
  next.lifecycle.systems_condition = std::max(building.lifecycle.systems_condition, *target_systems);
  next.lifecycle.exterior_condition = std::max(building.lifecycle.exterior_condition, *target_exterior);
  next.lifecycle.effective_age = std::min(building.lifecycle.effective_age, *target_age);
  next.lifecycle.maintenance_backlog = 0.0;
  next.lifecycle.deferred_maintenance_ticks = 0;
  next.lifecycle.vacancy_duration_ticks = 0.0;
  next.lifecycle.distress_score = clamp((100.0 - next.lifecycle.condition) * 0.35, 0.0, 100.0);
  if (scope == RenovationScope::major || scope == RenovationScope::gut) {
    next.lifecycle.last_major_renovation_tick = tick;
  }
  next.status = BuildingStatus::occupied;
  next.project->phase = BuildingProjectPhase::none;
  next.project->progress = 1.0;
  if (project.destination_use && !contains_use(next.entitlement.approved_uses, *project.destination_use)) {
    next.entitlement.approved_uses.push_back(*project.destination_use);
    std::sort(next.entitlement.approved_uses.begin(), next.entitlement.approved_uses.end());
  }
  return next;
}

BuildingLifecycleDriver::BuildingLifecycleDriver(
    UrbanFabricStore& store,
    std::vector<BuildingTypology> typologies,
    LifecycleInputProvider provider)
    : store_(store), typologies_(std::move(typologies)), provider_(std::move(provider)) {
  std::sort(typologies_.begin(), typologies_.end(), [](const BuildingTypology& left, const BuildingTypology& right) {
    return left.id < right.id;
  });
}

const BuildingTypology* BuildingLifecycleDriver::find_typology(const std::string& id) const noexcept {
  const auto iterator = std::lower_bound(
      typologies_.begin(),
      typologies_.end(),
      id,
      [](const BuildingTypology& typology, const std::string& value) { return typology.id < value; });
  return iterator != typologies_.end() && iterator->id == id ? &*iterator : nullptr;
}

civic::Result<void> BuildingLifecycleDriver::register_with(civic::SystemScheduler& scheduler) {
  if (!provider_) {
    return std::unexpected(civic::make_error(
        civic::ErrorCode::invalid_argument,
        "building lifecycle input provider must be configured"));
  }
  for (std::size_t index = 1; index < typologies_.size(); ++index) {
    if (typologies_[index - 1].id == typologies_[index].id) {
      return std::unexpected(civic::make_error(
          civic::ErrorCode::invalid_argument,
          "duplicate building typology in lifecycle driver"));
    }
  }

  auto renovation_result = scheduler.registerSystem(civic::SystemDefinition{
      .id = "urban.building-renovation",
      .cadence = {.every = 1, .offset = 0},
      .writes = {"urban.buildings"},
      .order = 100,
      .execute = [this](std::uint64_t tick) { return run_renovation_tick(tick); },
  });
  if (!renovation_result) return renovation_result;

  return scheduler.registerSystem(civic::SystemDefinition{
      .id = "urban.building-lifecycle",
      .cadence = {.every = lifecycle_cadence_ticks, .offset = 0},
      .after = {"urban.building-renovation"},
      .writes = {"urban.buildings"},
      .order = 110,
      .execute = [this](std::uint64_t tick) { return run_lifecycle_tick(tick); },
  });
}

civic::Result<void> BuildingLifecycleDriver::run_renovation_tick(std::uint64_t tick) {
  bool active = false;
  for (const auto& [_, building] : store_.buildings()) {
    if (building.status == BuildingStatus::renovation && building.project &&
        building.project->phase == BuildingProjectPhase::fit_out) {
      active = true;
      break;
    }
  }
  if (!active) return {};

  std::vector<BuildingV2> staged;
  staged.reserve(store_.buildings().size());
  for (const auto& [_, building] : store_.buildings()) {
    auto next = renovation_.tick(building, tick);
    if (!next) return std::unexpected(scheduler_error(next.error()));
    staged.push_back(std::move(*next));
  }
  auto restored = store_.restore_buildings(std::span<const BuildingV2>{staged});
  if (!restored) return std::unexpected(scheduler_error(restored.error()));
  return {};
}

civic::Result<void> BuildingLifecycleDriver::run_lifecycle_tick(std::uint64_t tick) {
  std::vector<BuildingV2> staged;
  staged.reserve(store_.buildings().size());
  for (const auto& [_, building] : store_.buildings()) {
    BuildingV2 next = building;
    if (building.status == BuildingStatus::occupied ||
        building.status == BuildingStatus::vacant ||
        building.status == BuildingStatus::abandoned) {
      const auto* typology = find_typology(building.typology_id);
      if (typology == nullptr) {
        return std::unexpected(civic::make_error(
            civic::ErrorCode::invalid_state,
            "lifecycle driver cannot resolve building typology: " + building.typology_id));
      }
      auto input = provider_(building, tick);
      if (!input) return std::unexpected(scheduler_error(input.error()));
      if (input->cadence_ticks != lifecycle_cadence_ticks) {
        return std::unexpected(civic::make_error(
            civic::ErrorCode::invalid_argument,
            "lifecycle provider cadence must match scheduler cadence"));
      }
      auto lifecycle = lifecycle_.tick(building, *typology, *input);
      if (!lifecycle) return std::unexpected(scheduler_error(lifecycle.error()));
      next.lifecycle = *lifecycle;
    }
    staged.push_back(std::move(next));
  }
  auto restored = store_.restore_buildings(std::span<const BuildingV2>{staged});
  if (!restored) return std::unexpected(scheduler_error(restored.error()));
  return {};
}

}  // namespace civic::urban
