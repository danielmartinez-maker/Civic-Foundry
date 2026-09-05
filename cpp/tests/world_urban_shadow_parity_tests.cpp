#include "civic/parity/ShadowParity.hpp"

#include "civic/cadastre/Cadastre.hpp"
#include "civic/urban/BuildingLifecycle.hpp"
#include "civic/world/WorldFoundation.hpp"

#include <gtest/gtest.h>
#include <nlohmann/json.hpp>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace {

using civic::cadastre::CadastralGraph;
using civic::cadastre::Parcel;
using civic::cadastre::parcel_id_from_external;
using civic::geometry::rectangle;
using civic::parity::ShadowHash64;
using civic::urban::BuildingLifecycle;
using civic::urban::BuildingLifecycleInput;
using civic::urban::BuildingLifecycleSystem;
using civic::urban::BuildingTypology;
using civic::urban::BuildingV2;
using civic::urban::UseType;
using civic::world::WorldConfig;
using civic::world::WorldFoundation;
using civic::world::WorldPreset;

const nlohmann::json& fixture() {
  static const nlohmann::json value = [] {
    const auto path = std::filesystem::path{CIVIC_REPO_ROOT}
        / "tests"
        / "fixtures"
        / "cpp-world-urban-shadow"
        / "baseline.json";
    std::ifstream stream{path};
    if (!stream) throw std::runtime_error("unable to open Task 18 shadow fixture");
    return nlohmann::json::parse(stream);
  }();
  return value;
}

WorldPreset world_preset(const std::string& value) {
  if (value == "plain") return WorldPreset::plain;
  if (value == "river_valley") return WorldPreset::river_valley;
  if (value == "basin") return WorldPreset::basin;
  if (value == "rolling_uplands") return WorldPreset::rolling_uplands;
  if (value == "ridge_edge") return WorldPreset::ridge_edge;
  if (value == "coastal_lowland") return WorldPreset::coastal_lowland;
  throw std::runtime_error("unknown world preset in Task 18 fixture");
}

std::string world_hash() {
  const auto& source = fixture().at("world");
  const auto generated = WorldFoundation::generate(
      source.at("seed").get<std::uint32_t>(),
      WorldConfig{
          .width = source.at("width").get<std::uint32_t>(),
          .height = source.at("height").get<std::uint32_t>(),
          .meters_per_cell = source.at("metersPerCell").get<double>(),
          .preset = world_preset(source.at("preset").get<std::string>()),
      });
  if (!generated) throw std::runtime_error(generated.error().message);
  return civic::parity::shadow_hex(generated->deterministic_hash());
}

CadastralGraph cadastre_fixture() {
  CadastralGraph graph;
  for (const auto& source : fixture().at("cadastre").at("parcels")) {
    const auto external_id = source.at("id").get<std::string>();
    const auto min_x_cm = static_cast<civic::geometry::Coordinate>(
        std::llround(source.at("minX").get<double>() * 100.0));
    const auto min_y_cm = static_cast<civic::geometry::Coordinate>(
        std::llround(source.at("minY").get<double>() * 100.0));
    const auto max_x_cm = static_cast<civic::geometry::Coordinate>(
        std::llround(source.at("maxX").get<double>() * 100.0));
    const auto max_y_cm = static_cast<civic::geometry::Coordinate>(
        std::llround(source.at("maxY").get<double>() * 100.0));

    Parcel parcel;
    parcel.id = parcel_id_from_external(external_id);
    parcel.external_id = external_id;
    parcel.block_id = source.at("blockId").get<std::string>();
    parcel.boundary = rectangle(min_x_cm, min_y_cm, max_x_cm, max_y_cm);
    parcel.zoning_district_id = source.at("zoningDistrictId").get<std::string>();
    parcel.owner_id = source.at("ownerId").get<std::string>();
    const auto inserted = graph.insert(std::move(parcel));
    if (!inserted) throw std::runtime_error(inserted.error().message);
  }
  return graph;
}

