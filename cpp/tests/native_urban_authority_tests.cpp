#include <gtest/gtest.h>

#include <nlohmann/json.hpp>

#include "civic/urban/NativeUrbanAuthority.hpp"

namespace {
using nlohmann::json;

json one_parcel_snapshot() {
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

TEST(NativeUrbanAuthority, LegacyRebuildOwnsCadastreZoningAndCompatibilityProjection) {
  const auto snapshot = one_parcel_snapshot();

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
}

TEST(NativeUrbanAuthority, AuthoritativeV9RestorePreservesHistoricalParcelLineageAndTransactions) {
  auto snapshot = one_parcel_snapshot();
  auto& urban = snapshot.at("urbanFabric");
  urban.at("lineage") = json::array({
      {
          {"id", "lineage:history:1"},
          {"tick", 4},
          {"kind", "split"},
          {"sourceParcelIds", json::array({"parcel:retired:history"})},
          {"resultingParcelIds", json::array({"parcel:0,0"})},
      },
  });
  snapshot.at("propertyMarket") = {
      {"holdings", json::array()},
      {"transactions", json::array({
          {
              {"id", "property:tx:1"},
              {"tick", 5},
              {"parcelIds", json::array({"parcel:retired:history"})},
              {"buyerId", "owner:b"},
              {"sellerId", "owner:a"},
              {"purpose", "sale"},
              {"price", 120000.0},
              {"landValue", 80000.0},
              {"improvementValue", 40000.0},
          },
      })},
      {"nextTransactionId", 2},
  };

  civic::SaveV9Dto dto{};
  dto.urbanFabric = urban.dump();
  dto.zoningV2 = snapshot.at("zoningV2").dump();
  dto.buildingsV2 = snapshot.at("buildingsV2").dump();
  dto.propertyMarket = snapshot.at("propertyMarket").dump();

  auto restored = civic::NativeUrbanAuthority::restoreAuthoritativeV9(dto);
  ASSERT_TRUE(restored.has_value()) << restored.error().message;
  const auto* retired = (*restored)->cadastre().find_external("parcel:retired:history");
  ASSERT_NE(retired, nullptr);
  EXPECT_FALSE(retired->live);

  auto serialized_text = (*restored)->snapshotJson();
  ASSERT_TRUE(serialized_text.has_value()) << serialized_text.error().message;
  const auto serialized = json::parse(*serialized_text);
  ASSERT_EQ(serialized.at("urbanFabric").at("lineage").size(), 1U);
  EXPECT_EQ(
      serialized.at("urbanFabric").at("lineage").at(0).at("sourceParcelIds").at(0),
      "parcel:retired:history");
  ASSERT_EQ(serialized.at("propertyMarket").at("transactions").size(), 1U);
  EXPECT_EQ(
      serialized.at("propertyMarket").at("transactions").at(0).at("parcelIds").at(0),
      "parcel:retired:history");
}

}  // namespace
