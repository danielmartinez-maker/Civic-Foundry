#include "civic/urban/DevelopmentAuthority.hpp"

#include "civic/cadastre/Cadastre.hpp"
#include "civic/urban/BuildingMassing.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <span>
#include <string>
#include <vector>

namespace civic::urban {
namespace {

using civic::cadastre::CadastralGraph;
using civic::cadastre::Parcel;
using civic::cadastre::parcel_id_from_external;
using civic::core::ParcelId;

HighestBestUseInput hbu_fixture() {
  HighestBestUseInput input;
  input.parcel_ids = {ParcelId{1}};
  input.hold_value = 3'000'000.0;
  input.building_condition = 70.0;
  input.developer_hurdle_rate = 0.12;
  input.renovation_net_value = 0.0;
  input.renovation_expected_return = 0.0;
  input.renovation_risk_score = 0.10;
  input.conversion_net_value = 0.0;
  input.conversion_expected_return = 0.0;
  input.conversion_risk_score = 0.15;
  input.redevelopment_net_value = 4'000'000.0;
  input.redevelopment_expected_return = 0.18;
  input.redevelopment_risk_score = 0.20;
  return input;
}

Parcel parcel_fixture(std::string external_id, std::string owner_id, std::int64_t min_x_cm, std::int64_t max_x_cm) {
  Parcel parcel;
  parcel.external_id = std::move(external_id);
  parcel.id = parcel_id_from_external(parcel.external_id);
  parcel.block_id = "block";
  parcel.boundary.vertices = {
      {min_x_cm, 0},
      {max_x_cm, 0},
      {max_x_cm, 2000},
      {min_x_cm, 2000},
  };
  parcel.zoning_district_id = "R2";
  parcel.owner_id = std::move(owner_id);
  return parcel;
}

CadastralGraph three_parcel_graph() {
  CadastralGraph graph;
  EXPECT_TRUE(graph.insert(parcel_fixture("p0", "owner:a", 0, 2000)));
  EXPECT_TRUE(graph.insert(parcel_fixture("p1", "owner:b", 2000, 4000)));
  EXPECT_TRUE(graph.insert(parcel_fixture("p2", "owner:c", 4000, 6000)));
  return graph;
}

PropertyMarketSnapshot market_snapshot() {
  return PropertyMarketSnapshot{
      .holdings = {
          {"p0", "owner:a", 100.0},
          {"p1", "owner:b", 105.0},
          {"p2", "owner:c", 180.0},
      },
      .transactions = {},
      .next_transaction_id = 1,
  };
}

TEST(HighestBestUseParity, ProfitableExistingNoiCanMakeHoldWin) {
  auto input = hbu_fixture();
  input.hold_value = 5'000'000.0;
  input.redevelopment_net_value = 4'700'000.0;

  const auto result = HighestBestUseSystem{}.evaluate(input);
  ASSERT_TRUE(result) << result.error().message;
  EXPECT_EQ(result->best_strategy, HighestBestUseStrategy::hold);
  EXPECT_LT(result->redevelopment_premium, 0.0);
  EXPECT_DOUBLE_EQ(result->best_value, 5'000'000.0);
}

TEST(HighestBestUseParity, UpzoningAndDeteriorationCanMakeRedevelopmentWin) {
  auto input = hbu_fixture();
  input.hold_value = 2'000'000.0;
  input.redevelopment_net_value = 5'500'000.0;
  input.redevelopment_expected_return = 0.24;
  input.building_condition = 35.0;

  const auto result = HighestBestUseSystem{}.evaluate(input);
  ASSERT_TRUE(result) << result.error().message;
  EXPECT_EQ(result->best_strategy, HighestBestUseStrategy::redevelop);
  EXPECT_GT(result->redevelopment_premium, 0.0);
  EXPECT_DOUBLE_EQ(result->best_value, 5'500'000.0);
}

TEST(HighestBestUseParity, RiskAdjustedReturnCanBlockHigherValueStrategy) {
  auto input = hbu_fixture();
  input.hold_value = 2'500'000.0;
  input.redevelopment_net_value = 6'000'000.0;
  input.redevelopment_expected_return = 0.13;
  input.redevelopment_risk_score = 0.45;
  input.developer_hurdle_rate = 0.12;

  const auto result = HighestBestUseSystem{}.evaluate(input);
  ASSERT_TRUE(result) << result.error().message;
  EXPECT_EQ(result->best_strategy, HighestBestUseStrategy::hold);
  const auto redevelopment = std::find_if(result->alternatives.begin(), result->alternatives.end(), [](const HighestBestUseAlternative& alternative) {
    return alternative.strategy == HighestBestUseStrategy::redevelop;
  });
  ASSERT_NE(redevelopment, result->alternatives.end());
  EXPECT_FALSE(redevelopment->eligible);
}

TEST(HighestBestUseParity, RenovationConversionAndRedevelopmentCompeteOnNetValue) {
  auto input = hbu_fixture();
  input.hold_value = 2'000'000.0;
  input.renovation_net_value = 3'400'000.0;
  input.renovation_expected_return = 0.18;
  input.conversion_net_value = 4'100'000.0;
  input.conversion_expected_return = 0.20;
  input.redevelopment_net_value = 3'900'000.0;
  input.redevelopment_expected_return = 0.19;

  const auto result = HighestBestUseSystem{}.evaluate(input);
  ASSERT_TRUE(result) << result.error().message;
  EXPECT_EQ(result->best_strategy, HighestBestUseStrategy::convert);
  EXPECT_DOUBLE_EQ(result->best_value, 4'100'000.0);
}

TEST(PropertyMarketParity, TransactionChangesOwnerAndPreservesV9Values) {
  auto graph = three_parcel_graph();
  PropertyMarketSystem market(graph);
  ASSERT_TRUE(market.restore(market_snapshot()));

  PropertyTransactionInput input;
  input.tick = 100;
  input.parcel_ids = {"p0"};
  input.buyer_id = "developer:b";
  input.seller_id = "owner:a";
  input.purpose = PropertyTransactionPurpose::redevelopment;
  input.price = 160.0;
  input.land_value = 90.0;
  input.improvement_value = 70.0;

  const auto transaction = market.transact(input);
  ASSERT_TRUE(transaction) << transaction.error().message;
  ASSERT_TRUE(market.owner_of("p0"));
  EXPECT_EQ(*market.owner_of("p0"), "developer:b");
  EXPECT_EQ(transaction->id, "property:tx:1");
  EXPECT_DOUBLE_EQ(transaction->land_value, 90.0);
  EXPECT_DOUBLE_EQ(transaction->improvement_value, 70.0);
  EXPECT_DOUBLE_EQ(transaction->price, 160.0);

  const auto snapshot = market.snapshot();
  EXPECT_EQ(snapshot.next_transaction_id, 2U);
  ASSERT_EQ(snapshot.transactions.size(), 1U);
  EXPECT_EQ(snapshot.transactions.front().id, "property:tx:1");
}

TEST(PropertyMarketParity, MultiParcelTransferIsAtomicWhenSellerOwnershipIsInconsistent) {
  auto graph = three_parcel_graph();
  PropertyMarketSystem market(graph);
  ASSERT_TRUE(market.restore(market_snapshot()));

  PropertyTransactionInput input;
  input.tick = 100;
  input.parcel_ids = {"p0", "p1"};
  input.buyer_id = "developer:b";
  input.seller_id = "owner:a";
  input.purpose = PropertyTransactionPurpose::assembly;
  input.price = 205.0;
  input.land_value = 150.0;
  input.improvement_value = 55.0;

  const auto transaction = market.transact(input);
  EXPECT_FALSE(transaction);
  ASSERT_TRUE(market.owner_of("p0"));
  ASSERT_TRUE(market.owner_of("p1"));
  EXPECT_EQ(*market.owner_of("p0"), "owner:a");
  EXPECT_EQ(*market.owner_of("p1"), "owner:b");
  EXPECT_TRUE(market.snapshot().transactions.empty());
}

TEST(PropertyMarketParity, RestoreAcceptsHistoricalTransactionParcelButRejectsMissingLiveHolding) {
  auto graph = three_parcel_graph();
  PropertyMarketSystem market(graph);
  auto snapshot = market_snapshot();
  snapshot.transactions.push_back(PropertyTransaction{
      .id = "property:tx:1",
      .tick = 50,
      .parcel_ids = {"parcel:retired"},
      .buyer_id = "owner:a",
      .seller_id = "owner:old",
      .purpose = PropertyTransactionPurpose::sale,
      .price = 100.0,
      .land_value = 100.0,
      .improvement_value = 0.0,
  });
  snapshot.next_transaction_id = 2;

  ASSERT_TRUE(market.restore(snapshot, {"parcel:retired"}));
  auto invalid = market_snapshot();
  invalid.holdings.push_back({"parcel:missing", "owner:x", 1.0});
  EXPECT_FALSE(market.restore(invalid));
  EXPECT_EQ(market.snapshot().next_transaction_id, 2U);
}

TEST(SiteAssemblyParity, AssemblyIsOfferedOnlyWhenGeometryUpliftBeatsAcquisitionFriction) {
  auto graph = three_parcel_graph();
  PropertyMarketSystem market(graph);
  ASSERT_TRUE(market.restore(market_snapshot()));

  SiteAssemblyEnvelopeResolver resolver = [](std::span<const std::string> parcel_ids) -> civic::core::Result<SiteAssemblyEnvelopeResolution> {
    std::string key;
    for (const auto& id : parcel_ids) {
      if (!key.empty()) key += "+";
      key += id;
    }
    double value = 0.0;
    if (key == "p0") value = 100.0;
    else if (key == "p1") value = 100.0;
    else if (key == "p2") value = 100.0;
    else if (key == "p0+p1") value = 270.0;
    else if (key == "p0+p1+p2") value = 390.0;
    return SiteAssemblyEnvelopeResolution{
        .best_feasible_hbu_value = value,
        .expected_return = key == "p0+p1" ? 0.18 : 0.11,
        .developer_hurdle_rate = 0.12,
        .incremental_demolition_cost = key == "p0+p1" ? 10.0 : 20.0,
    };
  };

  const auto candidates = SiteAssemblySystem{}.candidates("p0", graph, market, resolver);
  ASSERT_TRUE(candidates) << candidates.error().message;
  ASSERT_EQ(candidates->size(), 1U);
  EXPECT_EQ(candidates->front().parcel_ids, (std::vector<std::string>{"p0", "p1"}));
  EXPECT_GT(candidates->front().incremental_development_value, candidates->front().incremental_assembly_cost);
  EXPECT_GE(candidates->front().expected_return, candidates->front().developer_hurdle_rate);
}

TEST(SiteAssemblyParity, CandidateEnumerationIsDeterministicAndBounded) {
  auto graph = three_parcel_graph();
  PropertyMarketSystem market(graph);
  auto snapshot = market_snapshot();
  snapshot.holdings[1].reservation_value = 100.0;
  snapshot.holdings[2].reservation_value = 100.0;
  ASSERT_TRUE(market.restore(snapshot));

  SiteAssemblyEnvelopeResolver resolver = [](std::span<const std::string> parcel_ids) -> civic::core::Result<SiteAssemblyEnvelopeResolution> {
    return SiteAssemblyEnvelopeResolution{
        .best_feasible_hbu_value = parcel_ids.size() == 1U ? 100.0 : static_cast<double>(parcel_ids.size()) * 100.0 + 100.0,
        .expected_return = 0.20,
        .developer_hurdle_rate = 0.10,
        .incremental_demolition_cost = 0.0,
    };
  };

  const auto first = SiteAssemblySystem{}.candidates("p0", graph, market, resolver);
  const auto second = SiteAssemblySystem{}.candidates("p0", graph, market, resolver);
  ASSERT_TRUE(first && second);
  EXPECT_EQ(*first, *second);
  ASSERT_FALSE(first->empty());
  EXPECT_TRUE(std::all_of(first->begin(), first->end(), [](const SiteAssemblyCandidate& candidate) {
    return candidate.parcel_ids.size() >= 2U && candidate.parcel_ids.size() <= 4U && candidate.parcel_ids.front() == "p0";
  }));
}

TEST(DevelopmentAuthorityCorrection, HbuGatePreventsPhysicalCandidateBypass) {
  DevelopmentCandidate candidate;
  candidate.id = "candidate:parcel:1";
  candidate.parcel_ids = {ParcelId{1}};
  candidate.zoning_legal = true;

  auto input = hbu_fixture();
  input.hold_value = 2'500'000.0;
  input.redevelopment_net_value = 6'000'000.0;
  input.redevelopment_expected_return = 0.13;
  input.redevelopment_risk_score = 0.45;
  input.developer_hurdle_rate = 0.12;

  const auto decision = DevelopmentAuthority{}.evaluate(candidate, input);
  ASSERT_TRUE(decision) << decision.error().message;
  EXPECT_EQ(decision->hbu.best_strategy, HighestBestUseStrategy::hold);
  EXPECT_FALSE(decision->eligible_for_developer_market);
}

TEST(DevelopmentAuthorityCorrection, EligibleRedevelopmentPassesAuthoritativeGate) {
  DevelopmentCandidate candidate;
  candidate.id = "candidate:parcel:1";
  candidate.parcel_ids = {ParcelId{1}};
  candidate.zoning_legal = true;

  auto input = hbu_fixture();
  input.hold_value = 2'000'000.0;
  input.redevelopment_net_value = 5'500'000.0;
  input.redevelopment_expected_return = 0.24;
  input.redevelopment_risk_score = 0.10;

  const auto decision = DevelopmentAuthority{}.evaluate(candidate, input);
  ASSERT_TRUE(decision) << decision.error().message;
  EXPECT_EQ(decision->hbu.best_strategy, HighestBestUseStrategy::redevelop);
  EXPECT_TRUE(decision->eligible_for_developer_market);
}

}  // namespace
}  // namespace civic::urban
