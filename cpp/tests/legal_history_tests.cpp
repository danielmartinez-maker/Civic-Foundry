#include <gtest/gtest.h>
#include "civic/cadastre/CadastreMutation.hpp"
#include <algorithm>
#include <string>
#include <vector>

namespace {
using civic::cadastre::CadastralGraph;
using civic::cadastre::CadastralMutationService;
using civic::cadastre::EasementCreateCommand;
using civic::cadastre::LineageEvent;
using civic::cadastre::Parcel;
using civic::cadastre::ParcelSplitCommand;
using civic::cadastre::RightOfWayCommand;
using civic::core::ParcelId;

Parcel make_parcel(std::string external, std::int64_t min_x, std::int64_t min_y,
                   std::int64_t max_x, std::int64_t max_y) {
  Parcel parcel;
  parcel.external_id = std::move(external);
  parcel.id = civic::cadastre::parcel_id_from_external(parcel.external_id);
  parcel.block_id = "block:history";
  parcel.boundary = civic::geometry::rectangle(min_x, min_y, max_x, max_y);
  parcel.zoning_district_id = "residential";
  parcel.owner_id = "owner:history";
  return parcel;
}

CadastralGraph replay_fixture() {
  CadastralGraph graph;
  EXPECT_TRUE(graph.insert(make_parcel("parcel:history", 0, 0, 6000, 3000)).has_value());
  CadastralMutationService service{graph};

  const auto source_id = civic::cadastre::parcel_id_from_external("parcel:history");
  auto split = service.split(ParcelSplitCommand{source_id, {{3000,0},{3000,3000}}});
  EXPECT_TRUE(split.has_value());
  if (!split) return graph;
  auto children = split->resulting_parcel_ids;
  std::sort(children.begin(), children.end());

  EXPECT_TRUE(service.create_easement(EasementCreateCommand{
    "", children, "access", {{1500,1500},{4500,1500}}
  }).has_value());
  if (!graph.easements().empty()) {
    EXPECT_TRUE(service.remove_easement(graph.easements().begin()->first).has_value());
  }

  auto assembly = service.assemble({children});
  EXPECT_TRUE(assembly.has_value());
  if (!assembly) return graph;
  const auto assembled_id = assembly->resulting_parcel_ids.front();
  EXPECT_TRUE(service.dedicate_right_of_way(RightOfWayCommand{
    assembled_id, civic::geometry::rectangle(0,0,1000,3000)
  }).has_value());
  return graph;
}

void expect_same_history(const CadastralGraph& left, const CadastralGraph& right) {
  EXPECT_EQ(left.revision(), right.revision());
  ASSERT_EQ(left.parcels().size(), right.parcels().size());
  for (const auto& [id, parcel] : left.parcels()) {
    const auto* other = right.find(id);
    ASSERT_NE(other, nullptr);
    EXPECT_EQ(parcel.external_id, other->external_id);
    EXPECT_EQ(parcel.live, other->live);
    EXPECT_EQ(parcel.block_id, other->block_id);
    EXPECT_EQ(parcel.zoning_district_id, other->zoning_district_id);
    EXPECT_EQ(parcel.owner_id, other->owner_id);
    EXPECT_EQ(parcel.historical_parent_ids, other->historical_parent_ids);
    EXPECT_EQ(civic::geometry::deterministic_hash(parcel.boundary),
              civic::geometry::deterministic_hash(other->boundary));
  }
  ASSERT_EQ(left.lineage().size(), right.lineage().size());
  for (std::size_t i = 0; i < left.lineage().size(); ++i) {
    const auto& a = left.lineage()[i];
    const auto& b = right.lineage()[i];
    EXPECT_EQ(a.id, b.id);
    EXPECT_EQ(a.tick, b.tick);
    EXPECT_EQ(a.kind, b.kind);
    EXPECT_EQ(a.source_parcel_ids, b.source_parcel_ids);
    EXPECT_EQ(a.resulting_parcel_ids, b.resulting_parcel_ids);
  }
  EXPECT_EQ(left.easements().size(), right.easements().size());
}

TEST(NativeLegalHistoryRed, MultiParcelEasementMayCrossSharedBoundaryInsideParcelUnion) {
  CadastralGraph graph;
  auto left = make_parcel("parcel:left", 0, 0, 3000, 3000);
  auto right = make_parcel("parcel:right", 3000, 0, 6000, 3000);
  const auto left_id = left.id;
  const auto right_id = right.id;
  ASSERT_TRUE(graph.insert(std::move(left)).has_value());
  ASSERT_TRUE(graph.insert(std::move(right)).has_value());

  CadastralMutationService service{graph};
  auto result = service.create_easement(EasementCreateCommand{
    "", {right_id,left_id}, "access", {{1500,1500},{4500,1500}}
  });
  ASSERT_TRUE(result.has_value());
  ASSERT_EQ(graph.easements().size(), 1U);
  const auto& easement = graph.easements().begin()->second;
  EXPECT_EQ(easement.id, "easement:access:parcel:left+parcel:right");
  EXPECT_EQ(easement.kind, "access");
  EXPECT_EQ(easement.parcel_ids.size(), 2U);
}

TEST(NativeLegalHistoryRed, InvalidEasementAndLineageKindsAreRejected) {
  CadastralGraph graph;
  auto a = make_parcel("parcel:a", 0, 0, 3000, 3000);
  auto b = make_parcel("parcel:b", 6000, 0, 9000, 3000);
  const auto a_id=a.id, b_id=b.id;
  ASSERT_TRUE(graph.insert(std::move(a)).has_value());
  ASSERT_TRUE(graph.insert(std::move(b)).has_value());
  CadastralMutationService service{graph};

  EXPECT_FALSE(service.create_easement(EasementCreateCommand{
    "", {a_id}, "view", {{500,500},{2500,500}}
  }).has_value());
  EXPECT_FALSE(graph.append_lineage(LineageEvent{
    "lineage:1:merge", 1, "merge", {a_id}, {b_id}
  }).has_value());
}

TEST(NativeLegalHistoryRed, LineageCyclesAreRejectedWithoutErasingAcceptedHistory) {
  CadastralGraph graph;
  auto a = make_parcel("parcel:a", 0, 0, 3000, 3000);
  auto b = make_parcel("parcel:b", 6000, 0, 9000, 3000);
  const auto a_id=a.id, b_id=b.id;
  ASSERT_TRUE(graph.insert(std::move(a)).has_value());
  ASSERT_TRUE(graph.insert(std::move(b)).has_value());

  ASSERT_TRUE(graph.append_lineage(LineageEvent{
    "lineage:1:boundary-adjustment", 1, "boundary-adjustment", {a_id}, {b_id}
  }).has_value());
  EXPECT_FALSE(graph.append_lineage(LineageEvent{
    "lineage:2:boundary-adjustment", 2, "boundary-adjustment", {b_id}, {a_id}
  }).has_value());
  ASSERT_EQ(graph.lineage().size(), 1U);
  EXPECT_EQ(graph.lineage().front().source_parcel_ids, (std::vector<ParcelId>{a_id}));
}

TEST(NativeLegalHistoryRed, RetiredParcelsRemainAddressableAfterRightOfWayDedication) {
  CadastralGraph graph;
  auto source = make_parcel("parcel:row-source", 0, 0, 6000, 3000);
  const auto source_id=source.id;
  ASSERT_TRUE(graph.insert(std::move(source)).has_value());
  CadastralMutationService service{graph};
  auto result=service.dedicate_right_of_way(RightOfWayCommand{
    source_id, civic::geometry::rectangle(0,0,1000,3000)
  });
  ASSERT_TRUE(result.has_value());
  ASSERT_EQ(result->resulting_parcel_ids.size(),1U);
  const auto* retired=graph.find(source_id);
  ASSERT_NE(retired,nullptr);
  EXPECT_FALSE(retired->live);
  const auto* residual=graph.find(result->resulting_parcel_ids.front());
  ASSERT_NE(residual,nullptr);
  EXPECT_TRUE(residual->live);
  EXPECT_NE(std::find(residual->historical_parent_ids.begin(),
                      residual->historical_parent_ids.end(), source_id),
            residual->historical_parent_ids.end());
  ASSERT_FALSE(graph.lineage().empty());
  EXPECT_EQ(graph.lineage().back().kind,"right-of-way");
  EXPECT_EQ(graph.lineage().back().source_parcel_ids,(std::vector<ParcelId>{source_id}));
}

TEST(NativeLegalHistoryRed, MutationHistoryReplaysDeterministically) {
  const auto first = replay_fixture();
  const auto second = replay_fixture();
  ASSERT_TRUE(first.validate().has_value());
  ASSERT_TRUE(second.validate().has_value());
  expect_same_history(first, second);
}
}
