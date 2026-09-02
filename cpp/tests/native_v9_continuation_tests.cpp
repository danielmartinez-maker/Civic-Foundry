#include <gtest/gtest.h>

#include <nlohmann/json.hpp>

#include "civic/core/NativeEngine.hpp"
#include "civic/urban/NativeUrbanAuthority.hpp"

namespace {
using nlohmann::json;

json base_snapshot() {
  const json request{
      {"terrain", json::array({{{"x", 0}, {"y", 0}, {"buildable", true}}})},
      {"roads", json::array()},
      {"zoning", json::array({{{"x", 0}, {"y", 0}, {"zoningDistrictId", "residential"}}})},
  };
  auto authority = civic::NativeUrbanAuthority::rebuildLegacy(request.dump());
  EXPECT_TRUE(authority.has_value());
  if (!authority) return json::object();
  auto snapshot = (*authority)->snapshotJson();
  EXPECT_TRUE(snapshot.has_value());
  return snapshot ? json::parse(*snapshot) : json::object();
}

json lifecycle() {
  return {
      {"ageTicks", 0},
      {"condition", 90.0},
      {"structuralCondition", 90.0},
      {"systemsCondition", 90.0},
      {"exteriorCondition", 90.0},
      {"maintenanceBacklog", 0.0},
      {"deferredMaintenanceTicks", 0},
      {"effectiveAge", 0.0},
      {"vacancyDurationTicks", 0.0},
      {"distressScore", 0.0},
  };
}

json building() {
  return {
      {"id", "building:continuation:1"},
      {"parcelIds", json::array({"parcel:0,0"})},
      {"typologyId", "typology:continuation"},
      {"footprint", json::array({
          {{"x", 2.0}, {"y", 2.0}},
          {{"x", 10.0}, {"y", 2.0}},
          {{"x", 10.0}, {"y", 10.0}},
          {{"x", 2.0}, {"y", 10.0}},
      })},
      {"grossFloorAreaM2", 64.0},
      {"usableFloorAreaM2", 60.0},
      {"heightMeters", 3.2},
      {"stories", 1},
      {"realizedFAR", 0.16},
      {"coverageRatio", 0.16},
      {"floors", json::array({
          {
              {"level", 1},
              {"elevationMeters", 0.0},
              {"grossAreaM2", 64.0},
              {"usableAreaM2", 60.0},
              {"uses", json::array({
                  {
                      {"use", "residential"},
                      {"floorAreaM2", 60.0},
                      {"residentialUnits", 1},
                  },
              })},
          },
      })},
      {"status", "occupied"},
      {"yearBuilt", 0},
      {"projectCost", 100000.0},
      {"entitlement", {
          {"approvalTick", 0},
          {"zoningDistrictId", "residential"},
          {"approvedFAR", 1.0},
          {"approvedHeightMeters", 10.0},
          {"approvedUses", json::array({"residential"})},
      }},
      {"lifecycle", lifecycle()},
  };
}

json runtime_command(const json& building_state, bool hbu_for_new) {
  json command{
      {"type", "buildings.reconcile"},
      {"buildingsV2", json::array({building_state})},
      {"typologies", json::array({
          {
              {"id", "typology:continuation"},
              {"name", "Continuation Fixture"},
              {"maintenanceCostPerM2", 1.0},
              {"complexityFactor", 1.0},
          },
      })},
      {"lifecycleInputs", json::array({
          {
              {"buildingId", "building:continuation:1"},
              {"maintenanceSpend", 0.0},
              {"occupancyRatio", 0.9},
              {"utilizationRatio", 0.75},
              {"environmentalStress", 0.1},
              {"serviceStress", 0.1},
          },
      })},
  };
  if (hbu_for_new) {
    command["requireHbuForNewBuildings"] = true;
    command["hbuApprovals"] = json::array({
        {
            {"buildingId", "building:continuation:1"},
            {"candidateId", "candidate:continuation:1"},
            {"parcelIds", json::array({"parcel:0,0"})},
            {"zoningLegal", true},
            {"hbuInput", {
                {"parcelIds", json::array({"parcel:0,0"})},
                {"holdValue", 100.0},
                {"buildingCondition", 0.0},
                {"developerHurdleRate", 0.10},
                {"renovationNetValue", 0.0},
                {"renovationExpectedReturn", 0.0},
                {"renovationRiskScore", 0.0},
                {"conversionNetValue", 0.0},
                {"conversionExpectedReturn", 0.0},
                {"conversionRiskScore", 0.0},
                {"redevelopmentNetValue", 200.0},
                {"redevelopmentExpectedReturn", 0.30},
                {"redevelopmentRiskScore", 0.10},
            }},
        },
    });
  }
  return command;
}

json initial_save(const json& snapshot) {
  return {
      {"saveVersion", 9},
      {"gameVersion", "0.9.0-urban-fabric"},
      {"seed", 23},
      {"clock", {{"tick", 0}, {"speed", 1}}},
      {"terrain", json::object()},
      {"world", json::object()},
      {"urbanFabric", snapshot.at("urbanFabric")},
      {"zoningV2", snapshot.at("zoningV2")},
      {"buildingsV2", snapshot.at("buildingsV2")},
      {"propertyMarket", snapshot.at("propertyMarket")},
  };
}

TEST(NativeV9Continuation, SaveLoadContinueMatchesUninterruptedNativeUrbanFuture) {
  const auto empty = base_snapshot();
  auto first = civic::NativeEngine::create({.seed = 23, .startTick = 0, .speed = civic::SpeedMode::normal});
  ASSERT_TRUE(first.has_value()) << first.error().message;
  auto loaded = (*first)->loadV9Authoritative(initial_save(empty).dump());
  ASSERT_TRUE(loaded.has_value()) << loaded.error().message;

  auto admitted = (*first)->applyUrbanCommand(runtime_command(building(), true).dump());
  ASSERT_TRUE(admitted.has_value()) << admitted.error().message;
  ASSERT_TRUE(json::parse(admitted->json).at("result").at("committed").get<bool>());

  auto first_leg = (*first)->step(25);
  ASSERT_TRUE(first_leg.has_value()) << first_leg.error().message;
  ASSERT_EQ((*first)->tick(), 25U);

  auto saved = (*first)->saveV9Authoritative();
  ASSERT_TRUE(saved.has_value()) << saved.error().message;
  const auto saved_json = json::parse(*saved);
  EXPECT_EQ(saved_json.at("clock").at("tick"), 25);
  EXPECT_EQ(saved_json.at("clock").at("speed"), 1);
  ASSERT_EQ(saved_json.at("buildingsV2").at(0).at("lifecycle").at("ageTicks"), 25);

  auto resumed = civic::NativeEngine::create({});
  ASSERT_TRUE(resumed.has_value()) << resumed.error().message;
  auto resumed_load = (*resumed)->loadV9Authoritative(*saved);
  ASSERT_TRUE(resumed_load.has_value()) << resumed_load.error().message;
  ASSERT_EQ((*resumed)->tick(), 25U);

  auto first_snapshot = (*first)->urbanSnapshot();
  auto resumed_snapshot = (*resumed)->urbanSnapshot();
  ASSERT_TRUE(first_snapshot.has_value());
  ASSERT_TRUE(resumed_snapshot.has_value());
  EXPECT_EQ(json::parse(first_snapshot->json), json::parse(resumed_snapshot->json));

  const auto current_building = json::parse(first_snapshot->json).at("buildingsV2").at(0);
  auto refresh = runtime_command(current_building, false);
  auto first_runtime = (*first)->applyUrbanCommand(refresh.dump());
  auto resumed_runtime = (*resumed)->applyUrbanCommand(refresh.dump());
  ASSERT_TRUE(first_runtime.has_value()) << first_runtime.error().message;
  ASSERT_TRUE(resumed_runtime.has_value()) << resumed_runtime.error().message;

  auto uninterrupted = (*first)->step(25);
  auto continued = (*resumed)->step(25);
  ASSERT_TRUE(uninterrupted.has_value()) << uninterrupted.error().message;
  ASSERT_TRUE(continued.has_value()) << continued.error().message;
  EXPECT_EQ((*first)->tick(), 50U);
  EXPECT_EQ((*resumed)->tick(), 50U);

  first_snapshot = (*first)->urbanSnapshot();
  resumed_snapshot = (*resumed)->urbanSnapshot();
  ASSERT_TRUE(first_snapshot.has_value());
  ASSERT_TRUE(resumed_snapshot.has_value());
  EXPECT_EQ(json::parse(first_snapshot->json), json::parse(resumed_snapshot->json));

  auto first_final_save = (*first)->saveV9Authoritative();
  auto resumed_final_save = (*resumed)->saveV9Authoritative();
  ASSERT_TRUE(first_final_save.has_value());
  ASSERT_TRUE(resumed_final_save.has_value());
  EXPECT_EQ(json::parse(*first_final_save), json::parse(*resumed_final_save));
  EXPECT_EQ(json::parse(*first_final_save).at("clock").at("tick"), 50);
}

}  // namespace
