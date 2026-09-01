#include <gtest/gtest.h>
#include "civic/core/Result.hpp"
#include "civic/core/StrongId.hpp"
#include "civic/core/Random.hpp"
#include "civic/geometry/Geometry.hpp"
#include "civic/world/Terrain.hpp"
#include "civic/world/Hydrology.hpp"
#include "civic/cadastre/Cadastre.hpp"
#include "civic/urban/UrbanFabric.hpp"

TEST(NativeContractsRed, GeometryUsesIntegerCentimetersAndCanonicalWinding) {
  using namespace civic::geometry;
  Polygon polygon{{Point{100, 100}, Point{0, 100}, Point{0, 0}, Point{100, 0}}};
  const auto canonical = canonicalize(polygon);
  ASSERT_TRUE(canonical.has_value());
  EXPECT_EQ(signed_double_area(*canonical), 20000);
  EXPECT_EQ(canonical->vertices.front(), (Point{0, 0}));
  EXPECT_TRUE(point_in_polygon(Point{50, 50}, *canonical));
}

TEST(NativeContractsRed, RandomStreamsMatchAcceptedXorShiftContract) {
  civic::core::RandomStreamRegistry registry{1234};
  auto& stream = registry.stream("world.topography");
  EXPECT_EQ(stream.state(), 195282184u);
  EXPECT_NEAR(stream.next(), 0.0756443536374718, 1e-15);
}

TEST(NativeContractsRed, DepressionResolutionIsDeterministic) {
  const std::vector<double> raw{5,5,5,5,1,5,5,5,5};
  const std::vector<std::uint8_t> water(9, 0);
  auto conditioned = civic::world::resolve_depressions(3, 3, raw, water);
  ASSERT_TRUE(conditioned.has_value());
  EXPECT_DOUBLE_EQ((*conditioned)[4], 5.0);
}

TEST(NativeContractsRed, CadastralTransactionsRollbackWithoutCommit) {
  civic::cadastre::CadastralGraph graph;
  const auto before = graph.revision();
  {
    civic::cadastre::CadastreTransaction tx{graph};
    tx.stage_revision_for_test();
  }
  EXPECT_EQ(graph.revision(), before);
}

TEST(NativeContractsRed, UrbanFabricRejectsBuildingOnMissingParcel) {
  civic::urban::UrbanFabricStore store;
  civic::urban::BuildingV2 building{};
  building.id = civic::core::BuildingId{1};
  building.parcel_id = civic::core::ParcelId{999};
  auto result = store.upsert_building(building);
  EXPECT_FALSE(result.has_value());
}
