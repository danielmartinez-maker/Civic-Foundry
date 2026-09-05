#include <gtest/gtest.h>
#include "civic/cadastre/CadastreMutation.hpp"
#include "civic/geometry/BooleanOps.hpp"
#include <array>

namespace {
using civic::cadastre::CadastralGraph;
using civic::cadastre::CadastralMutationService;
using civic::cadastre::Parcel;
using civic::geometry::rectangle;

Parcel parcel(std::string id, long long min_x, long long min_y, long long max_x, long long max_y) {
  Parcel result{};
  result.external_id = std::move(id);
  result.id = civic::cadastre::parcel_id_from_external(result.external_id);
  result.block_id = "block:0";
  result.zoning_district_id = "R2";
  result.owner_id = "owner:0";
  result.boundary = rectangle(min_x,min_y,max_x,max_y);
  return result;
}

TEST(NativeCadastreRed, BooleanUnionIsCanonicalAndAreaPreserving) {
  const std::array subject{rectangle(0,0,3000,3000),rectangle(3000,0,6000,3000)};
  auto united=civic::geometry::polygon_union(subject);
  ASSERT_TRUE(united.has_value());
  ASSERT_EQ(united->size(),1u);
  EXPECT_DOUBLE_EQ(civic::geometry::area_square_meters(united->front()),1800.0);
}

TEST(NativeCadastreRed, SplitIsAtomicAndRecordsLineage) {
  CadastralGraph graph;
  auto source=parcel("parcel:0,0",0,0,6000,3000);
  const auto source_id=source.id;
  ASSERT_TRUE(graph.insert(source).has_value());
  const auto before=graph.revision();
  CadastralMutationService mutations{graph};
  auto result=mutations.split({source_id,{{3000,0},{3000,3000}}});
  ASSERT_TRUE(result.has_value());
  EXPECT_GT(graph.revision(),before);
  EXPECT_FALSE(graph.contains_live(source_id));
  ASSERT_EQ(result->resulting_parcel_ids.size(),2u);
  EXPECT_TRUE(graph.contains_live(result->resulting_parcel_ids[0]));
  EXPECT_TRUE(graph.contains_live(result->resulting_parcel_ids[1]));
  ASSERT_EQ(graph.lineage().size(),1u);
  EXPECT_EQ(graph.lineage().front().kind,"split");
  EXPECT_TRUE(graph.validate().has_value());
}

TEST(NativeCadastreRed, DependentFailureRollsBackEveryMutationStage) {
  CadastralGraph graph;
  auto source=parcel("parcel:0,0",0,0,6000,3000);
  const auto source_id=source.id;
  ASSERT_TRUE(graph.insert(source).has_value());
  const auto before=graph.revision();
  CadastralMutationService mutations{graph};
  mutations.add_commit_validator([](const CadastralGraph&) -> civic::core::Result<void> {
    return std::unexpected(civic::core::error(civic::core::ErrorCode::invariant_failure,"injected dependent failure"));
  });
  auto result=mutations.split({source_id,{{3000,0},{3000,3000}}});
  EXPECT_FALSE(result.has_value());
  EXPECT_EQ(graph.revision(),before);
  EXPECT_TRUE(graph.contains_live(source_id));
  EXPECT_EQ(graph.live_parcels().size(),1u);
  EXPECT_TRUE(graph.lineage().empty());
}

TEST(NativeCadastreRed, AssemblyUsesStableIdsIndependentOfCommandOrder) {
  auto make_graph=[](){CadastralGraph graph;EXPECT_TRUE(graph.insert(parcel("parcel:0,0",0,0,3000,3000)).has_value());EXPECT_TRUE(graph.insert(parcel("parcel:1,0",3000,0,6000,3000)).has_value());return graph;};
  auto graph_a=make_graph(); auto graph_b=make_graph();
  const auto a=graph_a.find_external("parcel:0,0")->id,b=graph_a.find_external("parcel:1,0")->id;
  CadastralMutationService ma{graph_a}; auto ra=ma.assemble({{a,b}}); ASSERT_TRUE(ra.has_value());
  const auto a2=graph_b.find_external("parcel:0,0")->id,b2=graph_b.find_external("parcel:1,0")->id;
  CadastralMutationService mb{graph_b}; auto rb=mb.assemble({{b2,a2}}); ASSERT_TRUE(rb.has_value());
  EXPECT_EQ(ra->resulting_parcel_ids,rb->resulting_parcel_ids);
  EXPECT_TRUE(graph_a.validate().has_value()); EXPECT_TRUE(graph_b.validate().has_value());
}

TEST(NativeCadastreRed, RightOfWayPreservesHistoricalSourceAndCreatesResidual) {
  CadastralGraph graph; auto source=parcel("parcel:0,0",0,0,6000,3000); const auto source_id=source.id; ASSERT_TRUE(graph.insert(source).has_value());
  CadastralMutationService mutations{graph};
  auto result=mutations.dedicate_right_of_way({source_id,rectangle(0,0,1000,3000)});
  ASSERT_TRUE(result.has_value()); EXPECT_FALSE(graph.contains_live(source_id)); ASSERT_EQ(result->resulting_parcel_ids.size(),1u); EXPECT_TRUE(graph.contains_live(result->resulting_parcel_ids.front())); EXPECT_EQ(graph.lineage().back().kind,"right-of-way");
}

TEST(NativeCadastreRed, LegacyProjectionDiagnosesIrregularCanonicalParcel) {
  CadastralGraph graph; Parcel irregular{}; irregular.external_id="parcel:irregular"; irregular.id=civic::cadastre::parcel_id_from_external(irregular.external_id); irregular.block_id="block:0"; irregular.zoning_district_id="R2"; irregular.boundary={{{0,0},{3000,0},{3000,1500},{1500,3000},{0,3000}}}; ASSERT_TRUE(graph.insert(irregular).has_value());
  const auto projection=graph.legacy_lot_projection(); ASSERT_EQ(projection.lots.size(),1u); EXPECT_FALSE(projection.lots.front().faithful); EXPECT_FALSE(projection.diagnostics.empty());
}
}
