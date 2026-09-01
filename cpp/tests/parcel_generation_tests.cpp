#include <gtest/gtest.h>
#include "civic/cadastre/ParcelGeneration.hpp"
#include <algorithm>
#include <array>

namespace {
using civic::cadastre::LegacyRoadCell;
using civic::cadastre::LegacyTerrainCell;
using civic::cadastre::LegacyZoningCell;
using civic::cadastre::ParcelGenerationSystem;

std::vector<LegacyTerrainCell> terrain(std::initializer_list<std::pair<int,int>> cells) {
  std::vector<LegacyTerrainCell> out;
  for (const auto [x,y] : cells) out.push_back({x,y,true});
  return out;
}

TEST(NativeParcelGenerationRed, LegacyStripBecomesOneStableParcelWithThreeFrontages) {
  const auto land = terrain({{1,2},{2,2},{3,2},{1,3},{2,3},{3,3}});
  const std::array zoning{
    LegacyZoningCell{3,2,"residential"},
    LegacyZoningCell{1,2,"residential"},
    LegacyZoningCell{2,2,"residential"},
  };
  const std::array roads{
    LegacyRoadCell{1,3,"1,3"},
    LegacyRoadCell{2,3,"2,3"},
    LegacyRoadCell{3,3,"3,3"},
  };
  auto generated = ParcelGenerationSystem{}.rebuild(land, roads, zoning);
  ASSERT_TRUE(generated.has_value());
  const auto parcels = generated->graph.live_parcels();
  ASSERT_EQ(parcels.size(), 1U);
  EXPECT_EQ(parcels.front()->external_id, "parcel:1,2");
  EXPECT_EQ(parcels.front()->block_id, "block:1,2");
  EXPECT_EQ(parcels.front()->zoning_district_id, "residential");
  EXPECT_DOUBLE_EQ(parcels.front()->area_m2, 2700.0);
  EXPECT_EQ(parcels.front()->frontage_boundary_ids.size(), 3U);
  EXPECT_EQ(parcels.front()->access_boundary_ids, parcels.front()->frontage_boundary_ids);
  ASSERT_EQ(generated->blocks.size(), 1U);
  EXPECT_EQ(generated->blocks.front().external_id, "block:1,2");
  EXPECT_EQ(generated->blocks.front().parcel_ids.size(), 1U);
  EXPECT_TRUE(generated->graph.validate().has_value());
}

TEST(NativeParcelGenerationRed, InputOrderingCannotChangeParcelIdentityOrGeometry) {
  auto land_a = terrain({{0,0},{1,0},{0,1}});
  auto land_b = land_a;
  std::reverse(land_b.begin(), land_b.end());
  std::vector<LegacyZoningCell> zoning_a{{0,1,"mixed"},{1,0,"mixed"},{0,0,"mixed"}};
  auto zoning_b = zoning_a;
  std::reverse(zoning_b.begin(), zoning_b.end());
  const std::vector<LegacyRoadCell> roads;
  auto a = ParcelGenerationSystem{}.rebuild(land_a, roads, zoning_a);
  auto b = ParcelGenerationSystem{}.rebuild(land_b, roads, zoning_b);
  ASSERT_TRUE(a.has_value()); ASSERT_TRUE(b.has_value());
  const auto pa = a->graph.live_parcels(); const auto pb = b->graph.live_parcels();
  ASSERT_EQ(pa.size(), 1U); ASSERT_EQ(pb.size(), 1U);
  EXPECT_EQ(pa.front()->id, pb.front()->id);
  EXPECT_EQ(pa.front()->external_id, pb.front()->external_id);
  EXPECT_EQ(civic::geometry::deterministic_hash(pa.front()->boundary), civic::geometry::deterministic_hash(pb.front()->boundary));
  EXPECT_DOUBLE_EQ(pa.front()->area_m2, 2700.0);
  EXPECT_GE(pa.front()->boundary.vertices.size(), 6U);
}

TEST(NativeParcelGenerationRed, MixedZoningCreatesDistinctParcelsInsideOneBlock) {
  const auto land = terrain({{0,0},{1,0}});
  const std::array zoning{LegacyZoningCell{0,0,"residential"},LegacyZoningCell{1,0,"commercial"}};
  const std::vector<LegacyRoadCell> roads;
  auto generated = ParcelGenerationSystem{}.rebuild(land, roads, zoning);
  ASSERT_TRUE(generated.has_value());
  const auto parcels = generated->graph.live_parcels();
  ASSERT_EQ(parcels.size(), 2U);
  EXPECT_EQ(parcels[0]->block_id, parcels[1]->block_id);
  EXPECT_EQ(generated->blocks.size(), 1U);
  std::vector<std::string> zones{parcels[0]->zoning_district_id, parcels[1]->zoning_district_id};
  std::sort(zones.begin(), zones.end());
  EXPECT_EQ(zones, (std::vector<std::string>{"commercial","residential"}));
}

TEST(NativeParcelGenerationRed, RoadsAndUnbuildableCellsNeverBecomeParcels) {
  std::vector<LegacyTerrainCell> land{{0,0,true},{1,0,false},{2,0,true}};
  const std::array zoning{
    LegacyZoningCell{0,0,"residential"},
    LegacyZoningCell{1,0,"residential"},
    LegacyZoningCell{2,0,"residential"},
  };
  const std::array roads{LegacyRoadCell{2,0,"2,0"}};
  auto generated = ParcelGenerationSystem{}.rebuild(land, roads, zoning);
  ASSERT_TRUE(generated.has_value());
  const auto parcels = generated->graph.live_parcels();
  ASSERT_EQ(parcels.size(), 1U);
  EXPECT_EQ(parcels.front()->external_id, "parcel:0,0");
  EXPECT_DOUBLE_EQ(parcels.front()->area_m2, 900.0);
}
}
