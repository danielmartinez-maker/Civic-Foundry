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

json lifecycle_fixture() {
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

json occupied_building() {
  return {
      {"id", "building:transaction:1"},
      {"parcelIds", json::array({"parcel:0,0"})},
      {"typologyId", "typology:transaction"},
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
      {"yearBuilt", 2026},
      {"projectCost", 100000.0},
      {"entitlement", {
          {"approvalTick", 0},
          {"zoningDistrictId", "residential"},
          {"approvedFAR", 1.0},
          {"approvedHeightMeters", 10.0},
          {"approvedUses", json::array({"residential"})},
      }},
      {"lifecycle", lifecycle_fixture()},
  };
}

json renovation_building() {
  auto building = occupied_building();
  building["id"] = "building:transaction:renovation";
  building["footprint"] = json::array({
      {{"x", 11.0}, {"y", 2.0}},
      {{"x", 18.0}, {"y", 2.0}},
      {{"x", 18.0}, {"y", 9.0}},
      {{"x", 11.0}, {"y", 9.0}},
  });
  building["grossFloorAreaM2"] = 49.0;
  building["usableFloorAreaM2"] = 45.0;
  building["realizedFAR"] = 0.1225;
  building["coverageRatio"] = 0.1225;
  building["floors"][0]["grossAreaM2"] = 49.0;
  building["floors"][0]["usableAreaM2"] = 45.0;
  building["floors"][0]["uses"][0]["floorAreaM2"] = 45.0;
  building["status"] = "renovation";
  building["project"] = {
      {"phase", "fit-out"},
      {"startedTick", 0},
      {"completionTick", 25},
      {"progress", 0.0},
      {"kind", "renovation"},
      {"renovationScope", "light"},
      {"targetCondition", 95.0},
      {"targetStructuralCondition", 95.0},
      {"targetSystemsCondition", 95.0},
      {"targetExteriorCondition", 95.0},
      {"targetEffectiveAge", 0.0},
  };
  return building;
}

json typology_fixture() {
  return {
      {"id", "typology:transaction"},
      {"name", "Transaction Fixture"},
      {"maintenanceCostPerM2", 1.0},
      {"complexityFactor", 1.0},
  };
}

json lifecycle_input_fixture(std::string building_id) {
  return {
      {"buildingId", std::move(building_id)},
      {"maintenanceSpend", 0.0},
      {"occupancyRatio", 0.9},
      {"utilizationRatio", 0.75},
      {"environmentalStress", 0.1},
      {"serviceStress", 0.1},
  };
}

civic::SaveV9Dto dto_from_snapshot(const json& snapshot) {
  civic::SaveV9Dto dto{};
  dto.urbanFabric = snapshot.at("urbanFabric").dump();
  dto.zoningV2 = snapshot.at("zoningV2").dump();
  dto.buildingsV2 = snapshot.at("buildingsV2").dump();
  dto.propertyMarket = snapshot.at("propertyMarket").dump();
  return dto;
}

TEST(NativeUrbanTransactions, ClonePreservesBuildingStateAndLifecycleRuntimeContext) {
  auto snapshot = base_snapshot();
  snapshot.at("buildingsV2") = json::array({occupied_building()});
  auto authority = civic::NativeUrbanAuthority::restoreAuthoritativeV9(dto_from_snapshot(snapshot));
  ASSERT_TRUE(authority.has_value()) << authority.error().message;

  const json command{
      {"type", "buildings.reconcile"},
      {"buildingsV2", snapshot.at("buildingsV2")},
      {"typologies", json::array({typology_fixture()})},
      {"lifecycleInputs", json::array({lifecycle_input_fixture("building:transaction:1")})},
  };
  auto reconciled = (*authority)->reconcileBuildings(command.dump());
  ASSERT_TRUE(reconciled.has_value()) << reconciled.error().message;

  auto checkpoint = (*authority)->cloneForTransaction();
  ASSERT_TRUE(checkpoint.has_value()) << checkpoint.error().message;

  ASSERT_TRUE((*authority)->tickBuildingLifecycle(25).has_value());
  ASSERT_TRUE((*authority)->tickBuildingLifecycle(50).has_value());
  ASSERT_TRUE((*checkpoint)->tickBuildingLifecycle(25).has_value());

  auto current_text = (*authority)->snapshotJson();
  auto checkpoint_text = (*checkpoint)->snapshotJson();
  ASSERT_TRUE(current_text.has_value());
  ASSERT_TRUE(checkpoint_text.has_value());
  const auto current = json::parse(*current_text);
  const auto cloned = json::parse(*checkpoint_text);
  EXPECT_EQ(current.at("buildingsV2").at(0).at("lifecycle").at("ageTicks"), 50);
  EXPECT_EQ(cloned.at("buildingsV2").at(0).at("lifecycle").at("ageTicks"), 25);
}

TEST(NativeUrbanTransactions, SchedulerDiscardsRenovationMutationWhenLaterLifecycleValidationFails) {
  auto snapshot = base_snapshot();
  snapshot.at("buildingsV2") = json::array({renovation_building(), occupied_building()});

  auto engine = civic::NativeEngine::create({});
  ASSERT_TRUE(engine.has_value()) << engine.error().message;
  auto restored = (*engine)->restoreUrbanState(snapshot.dump());
  ASSERT_TRUE(restored.has_value()) << restored.error().message;

  const json command{
      {"type", "buildings.reconcile"},
      {"buildingsV2", snapshot.at("buildingsV2")},
      {"typologies", json::array({typology_fixture()})},
      {"lifecycleInputs", json::array({lifecycle_input_fixture("building:transaction:1")})},
  };
  auto reconciled = (*engine)->applyUrbanCommand(command.dump());
  ASSERT_TRUE(reconciled.has_value()) << reconciled.error().message;

  auto advanced = (*engine)->step(24);
  ASSERT_TRUE(advanced.has_value()) << advanced.error().message;
  ASSERT_EQ((*engine)->tick(), 24U);
  auto before_text = (*engine)->urbanSnapshot();
  ASSERT_TRUE(before_text.has_value()) << before_text.error().message;
  const auto before = json::parse(before_text->json);
  ASSERT_EQ(before.at("buildingsV2").at(1).at("status"), "renovation");

  auto failed = (*engine)->step(1);
  ASSERT_FALSE(failed.has_value());
  EXPECT_EQ((*engine)->tick(), 24U);

  auto after_text = (*engine)->urbanSnapshot();
  ASSERT_TRUE(after_text.has_value()) << after_text.error().message;
  EXPECT_EQ(json::parse(after_text->json), before);
}

}  // namespace
