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

civic::SaveV9Dto dto_from_snapshot(const json& snapshot) {
  civic::SaveV9Dto dto{};
  dto.urbanFabric = snapshot.at("urbanFabric").dump();
  dto.zoningV2 = snapshot.at("zoningV2").dump();
  dto.buildingsV2 = snapshot.at("buildingsV2").dump();
  dto.propertyMarket = snapshot.at("propertyMarket").dump();
  return dto;
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

  const auto dto = dto_from_snapshot(snapshot);

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

TEST(NativeUrbanAuthority, SplitCommandRewritesZoningAndPropertyInsideNativeState) {
  auto snapshot = one_parcel_snapshot();
  snapshot.at("zoningV2").at("parcelAssignments") = json::array({
      {
          {"parcelId", "parcel:0,0"},
          {"districtId", "R5"},
          {"overlayIds", json::array()},
      },
  });
  snapshot.at("propertyMarket") = {
      {"holdings", json::array({
          {
              {"parcelId", "parcel:0,0"},
              {"ownerId", "owner:a"},
              {"reservationValue", 100000.0},
          },
      })},
      {"transactions", json::array()},
      {"nextTransactionId", 1},
  };

  auto authority = civic::NativeUrbanAuthority::restoreAuthoritativeV9(dto_from_snapshot(snapshot));
  ASSERT_TRUE(authority.has_value()) << authority.error().message;

  const json command{
      {"type", "cadastre.split"},
      {"parcelId", "parcel:0,0"},
      {"cutLine", json::array({
          {{"x", 10.0}, {"y", 0.0}},
          {{"x", 10.0}, {"y", 20.0}},
      })},
  };
  auto result_text = (*authority)->applyCommand(command.dump());
  ASSERT_TRUE(result_text.has_value()) << result_text.error().message;
  const auto result = json::parse(*result_text);
  EXPECT_TRUE(result.at("committed").get<bool>());
  ASSERT_EQ(result.at("resultingParcelIds").size(), 2U);
  ASSERT_EQ(result.at("retiredParcelIds"), json::array({"parcel:0,0"}));

  auto mutated_text = (*authority)->snapshotJson();
  ASSERT_TRUE(mutated_text.has_value()) << mutated_text.error().message;
  const auto mutated = json::parse(*mutated_text);
  ASSERT_EQ(mutated.at("urbanFabric").at("parcels").size(), 2U);
  ASSERT_EQ(mutated.at("zoningV2").at("parcelAssignments").size(), 2U);
  ASSERT_EQ(mutated.at("propertyMarket").at("holdings").size(), 2U);
  double reservation_total = 0.0;
  for (const auto& holding : mutated.at("propertyMarket").at("holdings")) {
    reservation_total += holding.at("reservationValue").get<double>();
    EXPECT_EQ(holding.at("ownerId"), "owner:a");
  }
  EXPECT_DOUBLE_EQ(reservation_total, 100000.0);
}

}  // namespace
