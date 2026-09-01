#include <gtest/gtest.h>
#include "civic/cadastre/CadastreMutation.hpp"
#include <array>
#include <sstream>
#include <string>
#include <vector>

namespace {
using civic::cadastre::CadastralGraph;
using civic::cadastre::CadastralMutationService;
using civic::cadastre::EasementCreateCommand;
using civic::cadastre::MutationStage;
using civic::cadastre::Parcel;
using civic::cadastre::ParcelAssemblyCommand;
using civic::cadastre::ParcelSplitCommand;
using civic::cadastre::RightOfWayCommand;
using civic::core::ErrorCode;
using civic::core::ParcelId;

constexpr std::array kStages{
    MutationStage::snapshot_owners,
    MutationStage::clone_stage,
    MutationStage::apply_mutation,
    MutationStage::rewrite_dependent_references,
    MutationStage::validate_topology,
    MutationStage::validate_ownership_zoning_access,
    MutationStage::validate_buildings_property_references,
    MutationStage::validate_compatibility_projection,
    MutationStage::atomic_commit,
};

Parcel make_parcel(std::string external, std::int64_t min_x, std::int64_t min_y,
                   std::int64_t max_x, std::int64_t max_y) {
  Parcel parcel;
  parcel.external_id = std::move(external);
  parcel.id = civic::cadastre::parcel_id_from_external(parcel.external_id);
  parcel.block_id = "block:transaction";
  parcel.boundary = civic::geometry::rectangle(min_x, min_y, max_x, max_y);
  parcel.zoning_district_id = "R2";
  parcel.owner_id = "owner:transaction";
  return parcel;
}

std::string graph_digest(const CadastralGraph& graph) {
  std::ostringstream out;
  out << "revision=" << graph.revision();
  for (const auto& [id, parcel] : graph.parcels()) {
    out << "|p:" << id.value() << ':' << parcel.external_id << ':' << parcel.live
        << ':' << parcel.block_id << ':' << parcel.zoning_district_id << ':';
    if (parcel.owner_id) out << *parcel.owner_id;
    out << ':' << civic::geometry::deterministic_hash(parcel.boundary);
    for (const auto parent : parcel.historical_parent_ids) out << ":parent=" << parent.value();
    for (const auto& boundary : parcel.boundaries) out << ":boundary=" << boundary;
    for (const auto& frontage : parcel.frontage_boundary_ids) out << ":frontage=" << frontage;
    for (const auto& access : parcel.access_boundary_ids) out << ":access=" << access;
  }
  for (const auto& [id, boundary] : graph.boundaries()) {
    out << "|b:" << id << ':' << boundary.geometry.a.x << ',' << boundary.geometry.a.y
        << ':' << boundary.geometry.b.x << ',' << boundary.geometry.b.y
        << ':' << boundary.kind << ':';
    if (boundary.left_parcel_id) out << boundary.left_parcel_id->value();
    out << ':';
    if (boundary.right_parcel_id) out << boundary.right_parcel_id->value();
    out << ':';
    if (boundary.road_ref) out << *boundary.road_ref;
  }
  for (const auto& [id, easement] : graph.easements()) {
    out << "|e:" << id << ':' << easement.kind;
    for (const auto parcel_id : easement.parcel_ids) out << ":parcel=" << parcel_id.value();
    for (const auto point : easement.geometry) out << ":point=" << point.x << ',' << point.y;
  }
  for (const auto& event : graph.lineage()) {
    out << "|l:" << event.id << ':' << event.tick << ':' << event.kind;
    for (const auto source : event.source_parcel_ids) out << ":source=" << source.value();
    for (const auto result : event.resulting_parcel_ids) out << ":result=" << result.value();
  }
  return out.str();
}

void inject_failure(CadastralMutationService& service, MutationStage failure_stage) {
  service.set_stage_validator([failure_stage](MutationStage stage, const CadastralGraph&) -> civic::core::Result<void> {
    if (stage == failure_stage) {
      return std::unexpected(civic::core::error(
          ErrorCode::invariant_failure,
          std::string{"injected mutation failure at "} + std::string{civic::cadastre::mutation_stage_name(stage)}));
    }
    return {};
  });
}

CadastralGraph split_graph() {
  CadastralGraph graph;
  EXPECT_TRUE(graph.insert(make_parcel("parcel:split", 0, 0, 6000, 3000)).has_value());
  return graph;
}

CadastralGraph assembly_graph() {
  CadastralGraph graph;
  EXPECT_TRUE(graph.insert(make_parcel("parcel:assembly:left", 0, 0, 3000, 3000)).has_value());
  EXPECT_TRUE(graph.insert(make_parcel("parcel:assembly:right", 3000, 0, 6000, 3000)).has_value());
  return graph;
}

CadastralGraph easement_graph() {
  CadastralGraph graph;
  EXPECT_TRUE(graph.insert(make_parcel("parcel:easement", 0, 0, 6000, 3000)).has_value());
  return graph;
}

CadastralGraph row_graph() {
  CadastralGraph graph;
  EXPECT_TRUE(graph.insert(make_parcel("parcel:row", 0, 0, 6000, 3000)).has_value());
  return graph;
}

TEST(NativeCadastreTransactionRed, SplitRollsBackAtEveryTransactionStage) {
  for (const auto stage : kStages) {
    SCOPED_TRACE(civic::cadastre::mutation_stage_name(stage));
    auto graph = split_graph();
    const auto source = civic::cadastre::parcel_id_from_external("parcel:split");
    const auto before = graph_digest(graph);
    CadastralMutationService service{graph};
    inject_failure(service, stage);
    auto result = service.split(ParcelSplitCommand{source, {{3000,0},{3000,3000}}});
    EXPECT_FALSE(result.has_value());
    EXPECT_EQ(graph_digest(graph), before);
    EXPECT_TRUE(graph.contains_live(source));
  }
}

TEST(NativeCadastreTransactionRed, AssemblyRollsBackAtEveryTransactionStage) {
  for (const auto stage : kStages) {
    SCOPED_TRACE(civic::cadastre::mutation_stage_name(stage));
    auto graph = assembly_graph();
    const auto left = civic::cadastre::parcel_id_from_external("parcel:assembly:left");
    const auto right = civic::cadastre::parcel_id_from_external("parcel:assembly:right");
    const auto before = graph_digest(graph);
    CadastralMutationService service{graph};
    inject_failure(service, stage);
    auto result = service.assemble(ParcelAssemblyCommand{{right,left}});
    EXPECT_FALSE(result.has_value());
    EXPECT_EQ(graph_digest(graph), before);
    EXPECT_TRUE(graph.contains_live(left));
    EXPECT_TRUE(graph.contains_live(right));
  }
}

TEST(NativeCadastreTransactionRed, EasementRollsBackAtEveryTransactionStage) {
  for (const auto stage : kStages) {
    SCOPED_TRACE(civic::cadastre::mutation_stage_name(stage));
    auto graph = easement_graph();
    const auto parcel_id = civic::cadastre::parcel_id_from_external("parcel:easement");
    const auto before = graph_digest(graph);
    CadastralMutationService service{graph};
    inject_failure(service, stage);
    auto result = service.create_easement(EasementCreateCommand{
        "", {parcel_id}, "access", {{500,1500},{5500,1500}}});
    EXPECT_FALSE(result.has_value());
    EXPECT_EQ(graph_digest(graph), before);
    EXPECT_TRUE(graph.easements().empty());
  }
}

TEST(NativeCadastreTransactionRed, RightOfWayRollsBackAtEveryTransactionStage) {
  for (const auto stage : kStages) {
    SCOPED_TRACE(civic::cadastre::mutation_stage_name(stage));
    auto graph = row_graph();
    const auto source = civic::cadastre::parcel_id_from_external("parcel:row");
    const auto before = graph_digest(graph);
    CadastralMutationService service{graph};
    inject_failure(service, stage);
    auto result = service.dedicate_right_of_way(RightOfWayCommand{
        source, civic::geometry::rectangle(0,0,1000,3000)});
    EXPECT_FALSE(result.has_value());
    EXPECT_EQ(graph_digest(graph), before);
    EXPECT_TRUE(graph.contains_live(source));
  }
}

TEST(NativeCadastreTransactionRed, SuccessfulSplitVisitsStagesInContractOrder) {
  auto graph = split_graph();
  const auto source = civic::cadastre::parcel_id_from_external("parcel:split");
  std::vector<MutationStage> visited;
  CadastralMutationService service{graph};
  service.set_stage_validator([&visited](MutationStage stage, const CadastralGraph&) -> civic::core::Result<void> {
    visited.push_back(stage);
    return {};
  });
  auto result = service.split(ParcelSplitCommand{source, {{3000,0},{3000,3000}}});
  ASSERT_TRUE(result.has_value());
  EXPECT_EQ(visited, (std::vector<MutationStage>{kStages.begin(), kStages.end()}));
  EXPECT_FALSE(graph.contains_live(source));
  EXPECT_TRUE(graph.validate().has_value());
}

TEST(NativeCadastreTransactionRed, SuccessfulAssemblyEasementAndRightOfWayCommitAtomically) {
  {
    auto graph = assembly_graph();
    CadastralMutationService service{graph};
    const auto left = civic::cadastre::parcel_id_from_external("parcel:assembly:left");
    const auto right = civic::cadastre::parcel_id_from_external("parcel:assembly:right");
    auto result = service.assemble(ParcelAssemblyCommand{{left,right}});
    ASSERT_TRUE(result.has_value());
    ASSERT_EQ(result->resulting_parcel_ids.size(), 1U);
    EXPECT_TRUE(graph.contains_live(result->resulting_parcel_ids.front()));
    EXPECT_TRUE(graph.validate().has_value());
  }
  {
    auto graph = easement_graph();
    CadastralMutationService service{graph};
    const auto parcel_id = civic::cadastre::parcel_id_from_external("parcel:easement");
    EXPECT_TRUE(service.create_easement(EasementCreateCommand{
        "", {parcel_id}, "utility", {{500,1500},{5500,1500}}}).has_value());
    EXPECT_EQ(graph.easements().size(), 1U);
    EXPECT_TRUE(graph.validate().has_value());
  }
  {
    auto graph = row_graph();
    CadastralMutationService service{graph};
    const auto source = civic::cadastre::parcel_id_from_external("parcel:row");
    auto result = service.dedicate_right_of_way(RightOfWayCommand{
        source, civic::geometry::rectangle(0,0,1000,3000)});
    ASSERT_TRUE(result.has_value());
    EXPECT_FALSE(graph.contains_live(source));
    EXPECT_TRUE(graph.validate().has_value());
  }
}
}  // namespace