std::string cadastre_hash() {
  auto graph = cadastre_fixture();
  auto parcels = graph.live_parcels();
  std::sort(parcels.begin(), parcels.end(), [](const Parcel* left, const Parcel* right) {
    return left->external_id < right->external_id;
  });

  ShadowHash64 hash;
  for (const auto* parcel : parcels) {
    hash.mix_string(parcel->external_id);
    hash.mix_string(parcel->block_id);
    for (const auto& point : parcel->boundary.vertices) {
      hash.mix_u64(static_cast<std::uint64_t>(point.x));
      hash.mix_u64(static_cast<std::uint64_t>(point.y));
    }
    hash.mix_string(parcel->zoning_district_id);
    hash.mix_string(parcel->owner_id.value_or(""));
  }
  return hash.hex();
}

BuildingTypology typology_fixture() {
  const auto& source = fixture().at("urban").at("typology");
  BuildingTypology typology;
  typology.id = source.at("id").get<std::string>();
  typology.name = "Main Street Mixed Use";
  typology.primary_use = UseType::residential;
  typology.allowed_uses = {UseType::residential, UseType::retail, UseType::office};
  typology.preferred_stories = 5;
  typology.min_stories = 3;
  typology.max_stories = 8;
  typology.floor_to_floor_height_meters = 3.2;
  typology.efficiency_ratio = 0.8;
  typology.cost_per_m2 = 625.0;
  typology.maintenance_cost_per_m2 = source.at("maintenanceCostPerM2").get<double>();
  typology.construction_ticks_per_1000_m2 = 40.0;
  typology.average_residential_unit_area_m2 = 80.0;
  typology.power_demand_per_1000_m2 = 1.0;
  typology.water_demand_per_1000_m2 = 1.0;
  typology.garbage_per_1000_m2 = 1.0;
  typology.tax_base_per_m2 = 1.0;
  typology.operating_expense_ratio = 0.3;
  typology.base_vacancy = 0.1;
  typology.base_cap_rate = 0.06;
  typology.complexity_factor = source.at("complexityFactor").get<double>();
  typology.risk_weight = 0.2;
  typology.conversion_suitability = 0.82;
  return typology;
}

BuildingV2 building_fixture() {
  const auto& source = fixture().at("urban").at("building");
  BuildingV2 building;
  building.external_id = source.at("id").get<std::string>();
  building.id = civic::urban::building_id_from_external(building.external_id);
  const auto parcel_external = source.at("parcelId").get<std::string>();
  building.parcel_id = parcel_id_from_external(parcel_external);
  building.parcel_ids = {building.parcel_id};
  building.typology_id = fixture().at("urban").at("typology").at("id").get<std::string>();
  building.footprint = rectangle(0, 0, 2000, 2000);
  building.gross_floor_area_m2 = source.at("grossFloorAreaM2").get<double>();
  building.usable_floor_area_m2 = 3200.0;
  building.height_meters = 16.0;
  building.stories = 5;
  building.realized_far = 4.0;
  building.coverage_ratio = 0.4;
  building.status = civic::urban::BuildingStatus::occupied;
  building.year_built = 2000;
  building.project_cost = 2'500'000.0;
  building.lifecycle = BuildingLifecycle{
      .age_ticks = source.at("ageTicks").get<std::uint64_t>(),
      .condition = source.at("condition").get<double>(),
      .structural_condition = source.at("structuralCondition").get<double>(),
      .systems_condition = source.at("systemsCondition").get<double>(),
      .exterior_condition = source.at("exteriorCondition").get<double>(),
      .maintenance_backlog = source.at("maintenanceBacklog").get<double>(),
      .deferred_maintenance_ticks = source.at("deferredMaintenanceTicks").get<std::uint64_t>(),
      .last_major_renovation_tick = std::nullopt,
      .effective_age = source.at("effectiveAge").get<double>(),
      .vacancy_duration_ticks = source.at("vacancyDurationTicks").get<double>(),
      .distress_score = source.at("distressScore").get<double>(),
  };
  return building;
}

BuildingLifecycleInput lifecycle_input(const nlohmann::json& source) {
  return BuildingLifecycleInput{
      .maintenance_spend = source.at("maintenanceSpend").get<double>(),
      .occupancy_ratio = source.at("occupancyRatio").get<double>(),
      .utilization_ratio = source.at("utilizationRatio").get<double>(),
      .environmental_stress = source.at("environmentalStress").get<double>(),
      .service_stress = source.at("serviceStress").get<double>(),
      .cadence_ticks = source.at("cadenceTicks").get<std::uint64_t>(),
  };
}

