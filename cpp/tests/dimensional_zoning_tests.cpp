#include <gtest/gtest.h>
#include "civic/urban/Zoning.hpp"
#include <algorithm>
#include <array>
#include <string>
#include <vector>

namespace {
using civic::core::ParcelId;
using civic::urban::ParcelZoningAssignment;
using civic::urban::UseType;
using civic::urban::ZoningOverlay;
using civic::urban::ZoningOverlayKind;
using civic::urban::ZoningStore;

TEST(NativeDimensionalZoningRed, CatalogPreservesStableDistrictIdsAndAcceptedDimensions) {
  const auto& catalog = civic::urban::zoning_district_catalog();
  ASSERT_EQ(catalog.size(), 6U);
  EXPECT_EQ(catalog[0].id, "C6");
  EXPECT_EQ(catalog[1].id, "IND");
  EXPECT_EQ(catalog[2].id, "MU4");
  EXPECT_EQ(catalog[3].id, "MU8");
  EXPECT_EQ(catalog[4].id, "R2");
  EXPECT_EQ(catalog[5].id, "R5");

  const auto* r2 = civic::urban::find_zoning_district("R2");
  ASSERT_NE(r2, nullptr);
  EXPECT_DOUBLE_EQ(r2->max_far, 1.5);
  EXPECT_DOUBLE_EQ(r2->max_height_meters, 12.0);
  EXPECT_EQ(r2->max_stories, 2U);
  EXPECT_DOUBLE_EQ(r2->max_coverage_ratio, 0.55);
  EXPECT_DOUBLE_EQ(r2->front_setback_meters, 4.0);
  EXPECT_DOUBLE_EQ(r2->rear_setback_meters, 5.0);
  EXPECT_DOUBLE_EQ(r2->side_setback_meters, 2.0);
  EXPECT_DOUBLE_EQ(r2->min_parcel_area_m2, 250.0);
  EXPECT_DOUBLE_EQ(r2->min_frontage_meters, 8.0);

  const auto* mu8 = civic::urban::find_zoning_district("MU8");
  ASSERT_NE(mu8, nullptr);
  EXPECT_DOUBLE_EQ(mu8->max_far, 8.0);
  EXPECT_DOUBLE_EQ(mu8->max_height_meters, 90.0);
  EXPECT_EQ(mu8->max_stories, 25U);
  EXPECT_DOUBLE_EQ(mu8->max_coverage_ratio, 0.80);
  EXPECT_DOUBLE_EQ(mu8->min_frontage_meters, 10.0);

  const auto* industrial = civic::urban::find_zoning_district("IND");
  ASSERT_NE(industrial, nullptr);
  EXPECT_DOUBLE_EQ(industrial->max_far, 2.0);
  EXPECT_DOUBLE_EQ(industrial->max_height_meters, 24.0);
  EXPECT_EQ(industrial->max_stories, 5U);
  EXPECT_DOUBLE_EQ(industrial->front_setback_meters, 5.0);
  EXPECT_DOUBLE_EQ(industrial->side_setback_meters, 3.0);
  EXPECT_DOUBLE_EQ(industrial->min_parcel_area_m2, 500.0);
  EXPECT_DOUBLE_EQ(industrial->min_frontage_meters, 15.0);
}

TEST(NativeDimensionalZoningRed, MixedUseAndIndustrialUseRulesMatchAcceptedCatalog) {
  const auto* mu4 = civic::urban::find_zoning_district("MU4");
  ASSERT_NE(mu4, nullptr);
  EXPECT_EQ(mu4->permitted_uses, (std::vector<UseType>{
      UseType::residential, UseType::retail, UseType::office, UseType::hospitality}));
  EXPECT_TRUE(mu4->conditional_uses.empty());

  const auto* industrial = civic::urban::find_zoning_district("IND");
  ASSERT_NE(industrial, nullptr);
  EXPECT_EQ(industrial->permitted_uses, (std::vector<UseType>{
      UseType::light_industrial, UseType::heavy_industrial, UseType::logistics}));

  EXPECT_EQ(civic::urban::district_for_legacy_zone("residential"), "R2");
  EXPECT_EQ(civic::urban::district_for_legacy_zone("commercial"), "C6");
  EXPECT_EQ(civic::urban::district_for_legacy_zone("industrial"), "IND");
  EXPECT_TRUE(civic::urban::district_for_legacy_zone("civic").empty());
}

TEST(NativeDimensionalZoningRed, AssignmentStateIsSeparateAndCanonicalizesOverlays) {
  const ParcelId parcel{42};
  ZoningStore store;
  ASSERT_TRUE(store.assign(parcel, "MU4", {"tod:p0", "airport:p0", "tod:p0"}).has_value());

  const auto* assignment = store.find_assignment(parcel);
  ASSERT_NE(assignment, nullptr);
  EXPECT_EQ(assignment->district_id, "MU4");
  EXPECT_EQ(assignment->overlay_ids, (std::vector<std::string>{"airport:p0", "tod:p0"}));
  ASSERT_EQ(store.assignments().size(), 1U);

  const auto* catalog_mu4 = civic::urban::find_zoning_district("MU4");
  ASSERT_NE(catalog_mu4, nullptr);
  EXPECT_DOUBLE_EQ(catalog_mu4->max_far, 4.0);

  EXPECT_FALSE(store.assign(ParcelId{}, "MU4").has_value());
  EXPECT_FALSE(store.assign(ParcelId{43}, "UNKNOWN").has_value());
  EXPECT_TRUE(store.clear(parcel));
  EXPECT_EQ(store.find_assignment(parcel), nullptr);
}

TEST(NativeDimensionalZoningRed, OverlayCompositionMatchesCurrentTwoRRulesDeterministically) {
  const ParcelId parcel{100};
  ZoningStore store;
  ASSERT_TRUE(store.upsert_overlay(ZoningOverlay{
      .id = "airport:p0",
      .kind = ZoningOverlayKind::airport_height,
      .parcel_ids = {parcel},
      .max_height_meters = 20.0,
      .additional_front_setback_meters = 1.0,
      .prohibited_uses = {UseType::hospitality},
  }).has_value());
  ASSERT_TRUE(store.upsert_overlay(ZoningOverlay{
      .id = "tod:p0",
      .kind = ZoningOverlayKind::transit_oriented,
      .parcel_ids = {parcel},
      .max_far_multiplier = 1.25,
      .permitted_use_additions = {UseType::civic},
  }).has_value());
  ASSERT_TRUE(store.assign(parcel, "MU4", {"tod:p0", "airport:p0"}).has_value());

  auto controls = store.effective_controls(parcel);
  ASSERT_TRUE(controls.has_value());
  EXPECT_EQ(controls->district_id, "MU4");
  EXPECT_DOUBLE_EQ(controls->max_far, 5.0);
  EXPECT_DOUBLE_EQ(controls->max_height_meters, 20.0);
  EXPECT_DOUBLE_EQ(controls->max_coverage_ratio, 0.75);
  EXPECT_DOUBLE_EQ(controls->front_setback_meters, 1.0);
  EXPECT_DOUBLE_EQ(controls->rear_setback_meters, 3.0);
  EXPECT_DOUBLE_EQ(controls->side_setback_meters, 0.0);
  EXPECT_EQ(controls->overlay_ids, (std::vector<std::string>{"airport:p0", "tod:p0"}));
  EXPECT_NE(std::find(controls->permitted_uses.begin(), controls->permitted_uses.end(), UseType::civic),
            controls->permitted_uses.end());
  EXPECT_EQ(std::find(controls->permitted_uses.begin(), controls->permitted_uses.end(), UseType::hospitality),
            controls->permitted_uses.end());
}

TEST(NativeDimensionalZoningRed, OverlayAndRestoreValidationRejectsDivergentState) {
  const ParcelId parcel{200};
  ZoningStore store;
  EXPECT_FALSE(store.upsert_overlay(ZoningOverlay{
      .id = "",
      .kind = ZoningOverlayKind::floodplain,
      .parcel_ids = {parcel},
  }).has_value());
  EXPECT_FALSE(store.upsert_overlay(ZoningOverlay{
      .id = "bad:far",
      .kind = ZoningOverlayKind::downtown_bonus,
      .parcel_ids = {parcel},
      .max_far_multiplier = -0.1,
  }).has_value());

  const std::array duplicate_assignments{
      ParcelZoningAssignment{parcel, "R2", {}},
      ParcelZoningAssignment{parcel, "MU4", {}},
  };
  EXPECT_FALSE(store.restore_assignments(duplicate_assignments).has_value());
  EXPECT_TRUE(store.assignments().empty());

  const std::array unknown_district{
      ParcelZoningAssignment{parcel, "NOPE", {}},
  };
  EXPECT_FALSE(store.restore_assignments(unknown_district).has_value());
  EXPECT_TRUE(store.assignments().empty());
}
}  // namespace
