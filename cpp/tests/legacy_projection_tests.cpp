#include <gtest/gtest.h>
#include "civic/cadastre/Cadastre.hpp"
#include <algorithm>
#include <string>
#include <vector>

namespace {
using civic::cadastre::CadastralGraph;
using civic::cadastre::LegacyLotProjectionEntry;
using civic::cadastre::Parcel;

Parcel parcel(std::string external, std::int64_t min_x, std::int64_t min_y,
              std::int64_t max_x, std::int64_t max_y) {
  Parcel result;
  result.external_id = std::move(external);
  result.id = civic::cadastre::parcel_id_from_external(result.external_id);
  result.block_id = "block:projection";
  result.zoning_district_id = "R2";
  result.owner_id = "owner:projection";
  result.boundary = civic::geometry::rectangle(min_x, min_y, max_x, max_y);
  return result;
}

std::vector<std::string> ids(const std::vector<LegacyLotProjectionEntry>& lots) {
  std::vector<std::string> result;
  result.reserve(lots.size());
  for (const auto& lot : lots) result.push_back(lot.parcel_external_id);
  return result;
}

bool has_diagnostic(const std::vector<std::string>& diagnostics, std::string_view token) {
  return std::any_of(diagnostics.begin(), diagnostics.end(), [&](const std::string& diagnostic) {
    return diagnostic.find(token) != std::string::npos;
  });
}

TEST(NativeLegacyProjectionRed, ExactAlignedTwentyMeterParcelIsFaithful) {
  CadastralGraph graph;
  ASSERT_TRUE(graph.insert(parcel("parcel:faithful", 2000, 4000, 4000, 6000)).has_value());
  const auto projection = graph.legacy_lot_projection();
  ASSERT_EQ(projection.lots.size(), 1U);
  EXPECT_EQ(projection.lots.front().x, 1);
  EXPECT_EQ(projection.lots.front().y, 2);
  EXPECT_TRUE(projection.lots.front().faithful);
  EXPECT_TRUE(projection.diagnostics.empty());
}

TEST(NativeLegacyProjectionRed, IrregularCanonicalParcelIsExplicitlyUnfaithful) {
  CadastralGraph graph;
  Parcel irregular;
  irregular.external_id = "parcel:irregular-projection";
  irregular.id = civic::cadastre::parcel_id_from_external(irregular.external_id);
  irregular.block_id = "block:projection";
  irregular.zoning_district_id = "MU4";
  irregular.owner_id = "owner:projection";
  irregular.boundary = {{{0,0},{3000,0},{3000,1000},{2000,2000},{0,2000}}};
  ASSERT_TRUE(graph.insert(std::move(irregular)).has_value());

  const auto projection = graph.legacy_lot_projection();
  ASSERT_EQ(projection.lots.size(), 1U);
  EXPECT_FALSE(projection.lots.front().faithful);
  EXPECT_TRUE(has_diagnostic(projection.diagnostics, "parcel:irregular-projection"));
}

TEST(NativeLegacyProjectionRed, CollidingCanonicalIdentitiesRemainSeparateAndAreDiagnosed) {
  CadastralGraph graph;
  ASSERT_TRUE(graph.insert(parcel("parcel:cell-left", 0, 0, 1000, 2000)).has_value());
  ASSERT_TRUE(graph.insert(parcel("parcel:cell-right", 1000, 0, 2000, 2000)).has_value());

  const auto projection = graph.legacy_lot_projection();
  ASSERT_EQ(projection.lots.size(), 2U);
  EXPECT_NE(projection.lots[0].parcel_id, projection.lots[1].parcel_id);
  EXPECT_EQ(projection.lots[0].x, 0);
  EXPECT_EQ(projection.lots[0].y, 0);
  EXPECT_EQ(projection.lots[1].x, 0);
  EXPECT_EQ(projection.lots[1].y, 0);
  EXPECT_TRUE(has_diagnostic(projection.diagnostics, "legacy cell 0,0"));
  EXPECT_TRUE(has_diagnostic(projection.diagnostics, "parcel:cell-left"));
  EXPECT_TRUE(has_diagnostic(projection.diagnostics, "parcel:cell-right"));
}

TEST(NativeLegacyProjectionRed, ProjectionOrderIsSpatialAndIndependentOfInsertionOrder) {
  auto build = [](bool reverse) {
    CadastralGraph graph;
    std::vector<Parcel> parcels{
      parcel("parcel:south-east", 4000, 0, 6000, 2000),
      parcel("parcel:north-west", 0, 2000, 2000, 4000),
      parcel("parcel:south-west", 0, 0, 2000, 2000),
    };
    if (reverse) std::reverse(parcels.begin(), parcels.end());
    for (auto& candidate : parcels) EXPECT_TRUE(graph.insert(std::move(candidate)).has_value());
    return graph.legacy_lot_projection();
  };

  const auto first = build(false);
  const auto second = build(true);
  EXPECT_EQ(ids(first.lots), ids(second.lots));
  EXPECT_EQ(ids(first.lots), (std::vector<std::string>{
      "parcel:south-west", "parcel:south-east", "parcel:north-west"}));
}

TEST(NativeLegacyProjectionRed, RetiredCanonicalParcelsAreNotProjected) {
  CadastralGraph graph;
  auto retired = parcel("parcel:retired", 0, 0, 2000, 2000);
  const auto retired_id = retired.id;
  ASSERT_TRUE(graph.insert(std::move(retired)).has_value());
  ASSERT_TRUE(graph.insert(parcel("parcel:live", 2000, 0, 4000, 2000)).has_value());
  ASSERT_TRUE(graph.retire(retired_id).has_value());

  const auto projection = graph.legacy_lot_projection();
  ASSERT_EQ(projection.lots.size(), 1U);
  EXPECT_EQ(projection.lots.front().parcel_external_id, "parcel:live");
}
}  // namespace