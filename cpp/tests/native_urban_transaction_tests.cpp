#include <gtest/gtest.h>

#include <nlohmann/json.hpp>

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
      {"typologies", json::array({
          {
              {"id", "typology:transaction"},
              {"name", "Transaction Fixture"},
              {"maintenanceCostPerM2", 1.0},
              {"complexityFactor", 1.0},
          },
      })},
      {"lifecycleInputs", json::array({
          {
              {"buildingId", "building:transaction:1"},
              {"maintenanceSpend", 0.0},
              {"occupancyRatio", 0.9},
              {"utilizationRatio", 0.75},
              {"environmentalStress", 0.1},
              {"serviceStress", 0.1},
          },
      })},
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

}  // namespace
