#include "civic/core/Kernel.hpp"
#include "civic/urban/BuildingLifecycle.hpp"
#include "civic/urban/BuildingMassing.hpp"
#include "civic/urban/UrbanFabric.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <string>
#include <vector>

namespace civic::urban {
namespace {

BuildingTypology typology_fixture() {
  BuildingTypology typology;
  typology.id = "main_street_mixed_use";
  typology.name = "Main Street Mixed Use";
  typology.primary_use = UseType::residential;
  typology.allowed_uses = {UseType::residential, UseType::retail, UseType::office};
  typology.default_use_mix = {
      {UseType::residential, 0.65},
      {UseType::retail, 0.20},
      {UseType::office, 0.15},
  };
  typology.preferred_stories = 5;
  typology.min_stories = 3;
  typology.max_stories = 8;
  typology.floor_to_floor_height_meters = 3.2;
  typology.efficiency_ratio = 0.8;
  typology.maintenance_cost_per_m2 = 24.0;
  typology.complexity_factor = 1.1;
  typology.conversion_suitability = 0.82;
  return typology;
}

BuildingV2 building_fixture(BuildingLifecycle lifecycle = {}) {
  BuildingV2 building;
  building.external_id = "building:lifecycle:1";
  building.id = building_id_from_external(building.external_id);
  building.parcel_id = civic::core::ParcelId{1};
  building.parcel_ids = {building.parcel_id};
  building.typology_id = "main_street_mixed_use";
  building.footprint.vertices = {{0, 0}, {2000, 0}, {2000, 2000}, {0, 2000}};
  building.gross_floor_area_m2 = 4'000.0;
  building.usable_floor_area_m2 = 3'200.0;
  building.height_meters = 16.0;
  building.stories = 5;
  building.realized_far = 4.0;
  building.coverage_ratio = 0.4;
  building.status = BuildingStatus::occupied;
  building.year_built = 2000;
  building.project_cost = 2'500'000.0;
  building.entitlement.approval_tick = 0;
  building.entitlement.zoning_district_id = "MU4";
  building.entitlement.approved_far = 4.0;
  building.entitlement.approved_height_meters = 20.0;
  building.entitlement.approved_uses = {UseType::residential, UseType::retail};
  building.lifecycle = lifecycle;
  return building;
}

BuildingLifecycleInput lifecycle_input(double maintenance_spend = 0.0, double occupancy = 0.90) {
  return BuildingLifecycleInput{
      .maintenance_spend = maintenance_spend,
      .occupancy_ratio = occupancy,
      .utilization_ratio = 0.75,
      .environmental_stress = 0.10,
      .service_stress = 0.10,
      .cadence_ticks = 25,
  };
}

RenovationMarketContext market_fixture() {
  return RenovationMarketContext{
      .current_property_value = 2'000'000.0,
      .projected_property_value = 8'000'000.0,
      .hurdle_rate = 0.12,
      .financing_rate = 0.06,
  };
}

ParcelDevelopmentEnvelope envelope_fixture(std::vector<UseType> uses) {
  ParcelDevelopmentEnvelope envelope;
  envelope.parcel_id = civic::core::ParcelId{1};
  envelope.district_id = "MU4";
  envelope.buildable_footprint.vertices = {{0, 0}, {2000, 0}, {2000, 2000}, {0, 2000}};
  envelope.parcel_area_m2 = 1'000.0;
  envelope.frontage_meters = 20.0;
  envelope.max_footprint_area_m2 = 600.0;
  envelope.max_gross_floor_area_m2 = 4'000.0;
  envelope.max_height_meters = 30.0;
  envelope.max_stories = 8;
  envelope.allowed_far = 4.0;
  envelope.effective_far = 4.0;
  envelope.effective_coverage_ratio = 0.6;
  envelope.permitted_uses = std::move(uses);
  return envelope;
}

void run_scheduler(civic::SystemScheduler& scheduler, std::uint64_t first_tick, std::uint64_t last_tick) {
  for (std::uint64_t tick = first_tick; tick <= last_tick; ++tick) {
    auto due = scheduler.dueSystems(tick);
    ASSERT_TRUE(due) << due.error().message;
    for (auto* system : *due) {
      auto result = system->execute(tick);
      ASSERT_TRUE(result) << result.error().message;
    }
  }
}

TEST(BuildingLifecycleParity, AdequateMaintenanceSlowsDeteriorationAndBacklogGrowth) {
  const auto typology = typology_fixture();
  BuildingLifecycle initial;
  initial.age_ticks = 2'500;
  initial.effective_age = 10.0;
  initial.condition = 78.0;
  initial.structural_condition = 78.0;
  initial.systems_condition = 78.0;
  initial.exterior_condition = 78.0;
  initial.maintenance_backlog = 12'000.0;
  const auto building = building_fixture(initial);

  const auto required = required_maintenance_cost(building, typology);
  ASSERT_TRUE(required) << required.error().message;
  const auto neglected = BuildingLifecycleSystem{}.tick(building, typology, lifecycle_input(0.0));
  const auto maintained = BuildingLifecycleSystem{}.tick(building, typology, lifecycle_input(*required));
  ASSERT_TRUE(neglected) << neglected.error().message;
  ASSERT_TRUE(maintained) << maintained.error().message;

  EXPECT_GT(maintained->condition, neglected->condition);
  EXPECT_LT(maintained->maintenance_backlog, neglected->maintenance_backlog);
  EXPECT_LT(maintained->deferred_maintenance_ticks, neglected->deferred_maintenance_ticks);
}

TEST(BuildingLifecycleParity, ChronicVacancyRaisesDistressDeterministically) {
  const auto typology = typology_fixture();
  BuildingLifecycle vacant;
  vacant.age_ticks = 1'000;
  vacant.effective_age = 4.0;
  vacant.condition = 82.0;
  vacant.structural_condition = 82.0;
  vacant.systems_condition = 82.0;
  vacant.exterior_condition = 82.0;
  BuildingLifecycle occupied = vacant;

  for (int cycle = 0; cycle < 12; ++cycle) {
    const auto vacant_building = building_fixture(vacant);
    const auto occupied_building = building_fixture(occupied);
    const auto vacant_required = required_maintenance_cost(vacant_building, typology);
    const auto occupied_required = required_maintenance_cost(occupied_building, typology);
    ASSERT_TRUE(vacant_required);
    ASSERT_TRUE(occupied_required);
    auto next_vacant = BuildingLifecycleSystem{}.tick(vacant_building, typology, lifecycle_input(*vacant_required, 0.05));
    auto next_occupied = BuildingLifecycleSystem{}.tick(occupied_building, typology, lifecycle_input(*occupied_required, 0.95));
    ASSERT_TRUE(next_vacant);
    ASSERT_TRUE(next_occupied);
    vacant = *next_vacant;
    occupied = *next_occupied;
  }

  EXPECT_GT(vacant.vacancy_duration_ticks, occupied.vacancy_duration_ticks);
  EXPECT_GT(vacant.distress_score, occupied.distress_score);
  EXPECT_LT(vacant.condition, occupied.condition);
}

TEST(BuildingLifecycleParity, RentFactorMatchesAcceptedBands) {
  const auto perfect = condition_rent_factor(100.0);
  const auto sixty = condition_rent_factor(60.0);
  const auto thirty_four = condition_rent_factor(34.0);
  const auto nineteen = condition_rent_factor(19.0);
  ASSERT_TRUE(perfect && sixty && thirty_four && nineteen);
  EXPECT_DOUBLE_EQ(*perfect, 1.0);
  EXPECT_LT(*thirty_four, *sixty);
  EXPECT_LT(*nineteen, *thirty_four);
}

TEST(BuildingRenovationParity, MajorRenovationRequiresRelocationAndCompletesDeterministically) {
  auto typology = typology_fixture();
  BuildingLifecycle lifecycle;
  lifecycle.condition = 48.0;
  lifecycle.structural_condition = 55.0;
  lifecycle.systems_condition = 38.0;
  lifecycle.exterior_condition = 35.0;
  lifecycle.effective_age = 30.0;
  lifecycle.maintenance_backlog = 50'000.0;
  auto building = building_fixture(lifecycle);

  RenovationSystem renovation;
  const auto proposal = renovation.propose(building, typology, market_fixture(), RenovationScope::major);
  ASSERT_TRUE(proposal) << proposal.error().message;
  EXPECT_TRUE(proposal->feasible);
  EXPECT_TRUE(proposal->requires_vacancy);
  EXPECT_EQ(proposal->duration_ticks, 55U);
  EXPECT_GE(proposal->projected_condition, 82.0);
  EXPECT_LT(proposal->projected_effective_age, 30.0);

  const auto blocked = renovation.start(building, *proposal, 100, false);
  EXPECT_FALSE(blocked);

  const auto started = renovation.start(building, *proposal, 100, true);
  ASSERT_TRUE(started) << started.error().message;
  EXPECT_EQ(started->status, BuildingStatus::renovation);
  ASSERT_TRUE(started->project);
  EXPECT_EQ(started->project->phase, BuildingProjectPhase::fit_out);
  ASSERT_TRUE(started->project->completion_tick);
  EXPECT_EQ(*started->project->completion_tick, 155U);

  const auto completed = renovation.tick(*started, 155);
  ASSERT_TRUE(completed) << completed.error().message;
  EXPECT_EQ(completed->status, BuildingStatus::occupied);
  ASSERT_TRUE(completed->project);
  EXPECT_EQ(completed->project->phase, BuildingProjectPhase::none);
  EXPECT_DOUBLE_EQ(completed->lifecycle.maintenance_backlog, 0.0);
  ASSERT_TRUE(completed->lifecycle.last_major_renovation_tick);
  EXPECT_EQ(*completed->lifecycle.last_major_renovation_tick, 155U);
}

TEST(BuildingRenovationParity, AdaptiveReuseHonorsZoningAndAddsDestinationUseOnCompletion) {
  const auto typology = typology_fixture();
  const auto building = building_fixture();
  RenovationSystem renovation;

  const auto prohibited = renovation.evaluate_adaptive_reuse(
      building,
      typology,
      UseType::office,
      envelope_fixture({UseType::residential, UseType::retail}),
      market_fixture());
  ASSERT_TRUE(prohibited) << prohibited.error().message;
  EXPECT_FALSE(prohibited->feasible);
  EXPECT_NE(std::find(prohibited->rejection_reasons.begin(), prohibited->rejection_reasons.end(), "destination-use-prohibited"),
            prohibited->rejection_reasons.end());

  const auto allowed = renovation.evaluate_adaptive_reuse(
      building,
      typology,
      UseType::office,
      envelope_fixture({UseType::residential, UseType::retail, UseType::office}),
      market_fixture());
  ASSERT_TRUE(allowed) << allowed.error().message;
  ASSERT_TRUE(allowed->feasible);
  const auto started = renovation.start(building, *allowed, 200, true);
  ASSERT_TRUE(started) << started.error().message;
  const auto completed = renovation.tick(*started, 290);
  ASSERT_TRUE(completed) << completed.error().message;
  EXPECT_NE(std::find(completed->entitlement.approved_uses.begin(), completed->entitlement.approved_uses.end(), UseType::office),
            completed->entitlement.approved_uses.end());
}

TEST(BuildingLifecycleIntegration, NativeSchedulerActuallyDrivesLifecycleAtDeclaredCadence) {
  UrbanFabricStore store;
  store.register_parcel(civic::core::ParcelId{1});
  ASSERT_TRUE(store.upsert_building(building_fixture()));

  int provider_calls = 0;
  BuildingLifecycleDriver driver(
      store,
      {typology_fixture()},
      [&provider_calls](const BuildingV2&, std::uint64_t) -> civic::core::Result<BuildingLifecycleInput> {
        ++provider_calls;
        return lifecycle_input(0.0, 0.90);
      });
  civic::SystemScheduler scheduler;
  ASSERT_TRUE(driver.register_with(scheduler));
  ASSERT_TRUE(scheduler.compile());

  run_scheduler(scheduler, 1, 100);
  const auto* building = store.find_building(building_id_from_external("building:lifecycle:1"));
  ASSERT_NE(building, nullptr);
  EXPECT_EQ(provider_calls, 4);
  EXPECT_EQ(building->lifecycle.age_ticks, 100U);
  EXPECT_GT(building->lifecycle.maintenance_backlog, 0.0);
}

TEST(BuildingLifecycleIntegration, LongHorizonScheduledRunIsDeterministic) {
  const auto run = []() {
    UrbanFabricStore store;
    store.register_parcel(civic::core::ParcelId{1});
    EXPECT_TRUE(store.upsert_building(building_fixture()));
    BuildingLifecycleDriver driver(
        store,
        {typology_fixture()},
        [](const BuildingV2&, std::uint64_t) -> civic::core::Result<BuildingLifecycleInput> {
          return lifecycle_input(0.0, 0.15);
        });
    civic::SystemScheduler scheduler;
    EXPECT_TRUE(driver.register_with(scheduler));
    EXPECT_TRUE(scheduler.compile());
    run_scheduler(scheduler, 1, 2'500);
    const auto* building = store.find_building(building_id_from_external("building:lifecycle:1"));
    EXPECT_NE(building, nullptr);
    return building == nullptr ? BuildingLifecycle{} : building->lifecycle;
  };

  const auto first = run();
  const auto second = run();
  EXPECT_EQ(first.age_ticks, 2'500U);
  EXPECT_DOUBLE_EQ(first.condition, second.condition);
  EXPECT_DOUBLE_EQ(first.structural_condition, second.structural_condition);
  EXPECT_DOUBLE_EQ(first.systems_condition, second.systems_condition);
  EXPECT_DOUBLE_EQ(first.exterior_condition, second.exterior_condition);
  EXPECT_DOUBLE_EQ(first.maintenance_backlog, second.maintenance_backlog);
  EXPECT_EQ(first.deferred_maintenance_ticks, second.deferred_maintenance_ticks);
  EXPECT_DOUBLE_EQ(first.effective_age, second.effective_age);
  EXPECT_EQ(first.vacancy_duration_ticks, second.vacancy_duration_ticks);
  EXPECT_DOUBLE_EQ(first.distress_score, second.distress_score);
}

}  // namespace
}  // namespace civic::urban