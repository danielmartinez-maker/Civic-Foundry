#include <gtest/gtest.h>
#include "civic/urban/BuildingMassing.hpp"
#include "civic/urban/UrbanFabric.hpp"
#include <algorithm>
#include <cmath>
#include <numeric>
#include <string>
#include <vector>

namespace {
using civic::cadastre::CadastralGraph;
using civic::cadastre::Parcel;
using civic::core::ParcelId;
using civic::geometry::Polygon;
using civic::urban::BuildingFloor;
using civic::urban::BuildingLifecycle;
using civic::urban::BuildingMassingSystem;
using civic::urban::BuildingProjectKind;
using civic::urban::BuildingProjectPhase;
using civic::urban::BuildingProjectState;
using civic::urban::BuildingStatus;
using civic::urban::BuildingTypology;
using civic::urban::BuildingV2;
using civic::urban::DevelopmentCandidate;
using civic::urban::FloorUseAllocation;
using civic::urban::ParcelDevelopmentEnvelope;
using civic::urban::UrbanFabricStore;
using civic::urban::UseMixEntry;
using civic::urban::UseType;

Parcel make_parcel(std::string external, std::int64_t min_x, std::int64_t min_y,
                   std::int64_t max_x, std::int64_t max_y) {
  Parcel parcel;
  parcel.external_id = std::move(external);
  parcel.id = civic::cadastre::parcel_id_from_external(parcel.external_id);
  parcel.block_id = "block:building";
  parcel.zoning_district_id = "MU4";
  parcel.owner_id = "owner:building";
  parcel.boundary = civic::geometry::rectangle(min_x, min_y, max_x, max_y);
  return parcel;
}

BuildingLifecycle new_lifecycle() {
  return BuildingLifecycle{
      .age_ticks = 0,
      .condition = 100.0,
      .structural_condition = 100.0,
      .systems_condition = 100.0,
      .exterior_condition = 100.0,
      .maintenance_backlog = 0.0,
      .deferred_maintenance_ticks = 0,
      .last_major_renovation_tick = std::nullopt,
      .effective_age = 0.0,
      .vacancy_duration_ticks = 0,
      .distress_score = 0.0,
  };
}

BuildingV2 building_fixture(ParcelId parcel_id, std::string external_id,
                            Polygon footprint = civic::geometry::rectangle(500,500,2500,2500)) {
  const double footprint_area = civic::geometry::area_square_meters(footprint);
  const std::vector<BuildingFloor> floors{
      BuildingFloor{
          .level = 1,
          .elevation_meters = 0.0,
          .gross_area_m2 = 400.0,
          .usable_area_m2 = 320.0,
          .uses = {
              FloorUseAllocation{UseType::residential, 208.0, 3, 0, 0, 0.0},
              FloorUseAllocation{UseType::retail, 112.0, 0, 3, 0, 0.0},
          },
      },
      BuildingFloor{
          .level = 2,
          .elevation_meters = 3.2,
          .gross_area_m2 = 400.0,
          .usable_area_m2 = 320.0,
          .uses = {
              FloorUseAllocation{UseType::residential, 208.0, 3, 0, 0, 0.0},
              FloorUseAllocation{UseType::office, 112.0, 0, 5, 0, 0.0},
          },
      },
  };
  BuildingV2 building{};
  building.external_id = std::move(external_id);
  building.id = civic::urban::building_id_from_external(building.external_id);
  building.parcel_id = parcel_id;
  building.parcel_ids = {parcel_id};
  building.typology_id = "main_street_mixed_use";
  building.footprint = std::move(footprint);
  building.gross_floor_area_m2 = 800.0;
  building.usable_floor_area_m2 = 640.0;
  building.height_meters = 6.4;
  building.stories = 2;
  building.realized_far = 800.0 / 900.0;
  building.coverage_ratio = footprint_area / 900.0;
  building.floors = floors;
  building.status = BuildingStatus::occupied;
  building.year_built = 2026;
  building.developer_id = "developer:one";
  building.owner_id = "owner:building";
  building.project_cost = 1'250'000.0;
  building.entitlement = civic::urban::BuildingEntitlement{
      .approval_tick = 80,
      .zoning_district_id = "MU4",
      .approved_far = 4.0,
      .approved_height_meters = 30.0,
      .approved_uses = {UseType::residential, UseType::retail, UseType::office},
      .legal_nonconforming = false,
  };
  building.lifecycle = new_lifecycle();
  building.project = BuildingProjectState{
      .phase = BuildingProjectPhase::lease_up,
      .started_tick = 100,
      .completion_tick = 200,
      .progress = 1.0,
      .kind = BuildingProjectKind::new_build,
  };
  return building;
}

BuildingTypology mixed_typology() {
  BuildingTypology typology{};
  typology.id = "main_street_mixed_use";
  typology.name = "Main Street Mixed Use";
  typology.primary_use = UseType::residential;
  typology.allowed_uses = {UseType::residential, UseType::retail, UseType::office};
  typology.default_use_mix = {
      UseMixEntry{UseType::residential, 0.65},
      UseMixEntry{UseType::retail, 0.20},
      UseMixEntry{UseType::office, 0.15},
  };
  typology.preferred_stories = 5;
  typology.min_stories = 3;
  typology.max_stories = 8;
  typology.floor_to_floor_height_meters = 3.2;
  typology.efficiency_ratio = 0.80;
  typology.average_residential_unit_area_m2 = 82.0;
  typology.jobs_per_1000_m2_by_use = {
      UseMixEntry{UseType::retail, 28.0},
      UseMixEntry{UseType::office, 45.0},
  };
  return typology;
}

ParcelDevelopmentEnvelope envelope(ParcelId parcel_id) {
  return ParcelDevelopmentEnvelope{
      .parcel_id = parcel_id,
      .district_id = "MU4",
      .buildable_footprint = civic::geometry::rectangle(500,500,9500,9500),
      .parcel_area_m2 = 10'000.0,
      .frontage_meters = 100.0,
      .max_footprint_area_m2 = 6'000.0,
      .max_gross_floor_area_m2 = 20'000.0,
      .max_height_meters = 30.0,
      .max_stories = 8,
      .allowed_far = 4.0,
      .effective_far = 2.0,
      .effective_coverage_ratio = 0.60,
      .permitted_uses = {UseType::residential, UseType::retail, UseType::office, UseType::hospitality},
      .limiting_constraints = {},
  };
}

TEST(NativeBuildingV2Red, StorePreservesFullCanonicalStateAndStableIdentity) {
  CadastralGraph graph;
  auto parcel = make_parcel("parcel:building-store", 0, 0, 3000, 3000);
  const auto parcel_id = parcel.id;
  ASSERT_TRUE(graph.insert(std::move(parcel)).has_value());
  UrbanFabricStore store{&graph};

  auto building = building_fixture(parcel_id, "building:parcel:building-store:main_street_mixed_use:100");
  const auto building_id = building.id;
  ASSERT_TRUE(store.upsert_building(building).has_value());
  ASSERT_TRUE(store.validate().has_value());

  const auto* stored = store.find_building(building_id);
  ASSERT_NE(stored, nullptr);
  EXPECT_EQ(stored->id, civic::urban::building_id_from_external(stored->external_id));
  EXPECT_EQ(stored->parcel_ids, (std::vector<ParcelId>{parcel_id}));
  EXPECT_EQ(stored->typology_id, "main_street_mixed_use");
  EXPECT_EQ(stored->floors.size(), 2U);
  EXPECT_DOUBLE_EQ(stored->gross_floor_area_m2, 800.0);
  EXPECT_DOUBLE_EQ(stored->usable_floor_area_m2, 640.0);
  EXPECT_EQ(stored->entitlement.zoning_district_id, "MU4");
  EXPECT_EQ(stored->lifecycle.condition, 100.0);
  ASSERT_TRUE(stored->project.has_value());
  EXPECT_EQ(stored->project->phase, BuildingProjectPhase::lease_up);
  EXPECT_EQ(stored->owner_id, "owner:building");
}

TEST(NativeBuildingV2Red, StoreRejectsFootprintOutsideCanonicalParcelUnion) {
  CadastralGraph graph;
  auto left = make_parcel("parcel:left-building", 0, 0, 3000, 3000);
  auto right = make_parcel("parcel:right-building", 3000, 0, 6000, 3000);
  const auto left_id = left.id;
  const auto right_id = right.id;
  ASSERT_TRUE(graph.insert(std::move(left)).has_value());
  ASSERT_TRUE(graph.insert(std::move(right)).has_value());
  UrbanFabricStore store{&graph};

  auto legal = building_fixture(left_id, "building:legal", civic::geometry::rectangle(1000,500,5000,2500));
  legal.parcel_ids = {right_id, left_id};
  legal.parcel_id = left_id;
  legal.gross_floor_area_m2 = 1'600.0;
  legal.usable_floor_area_m2 = 1'280.0;
  legal.realized_far = 1'600.0 / 1'800.0;
  legal.coverage_ratio = 800.0 / 1'800.0;
  ASSERT_TRUE(store.upsert_building(legal).has_value());

  auto outside = building_fixture(left_id, "building:outside", civic::geometry::rectangle(1000,500,7000,2500));
  outside.parcel_ids = {left_id, right_id};
  EXPECT_FALSE(store.upsert_building(outside).has_value());
  EXPECT_EQ(store.find_building(civic::urban::building_id_from_external("building:outside")), nullptr);
}

TEST(NativeBuildingV2Red, RestoreIsAtomicAndRejectsDuplicateOrDivergentBuildings) {
  CadastralGraph graph;
  auto parcel = make_parcel("parcel:restore-building", 0, 0, 3000, 3000);
  const auto parcel_id = parcel.id;
  ASSERT_TRUE(graph.insert(std::move(parcel)).has_value());
  UrbanFabricStore store{&graph};
  auto initial = building_fixture(parcel_id, "building:initial");
  ASSERT_TRUE(store.upsert_building(initial).has_value());

  auto duplicate_a = building_fixture(parcel_id, "building:duplicate");
  auto duplicate_b = duplicate_a;
  duplicate_b.project_cost = 9'999.0;
  const std::vector<BuildingV2> duplicate{duplicate_a, duplicate_b};
  EXPECT_FALSE(store.restore_buildings(duplicate).has_value());
  ASSERT_EQ(store.buildings().size(), 1U);
  EXPECT_NE(store.find_building(initial.id), nullptr);

  auto invalid = building_fixture(parcel_id, "building:invalid-area");
  invalid.usable_floor_area_m2 = invalid.gross_floor_area_m2 + 1.0;
  EXPECT_FALSE(store.restore_buildings(std::vector<BuildingV2>{invalid}).has_value());
  ASSERT_EQ(store.buildings().size(), 1U);
  EXPECT_NE(store.find_building(initial.id), nullptr);
}

TEST(NativeBuildingV2Red, MixedUseMassingUsesStableCandidateIdsAndAcceptedUtilizations) {
  CadastralGraph graph;
  auto parcel = make_parcel("parcel:massing", 0, 0, 10000, 10000);
  const auto parcel_id = parcel.id;
  ASSERT_TRUE(graph.insert(parcel).has_value());
  const auto typology = mixed_typology();

  auto candidates = BuildingMassingSystem{}.generate(parcel, envelope(parcel_id), std::vector<BuildingTypology>{typology});
  ASSERT_EQ(candidates.size(), 4U);
  EXPECT_EQ(candidates[0].id, "candidate:parcel:massing:main_street_mixed_use:55");
  EXPECT_EQ(candidates[1].id, "candidate:parcel:massing:main_street_mixed_use:75");
  EXPECT_EQ(candidates[2].id, "candidate:parcel:massing:main_street_mixed_use:90");
  EXPECT_EQ(candidates[3].id, "candidate:parcel:massing:main_street_mixed_use:100");

  const std::vector<double> expected_targets{0.55, 0.75, 0.90, 1.00};
  for (std::size_t index = 0; index < candidates.size(); ++index) {
    const auto& candidate = candidates[index];
    EXPECT_DOUBLE_EQ(candidate.target_utilization, expected_targets[index]);
    EXPECT_TRUE(candidate.zoning_legal);
    EXPECT_EQ(candidate.parcel_ids, (std::vector<ParcelId>{parcel_id}));
    EXPECT_LE(candidate.gross_floor_area_m2, 20'000.0 + 1e-9);
    EXPECT_LE(candidate.height_meters, 30.0 + 1e-9);
    EXPECT_LE(candidate.stories, 8U);
    EXPECT_LE(candidate.realized_far, 2.0 + 1e-9);
    EXPECT_LE(candidate.coverage_ratio, 0.60 + 1e-9);
    auto outside = civic::geometry::polygon_difference(candidate.footprint, envelope(parcel_id).buildable_footprint);
    ASSERT_TRUE(outside.has_value());
    EXPECT_LE(civic::geometry::total_area_square_meters(*outside), 0.01);
  }
}

TEST(NativeBuildingV2Red, MixedUseFloorAreasConserveGrossUsableAndUseAllocation) {
  CadastralGraph graph;
  auto parcel = make_parcel("parcel:massing-conservation", 0, 0, 10000, 10000);
  ASSERT_TRUE(graph.insert(parcel).has_value());
  const auto candidates = BuildingMassingSystem{}.generate(
      parcel, envelope(parcel.id), std::vector<BuildingTypology>{mixed_typology()});
  ASSERT_FALSE(candidates.empty());

  for (const auto& candidate : candidates) {
    const double gross = std::accumulate(candidate.floors.begin(), candidate.floors.end(), 0.0,
        [](double total, const BuildingFloor& floor) { return total + floor.gross_area_m2; });
    const double usable = std::accumulate(candidate.floors.begin(), candidate.floors.end(), 0.0,
        [](double total, const BuildingFloor& floor) { return total + floor.usable_area_m2; });
    double allocated = 0.0;
    std::vector<UseType> uses;
    for (const auto& floor : candidate.floors) {
      for (const auto& allocation : floor.uses) {
        allocated += allocation.floor_area_m2;
        uses.push_back(allocation.use);
      }
    }
    std::sort(uses.begin(), uses.end());
    uses.erase(std::unique(uses.begin(), uses.end()), uses.end());
    EXPECT_NEAR(gross, candidate.gross_floor_area_m2, 0.01);
    EXPECT_NEAR(usable, candidate.usable_floor_area_m2, 0.01);
    EXPECT_NEAR(allocated, candidate.usable_floor_area_m2, 0.01);
    EXPECT_EQ(uses, candidate.uses);
    EXPECT_NE(std::find(uses.begin(), uses.end(), UseType::residential), uses.end());
    EXPECT_NE(std::find(uses.begin(), uses.end(), UseType::retail), uses.end());
    EXPECT_NE(std::find(uses.begin(), uses.end(), UseType::office), uses.end());
  }
}

TEST(NativeBuildingV2Red, CandidateIdentityIsIndependentOfTypologyInputOrder) {
  CadastralGraph graph;
  auto parcel = make_parcel("parcel:massing-order", 0, 0, 10000, 10000);
  ASSERT_TRUE(graph.insert(parcel).has_value());

  auto mixed = mixed_typology();
  auto office = mixed_typology();
  office.id = "office_test";
  office.name = "Office Test";
  office.primary_use = UseType::office;
  office.allowed_uses = {UseType::office};
  office.default_use_mix = {UseMixEntry{UseType::office, 1.0}};

  auto first = BuildingMassingSystem{}.generate(parcel, envelope(parcel.id), std::vector<BuildingTypology>{mixed, office});
  auto second = BuildingMassingSystem{}.generate(parcel, envelope(parcel.id), std::vector<BuildingTypology>{office, mixed});
  std::vector<std::string> first_ids;
  std::vector<std::string> second_ids;
  for (const auto& candidate : first) first_ids.push_back(candidate.id);
  for (const auto& candidate : second) second_ids.push_back(candidate.id);
  EXPECT_EQ(first_ids, second_ids);
}
}  // namespace
