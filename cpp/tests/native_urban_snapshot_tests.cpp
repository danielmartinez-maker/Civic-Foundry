#include "civic/snapshot/UrbanFabricSnapshot.hpp"

#include "civic/cadastre/Cadastre.hpp"
#include "civic/urban/BuildableEnvelope.hpp"
#include "civic/urban/DevelopmentAuthority.hpp"
#include "civic/urban/UrbanFabric.hpp"
#include "civic/urban/Zoning.hpp"
#include "civic/world/WorldFoundation.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <map>
#include <memory>
#include <string>
#include <type_traits>
#include <vector>

namespace civic::snapshot {
namespace {

using civic::cadastre::CadastralGraph;
using civic::cadastre::Parcel;
using civic::cadastre::parcel_id_from_external;
using civic::core::ParcelId;
using civic::urban::BuildingStatus;
using civic::urban::BuildingV2;
using civic::urban::ParcelDevelopmentEnvelope;
using civic::urban::PropertyHolding;
using civic::urban::PropertyMarketSnapshot;
using civic::urban::PropertyMarketSystem;
using civic::urban::PropertyTransactionInput;
using civic::urban::PropertyTransactionPurpose;
using civic::urban::UrbanFabricStore;
using civic::urban::UseType;
using civic::urban::ZoningStore;
using civic::urban::building_id_from_external;
using civic::world::WorldConfig;
using civic::world::WorldFoundation;

Parcel parcel_fixture(std::string external_id, std::int64_t min_x_cm, std::int64_t max_x_cm) {
  Parcel parcel;
  parcel.external_id = std::move(external_id);
  parcel.id = parcel_id_from_external(parcel.external_id);
  parcel.block_id = "block:0";
  parcel.boundary.vertices = {
      {min_x_cm, 0},
      {max_x_cm, 0},
      {max_x_cm, 2000},
      {min_x_cm, 2000},
  };
  parcel.zoning_district_id = "R2";
  parcel.owner_id = "owner:a";
  return parcel;
}

CadastralGraph cadastre_fixture() {
  CadastralGraph graph;
  EXPECT_TRUE(graph.insert(parcel_fixture("p0", 0, 2000)));
  EXPECT_TRUE(graph.insert(parcel_fixture("p1", 2000, 4000)));

  const auto p0 = parcel_id_from_external("p0");
  for (const auto& [boundary_id, boundary] : graph.boundaries()) {
    const bool touches_p0 = (boundary.left_parcel_id && *boundary.left_parcel_id == p0) ||
                            (boundary.right_parcel_id && *boundary.right_parcel_id == p0);
    const bool exterior = !boundary.left_parcel_id || !boundary.right_parcel_id;
    if (touches_p0 && exterior) {
      EXPECT_TRUE(graph.set_boundary_semantics(boundary_id, "street-frontage", "road:south", true, true));
      break;
    }
  }
  return graph;
}

BuildingV2 building_fixture() {
  BuildingV2 building;
  building.external_id = "building:p0";
  building.id = building_id_from_external(building.external_id);
  building.parcel_id = parcel_id_from_external("p0");
  building.parcel_ids = {building.parcel_id};
  building.typology_id = "residential_cottage";
  building.footprint.vertices = {{200, 200}, {1200, 200}, {1200, 1200}, {200, 1200}};
  building.gross_floor_area_m2 = 100.0;
  building.usable_floor_area_m2 = 80.0;
  building.height_meters = 4.0;
  building.stories = 1;
  building.realized_far = 0.25;
  building.coverage_ratio = 0.25;
  building.status = BuildingStatus::occupied;
  building.year_built = 2026;
  building.project_cost = 250'000.0;
  building.entitlement.zoning_district_id = "R2";
  building.entitlement.approved_far = 0.25;
  building.entitlement.approved_height_meters = 4.0;
  building.entitlement.approved_uses = {UseType::residential};
  return building;
}

std::map<ParcelId, ParcelDevelopmentEnvelope> envelope_fixture() {
  std::map<ParcelId, ParcelDevelopmentEnvelope> result;
  for (const auto external_id : {"p0", "p1"}) {
    const auto id = parcel_id_from_external(external_id);
    ParcelDevelopmentEnvelope envelope;
    envelope.parcel_id = id;
    envelope.district_id = "R2";
    envelope.buildable_footprint.vertices = {{200, 200}, {1800, 200}, {1800, 1800}, {200, 1800}};
    envelope.parcel_area_m2 = 400.0;
    envelope.frontage_meters = 20.0;
    envelope.max_footprint_area_m2 = 256.0;
    envelope.max_gross_floor_area_m2 = 480.0;
    envelope.max_height_meters = 12.0;
    envelope.max_stories = 3;
    envelope.allowed_far = 1.2;
    envelope.effective_far = 1.2;
    envelope.effective_coverage_ratio = 0.64;
    envelope.permitted_uses = {UseType::residential};
    result.emplace(id, std::move(envelope));
  }
  return result;
}

PropertyMarketSnapshot property_fixture() {
  return PropertyMarketSnapshot{
      .holdings = {
          PropertyHolding{"p0", "owner:a", 100.0},
          PropertyHolding{"p1", "owner:b", 110.0},
      },
      .transactions = {},
      .next_transaction_id = 1,
  };
}

NativeUrbanFabricSnapshotSources sources_fixture(
    const WorldFoundation& world,
    const CadastralGraph& cadastre,
    const ZoningStore& zoning,
    const std::map<ParcelId, ParcelDevelopmentEnvelope>& envelopes,
    const UrbanFabricStore& urban,
    const PropertyMarketSystem& property) {
  return NativeUrbanFabricSnapshotSources{
      .world = &world,
      .cadastre = &cadastre,
      .zoning = &zoning,
      .buildable_envelopes = &envelopes,
      .urban_fabric = &urban,
      .property_market = &property,
  };
}

TEST(NativeUrbanFabricSnapshotRed, PublishesEveryRendererAndUiReadDomainInCanonicalOrder) {
  auto world_result = WorldFoundation::generate(77, WorldConfig{});
  ASSERT_TRUE(world_result) << world_result.error().message;
  auto world = std::move(*world_result);
  auto cadastre = cadastre_fixture();

  ZoningStore zoning;
  ASSERT_TRUE(zoning.assign(parcel_id_from_external("p1"), "R2"));
  ASSERT_TRUE(zoning.assign(parcel_id_from_external("p0"), "R2"));
  auto envelopes = envelope_fixture();

  UrbanFabricStore urban(&cadastre);
  ASSERT_TRUE(urban.upsert_building(building_fixture()));
  PropertyMarketSystem property(cadastre);
  ASSERT_TRUE(property.restore(property_fixture()));

  NativeUrbanFabricSnapshotPublisher publisher;
  const auto published = publisher.publish(sources_fixture(world, cadastre, zoning, envelopes, urban, property));
  ASSERT_TRUE(published) << published.error().message;
  const auto& snapshot = **published;

  EXPECT_EQ(snapshot.terrain().width, world.terrain().width);
  EXPECT_EQ(snapshot.terrain().height, world.terrain().height);
  EXPECT_EQ(snapshot.geography().entities.size(), world.geography().entities.size());
  ASSERT_EQ(snapshot.parcels().size(), 2U);
  EXPECT_EQ(snapshot.parcels()[0].external_id, "p0");
  EXPECT_EQ(snapshot.parcels()[1].external_id, "p1");
  EXPECT_FALSE(snapshot.parcel_lines().empty());
  EXPECT_TRUE(std::any_of(snapshot.parcel_lines().begin(), snapshot.parcel_lines().end(), [](const SnapshotParcelLine& line) {
    return !line.frontage_parcel_ids.empty();
  }));
  ASSERT_EQ(snapshot.zoning().size(), 2U);
  EXPECT_EQ(snapshot.zoning()[0].assignment.parcel_id, parcel_id_from_external("p0"));
  ASSERT_EQ(snapshot.buildable_envelopes().size(), 2U);
  EXPECT_EQ(snapshot.buildable_envelopes()[0].parcel_id, parcel_id_from_external("p0"));
  ASSERT_EQ(snapshot.buildings().size(), 1U);
  EXPECT_EQ(snapshot.buildings()[0].external_id, "building:p0");
  ASSERT_EQ(snapshot.property_state().holdings.size(), 2U);
  EXPECT_FALSE(snapshot.selection_lookup().empty());

  const auto* parcel_selection = snapshot.find_selection(SnapshotSelectionKind::parcel, "p0");
  ASSERT_NE(parcel_selection, nullptr);
  ASSERT_TRUE(parcel_selection->parcel_id);
  EXPECT_EQ(*parcel_selection->parcel_id, parcel_id_from_external("p0"));

  const auto* building_selection = snapshot.find_selection(SnapshotSelectionKind::building, "building:p0");
  ASSERT_NE(building_selection, nullptr);
  ASSERT_TRUE(building_selection->building_id);
  EXPECT_EQ(*building_selection->building_id, building_id_from_external("building:p0"));
}

TEST(NativeUrbanFabricSnapshotRed, PublishedHandleIsConstAndDetachedFromLaterAuthoritativeMutation) {
  static_assert(std::is_const_v<typename NativeUrbanFabricSnapshotPtr::element_type>);

  auto world_result = WorldFoundation::generate(88, WorldConfig{});
  ASSERT_TRUE(world_result);
  auto world = std::move(*world_result);
  auto cadastre = cadastre_fixture();
  ZoningStore zoning;
  ASSERT_TRUE(zoning.assign(parcel_id_from_external("p0"), "R2"));
  ASSERT_TRUE(zoning.assign(parcel_id_from_external("p1"), "R2"));
  auto envelopes = envelope_fixture();
  UrbanFabricStore urban(&cadastre);
  ASSERT_TRUE(urban.upsert_building(building_fixture()));
  PropertyMarketSystem property(cadastre);
  ASSERT_TRUE(property.restore(property_fixture()));

  NativeUrbanFabricSnapshotPublisher publisher;
  const auto sources = sources_fixture(world, cadastre, zoning, envelopes, urban, property);
  const auto first = publisher.publish(sources);
  ASSERT_TRUE(first);
  const auto unchanged = publisher.publish(sources);
  ASSERT_TRUE(unchanged);
  EXPECT_EQ((*first)->revisions(), (*unchanged)->revisions());

  PropertyTransactionInput transaction;
  transaction.tick = 10;
  transaction.parcel_ids = {"p0"};
  transaction.buyer_id = "developer:b";
  transaction.seller_id = "owner:a";
  transaction.purpose = PropertyTransactionPurpose::sale;
  transaction.price = 100.0;
  transaction.land_value = 60.0;
  transaction.improvement_value = 40.0;
  ASSERT_TRUE(property.transact(transaction));

  const auto changed = publisher.publish(sources);
  ASSERT_TRUE(changed);
  EXPECT_EQ((*first)->revisions().cadastre, (*changed)->revisions().cadastre);
  EXPECT_EQ((*first)->revisions().buildings, (*changed)->revisions().buildings);
  EXPECT_NE((*first)->revisions().property, (*changed)->revisions().property);
  EXPECT_NE((*first)->revisions().snapshot, (*changed)->revisions().snapshot);

  const auto original_owner = std::find_if(
      (*first)->property_state().holdings.begin(),
      (*first)->property_state().holdings.end(),
      [](const PropertyHolding& holding) { return holding.parcel_id == "p0"; });
  ASSERT_NE(original_owner, (*first)->property_state().holdings.end());
  EXPECT_EQ(original_owner->owner_id, "owner:a");
}

TEST(NativeUrbanFabricSnapshotRed, RejectsIncompleteOrDivergentSourceBundles) {
  auto world_result = WorldFoundation::generate(99, WorldConfig{});
  ASSERT_TRUE(world_result);
  auto world = std::move(*world_result);
  auto cadastre = cadastre_fixture();
  ZoningStore zoning;
  ASSERT_TRUE(zoning.assign(parcel_id_from_external("p0"), "R2"));
  ASSERT_TRUE(zoning.assign(parcel_id_from_external("p1"), "R2"));
  auto envelopes = envelope_fixture();
  UrbanFabricStore urban(&cadastre);
  ASSERT_TRUE(urban.upsert_building(building_fixture()));
  PropertyMarketSystem property(cadastre);
  ASSERT_TRUE(property.restore(property_fixture()));

  NativeUrbanFabricSnapshotPublisher publisher;
  auto missing_world = sources_fixture(world, cadastre, zoning, envelopes, urban, property);
  missing_world.world = nullptr;
  EXPECT_FALSE(publisher.publish(missing_world));

  auto divergent_envelopes = envelopes;
  divergent_envelopes.erase(parcel_id_from_external("p1"));
  const auto divergent = publisher.publish(sources_fixture(world, cadastre, zoning, divergent_envelopes, urban, property));
  EXPECT_FALSE(divergent);
}

}  // namespace
}  // namespace civic::snapshot