std::string hash_lifecycle(const BuildingV2& building) {
  const auto& state = building.lifecycle;
  ShadowHash64 hash;
  hash.mix_string(building.external_id);
  hash.mix_string(building.typology_id);
  hash.mix_u64(state.age_ticks);
  hash.mix_u64(static_cast<std::uint64_t>(std::llround(state.condition * 1e9)));
  hash.mix_u64(static_cast<std::uint64_t>(std::llround(state.structural_condition * 1e9)));
  hash.mix_u64(static_cast<std::uint64_t>(std::llround(state.systems_condition * 1e9)));
  hash.mix_u64(static_cast<std::uint64_t>(std::llround(state.exterior_condition * 1e9)));
  hash.mix_u64(static_cast<std::uint64_t>(std::llround(state.maintenance_backlog * 1e6)));
  hash.mix_u64(state.deferred_maintenance_ticks);
  hash.mix_u64(static_cast<std::uint64_t>(std::llround(state.effective_age * 1e9)));
  hash.mix_u64(static_cast<std::uint64_t>(std::llround(state.vacancy_duration_ticks * 1e6)));
  hash.mix_u64(static_cast<std::uint64_t>(std::llround(state.distress_score * 1e9)));
  return hash.hex();
}

std::vector<std::string> short_urban_hashes() {
  auto building = building_fixture();
  const auto typology = typology_fixture();
  const BuildingLifecycleSystem lifecycle;
  const auto& source = fixture().at("urban").at("short");
  const auto input = lifecycle_input(source.at("input"));
  std::vector<std::string> hashes;
  for (std::uint64_t tick = 1; tick <= source.at("ticks").get<std::uint64_t>(); ++tick) {
    const auto next = lifecycle.tick(building, typology, input);
    if (!next) throw std::runtime_error(next.error().message);
    building.lifecycle = *next;
    hashes.push_back(hash_lifecycle(building));
  }
  return hashes;
}

std::vector<std::string> long_urban_hashes() {
  auto building = building_fixture();
  const auto typology = typology_fixture();
  const BuildingLifecycleSystem lifecycle;
  const auto& source = fixture().at("urban").at("long");
  const auto input = lifecycle_input(source.at("input"));
  const auto step_ticks = source.at("stepTicks").get<std::uint64_t>();
  const auto total_ticks = source.at("ticks").get<std::uint64_t>();
  std::set<std::uint64_t> checkpoints;
  for (const auto& value : source.at("checkpoints")) {
    checkpoints.insert(value.get<std::uint64_t>());
  }

  std::vector<std::string> hashes;
  for (std::uint64_t tick = step_ticks; tick <= total_ticks; tick += step_ticks) {
    const auto next = lifecycle.tick(building, typology, input);
    if (!next) throw std::runtime_error(next.error().message);
    building.lifecycle = *next;
    if (checkpoints.contains(tick)) hashes.push_back(hash_lifecycle(building));
  }
  return hashes;
}

TEST(WorldUrbanShadowParity, SharedFixtureMatchesCrossLanguageGoldenHashes) {
  ASSERT_EQ(fixture().at("schemaVersion").get<int>(), 1);

  const nlohmann::json actual{
      {"worldHash", world_hash()},
      {"cadastreHash", cadastre_hash()},
      {"shortUrbanHashes", short_urban_hashes()},
      {"longUrbanHashes", long_urban_hashes()},
  };
  const auto& expected = fixture().at("expected");
  if (expected.at("worldHash") == "RECORD") {
    FAIL() << "TASK18_RECORD_CPP " << actual.dump();
  }
  EXPECT_EQ(actual, expected);
}

TEST(WorldUrbanShadowParity, FirstDifferenceReducerReportsEntityAndField) {
  const nlohmann::json expected{
      {"parcels", {
          {{"id", "parcel:a"}, {"zoning", "R2"}, {"owner", "owner:a"}},
          {{"id", "parcel:b"}, {"zoning", "C1"}, {"owner", "owner:b"}},
      }},
  };
  auto actual = expected;
  actual["parcels"][1]["zoning"] = "C2";

  const auto difference = civic::parity::first_shadow_difference(expected, actual);
  ASSERT_TRUE(difference.has_value());
  EXPECT_EQ(difference->path, "$.parcels[1].zoning");
  EXPECT_EQ(difference->expected, "C1");
  EXPECT_EQ(difference->actual, "C2");
}

}  // namespace
