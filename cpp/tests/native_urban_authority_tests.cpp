#include <gtest/gtest.h>

#include <nlohmann/json.hpp>

#include "civic/urban/NativeUrbanAuthority.hpp"

namespace {
using nlohmann::json;

TEST(NativeUrbanAuthority, LegacyRebuildOwnsCadastreZoningAndCompatibilityProjection) {
  const json request{
      {"terrain", json::array({{{"x", 0}, {"y", 0}, {"buildable", true}}})},
      {"roads", json::array()},
      {"zoning", json::array({{{"x", 0}, {"y", 0}, {"zoningDistrictId", "residential"}}})},
  };

  auto authority = civic::NativeUrbanAuthority::rebuildLegacy(request.dump());
  ASSERT_TRUE(authority.has_value()) << authority.error().message;

  auto snapshot_text = (*authority)->snapshotJson();
  ASSERT_TRUE(snapshot_text.has_value()) << snapshot_text.error().message;
  const auto snapshot = json::parse(*snapshot_text);

  ASSERT_EQ(snapshot.at("urbanFabric").at("parcels").size(), 1U);
  EXPECT_EQ(snapshot.at("urbanFabric").at("parcels").at(0).at("id"), "parcel:0,0");
  EXPECT_EQ(
      snapshot.at("urbanFabric").at("parcels").at(0).at("zoningDistrictId"),
      "residential");
  EXPECT_DOUBLE_EQ(
      snapshot.at("urbanFabric").at("parcels").at(0).at("areaM2").get<double>(),
      400.0);

  EXPECT_TRUE(snapshot.at("zoningV2").at("parcelAssignments").empty());

  ASSERT_EQ(snapshot.at("legacyLots").size(), 1U);
  EXPECT_EQ(snapshot.at("legacyLots").at(0).at("parcelId"), "parcel:0,0");
  EXPECT_EQ(snapshot.at("legacyLots").at(0).at("x"), 0);
  EXPECT_EQ(snapshot.at("legacyLots").at(0).at("y"), 0);
  EXPECT_TRUE(snapshot.at("legacyLots").at(0).at("faithful").get<bool>());
  EXPECT_NE((*authority)->cadastreHash(), 0U);
  EXPECT_NE((*authority)->urbanHash(), 0U);
}

}  // namespace
