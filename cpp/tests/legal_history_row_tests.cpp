#include <gtest/gtest.h>
#include "civic/cadastre/CadastreMutation.hpp"

namespace {
using civic::cadastre::CadastralGraph;
using civic::cadastre::CadastralMutationService;
using civic::cadastre::EasementCreateCommand;
using civic::cadastre::Parcel;
using civic::cadastre::RightOfWayCommand;

Parcel row_parcel() {
  Parcel parcel;
  parcel.external_id = "parcel:row-encumbered";
  parcel.id = civic::cadastre::parcel_id_from_external(parcel.external_id);
  parcel.block_id = "block:row";
  parcel.boundary = civic::geometry::rectangle(0, 0, 6000, 3000);
  parcel.zoning_district_id = "residential";
  parcel.owner_id = "owner:row";
  return parcel;
}

TEST(NativeLegalHistoryRed, RightOfWayRejectsEncumberedParcelWithoutMutatingHistory) {
  CadastralGraph graph;
  auto source = row_parcel();
  const auto source_id = source.id;
  ASSERT_TRUE(graph.insert(std::move(source)).has_value());

  CadastralMutationService service{graph};
  ASSERT_TRUE(service.create_easement(EasementCreateCommand{
    "easement:access:row", {source_id}, "access", {{500,1500},{5500,1500}}
  }).has_value());
  const auto revision_before = graph.revision();
  const auto lineage_before = graph.lineage().size();

  auto result = service.dedicate_right_of_way(RightOfWayCommand{
    source_id, civic::geometry::rectangle(0,0,1000,3000)
  });

  EXPECT_FALSE(result.has_value());
  EXPECT_EQ(graph.revision(), revision_before);
  EXPECT_EQ(graph.lineage().size(), lineage_before);
  EXPECT_TRUE(graph.contains_live(source_id));
  EXPECT_EQ(graph.easements().size(), 1U);
}
}
