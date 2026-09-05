#include "civic/world/WorldFoundation.hpp"

#include <algorithm>
#include <string>

#include <gtest/gtest.h>

namespace {
using civic::world::GeographyKind;
using civic::world::GeographySpatialIndex;
using civic::world::WorldConfig;
using civic::world::WorldFoundation;
using civic::world::WorldPreset;

TEST(GeographyHierarchy, SpatialIndexReturnsDeepestContainingEntityAndKindLookup) {
  auto generated = WorldFoundation::generate(
      4242, WorldConfig{12, 8, 30.0, WorldPreset::rolling_uplands});
  ASSERT_TRUE(generated.has_value());
  const auto& geography = generated->geography();

  const auto block = std::find_if(geography.entities.begin(), geography.entities.end(),
                                  [](const auto& entity) {
                                    return entity.kind == GeographyKind::block;
                                  });
  ASSERT_NE(block, geography.entities.end());
  const auto center = civic::geometry::centroid(block->boundary);
  ASSERT_TRUE(center.has_value());

  const auto index = GeographySpatialIndex::build(geography);
  ASSERT_TRUE(index.has_value());
  EXPECT_EQ(index->size(), geography.entities.size());

  const auto* deepest = index->entity_at(geography, *center);
  ASSERT_NE(deepest, nullptr);
  EXPECT_EQ(deepest->id, block->id);

  const auto* neighborhood = geography.parent_of(block->id);
  ASSERT_NE(neighborhood, nullptr);
  ASSERT_EQ(neighborhood->kind, GeographyKind::neighborhood);
  const auto* district = geography.parent_of(neighborhood->id);
  ASSERT_NE(district, nullptr);
  ASSERT_EQ(district->kind, GeographyKind::district);

  const auto* district_at = index->entity_at(geography, *center, GeographyKind::district);
  ASSERT_NE(district_at, nullptr);
  EXPECT_EQ(district_at->id, district->id);
  EXPECT_EQ(geography.find(district->id), district);

  const auto children = geography.children_of(district->id);
  ASSERT_FALSE(children.empty());
  EXPECT_TRUE(std::is_sorted(children.begin(), children.end(), [](const auto* lhs, const auto* rhs) {
    return lhs->sort_key < rhs->sort_key ||
           (lhs->sort_key == rhs->sort_key && lhs->id < rhs->id);
  }));
}

TEST(GeographyHierarchy, SnapshotRestoreRebuildsEquivalentSpatialIndex) {
  auto generated = WorldFoundation::generate(
      9001, WorldConfig{10, 7, 20.0, WorldPreset::river_valley});
  ASSERT_TRUE(generated.has_value());
  const auto snapshot = generated->snapshot();

  const auto block = std::find_if(snapshot.geography.entities.begin(), snapshot.geography.entities.end(),
                                  [](const auto& entity) {
                                    return entity.kind == GeographyKind::block;
                                  });
  ASSERT_NE(block, snapshot.geography.entities.end());
  const auto center = civic::geometry::centroid(block->boundary);
  ASSERT_TRUE(center.has_value());

  const auto original_index = GeographySpatialIndex::build(snapshot.geography);
  ASSERT_TRUE(original_index.has_value());
  const auto* original_match = original_index->entity_at(snapshot.geography, *center);
  ASSERT_NE(original_match, nullptr);

  auto restored = WorldFoundation::restore(snapshot);
  ASSERT_TRUE(restored.has_value());
  const auto restored_index = GeographySpatialIndex::build(restored->geography());
  ASSERT_TRUE(restored_index.has_value());
  const auto* restored_match = restored_index->entity_at(restored->geography(), *center);
  ASSERT_NE(restored_match, nullptr);

  EXPECT_EQ(restored_match->id, original_match->id);
  EXPECT_EQ(restored->geography().entities.size(), snapshot.geography.entities.size());
}
}  // namespace
