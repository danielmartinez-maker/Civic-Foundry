#include <gtest/gtest.h>

#include <limits>
#include <vector>

#include <civic/socioeconomic/SocioeconomicRuntime.hpp>

namespace socio = civic::socioeconomic;

TEST(Stack3Definitions, ValidatesReferencesAndAssignsStableRuntimeIds) {
    socio::EconomicDefinitions definitions;
    const std::vector<socio::ProductDefinitionInput> products{{"steel", 1000}, {"cars", 1}};
    const std::vector<socio::SectorDefinitionInput> sectors{{"manufacturing"}};
    const std::vector<socio::RecipeDefinitionInput> recipes{{"car-assembly", "manufacturing", {{"steel", 2}}, {{"cars", 1}}, 1.0}};
    ASSERT_TRUE(definitions.load(products, sectors, recipes));
    ASSERT_TRUE(definitions.product("cars"));
    ASSERT_TRUE(definitions.product("steel"));
    EXPECT_LT(definitions.product("cars")->runtime_id.value(), definitions.product("steel")->runtime_id.value());

    socio::EconomicDefinitions invalid;
    const std::vector<socio::RecipeDefinitionInput> invalid_recipes{{"broken", "manufacturing", {{"missing", 1}}, {{"cars", 1}}, 1.0}};
    EXPECT_FALSE(invalid.load(products, sectors, invalid_recipes));
}

TEST(Stack3Ledger, EveryAcceptedTransferIsBalancedAndSequenced) {
    socio::EconomicLedger ledger;
    ASSERT_TRUE(ledger.transfer(socio::AccountId{1}, socio::AccountId{2}, civic::Money{1250}, 7, socio::LedgerReason::sale, civic::EntityId{4}));
    ASSERT_TRUE(ledger.transfer(socio::AccountId{2}, socio::AccountId{3}, civic::Money{300}, 8, socio::LedgerReason::payroll, civic::EntityId{5}));
    EXPECT_FALSE(ledger.transfer(socio::AccountId{1}, socio::AccountId{2}, civic::Money{0}, 9, socio::LedgerReason::sale, civic::EntityId{4}));
    ASSERT_EQ(ledger.entries().size(), 2U);
    EXPECT_EQ(ledger.entries()[0].sequence, 1U);
    EXPECT_EQ(ledger.entries()[1].sequence, 2U);
    auto report = ledger.reconcile(); ASSERT_TRUE(report);
    EXPECT_EQ(report->debits.minor_units(), report->credits.minor_units());
}

TEST(Stack3FirmStore, RejectsDuplicateIdsAndRestoresAllocatorAboveLiveIds) {
    socio::FirmStore firms;
    socio::Firm firm{};
    firm.id = civic::FirmId{9};
    firm.sector = socio::SectorRuntimeId{1};
    firm.location = civic::BuildingId{3};
    firm.cash = civic::Money{10000};
    ASSERT_TRUE(firms.insert(firm));
    EXPECT_FALSE(firms.insert(firm));
    const std::vector<socio::Firm> restored_firms{firm};
    ASSERT_TRUE(firms.restore(restored_firms, civic::FirmId{2}));
    EXPECT_GT(firms.next_id().value(), 9U);

    firm.cash = civic::Money{std::numeric_limits<std::int64_t>::min()};
    EXPECT_FALSE(firms.insert(firm));
}

TEST(Stack3Inventory, FullDestinationPreservesRejectedQuantity) {
    socio::InventoryStore inventories;
    const auto product = socio::ProductRuntimeId{1};
    ASSERT_TRUE(inventories.create(socio::InventoryId{1}, product, 10, 10));
    ASSERT_TRUE(inventories.create(socio::InventoryId{2}, product, 9, 10));
    auto receipt = inventories.receive(socio::InventoryId{2}, 5); ASSERT_TRUE(receipt);
    EXPECT_EQ(receipt->accepted, 1);
    EXPECT_EQ(receipt->rejected, 4);
    EXPECT_EQ(inventories.quantity(socio::InventoryId{2}), 10);

    auto transfer = inventories.transfer(socio::InventoryId{1}, socio::InventoryId{2}, 5); ASSERT_TRUE(transfer);
    EXPECT_EQ(transfer->accepted, 0);
    EXPECT_EQ(transfer->rejected, 5);
    EXPECT_EQ(inventories.quantity(socio::InventoryId{1}), 10);
    EXPECT_EQ(inventories.quantity(socio::InventoryId{2}), 10);
}

TEST(Stack3Production, CannotCreateOutputsWithoutInputsAndConservesInventory) {
    socio::InventoryStore inventories;
    ASSERT_TRUE(inventories.create(socio::InventoryId{1}, socio::ProductRuntimeId{1}, 1, 100));
    ASSERT_TRUE(inventories.create(socio::InventoryId{2}, socio::ProductRuntimeId{2}, 0, 100));
    socio::ProductionSystem production;
    socio::RuntimeRecipe recipe{{{socio::InventoryId{1}, 2}}, {{socio::InventoryId{2}, 1}}, 1.0};
    EXPECT_FALSE(production.run(recipe, 1, 1.0, inventories));
    EXPECT_EQ(inventories.quantity(socio::InventoryId{1}), 1);
    EXPECT_EQ(inventories.quantity(socio::InventoryId{2}), 0);
    ASSERT_TRUE(inventories.receive(socio::InventoryId{1}, 1));
    ASSERT_TRUE(production.run(recipe, 1, 1.0, inventories));
    EXPECT_EQ(inventories.quantity(socio::InventoryId{1}), 0);
    EXPECT_EQ(inventories.quantity(socio::InventoryId{2}), 1);
}

TEST(Stack3Labor, AllocationCannotExceedWorkersOrVacanciesAndTieBreaksById) {
    socio::LaborMarket market;
    ASSERT_TRUE(market.add_worker({socio::WorkerId{2}, 1, 10.0, true}));
    ASSERT_TRUE(market.add_worker({socio::WorkerId{1}, 1, 10.0, true}));
    ASSERT_TRUE(market.add_opening({socio::JobOpeningId{3}, civic::FirmId{2}, 1, civic::Money{2000}, 10.0, true}));
    auto allocations = market.clear(); ASSERT_TRUE(allocations);
    ASSERT_EQ(allocations->size(), 1U);
    EXPECT_EQ(allocations->front().worker, socio::WorkerId{1});
    EXPECT_EQ(allocations->front().opening, socio::JobOpeningId{3});
}

TEST(Stack3Trade, ChoosesLowestDeliveredGeneralizedCostWithStableTieBreak) {
    const std::vector<socio::SupplierCandidate> candidates{
        {civic::FirmId{9}, 100, 20, 5, 1},
        {civic::FirmId{4}, 100, 20, 5, 1},
        {civic::FirmId{8}, 90, 40, 1, 1},
    };
    auto selected = socio::TradeSystem::choose_supplier(candidates); ASSERT_TRUE(selected);
    EXPECT_EQ(selected->supplier, civic::FirmId{4});
}

TEST(Stack3Freight, PartialDeliveryAndFullSourceCancellationNeverDestroyCargo) {
    socio::InventoryStore inventories;
    const auto product = socio::ProductRuntimeId{1};
    ASSERT_TRUE(inventories.create(socio::InventoryId{1}, product, 0, 10));
    ASSERT_TRUE(inventories.create(socio::InventoryId{2}, product, 9, 10));
    socio::FreightOrderStore freight;
    auto id = freight.create({socio::InventoryId{1}, socio::InventoryId{2}, product, 5}); ASSERT_TRUE(id);
    auto first = freight.deliver(*id, 5, inventories); ASSERT_TRUE(first);
    EXPECT_EQ(first->delivered, 1);
    EXPECT_EQ(first->still_active, 4);
    EXPECT_EQ(inventories.quantity(socio::InventoryId{2}), 10);
    EXPECT_FALSE(freight.deliver(*id, 1, inventories));

    ASSERT_TRUE(inventories.receive(socio::InventoryId{1}, 10));
    auto cancelled = freight.cancel(*id, inventories); ASSERT_TRUE(cancelled);
    EXPECT_EQ(cancelled->returned, 0);
    EXPECT_EQ(cancelled->still_active, 4);
    auto invariant = freight.conservation(*id); ASSERT_TRUE(invariant);
    EXPECT_TRUE(invariant->balanced);
    EXPECT_EQ(invariant->created, invariant->delivered + invariant->returned + invariant->active + invariant->lost);
}

TEST(Stack3FreightVehicle, RejectsNonFiniteTravelAndPreservesCargoOnFailure) {
    socio::FreightVehicleStore vehicles;
    EXPECT_FALSE(vehicles.assign({socio::FreightVehicleId{1}, socio::FreightOrderId{1}, 4, std::numeric_limits<double>::quiet_NaN(), 0.0}));
    ASSERT_TRUE(vehicles.assign({socio::FreightVehicleId{1}, socio::FreightOrderId{1}, 4, 12.0, 0.0}));
    ASSERT_TRUE(vehicles.reroute_failure(socio::FreightVehicleId{1}));
    auto vehicle = vehicles.get(socio::FreightVehicleId{1}); ASSERT_TRUE(vehicle);
    EXPECT_EQ(vehicle->cargo, 4);
}

TEST(Stack3BusinessLifecycle, ClosureIsBlockedWhileLiveFreightReferencesFirm) {
    socio::BusinessLifecycle lifecycle;
    EXPECT_EQ(lifecycle.evaluate({civic::FirmId{1}, civic::Money{-1}, civic::Money{100}, true}), socio::BusinessLifecycleState::distressed);
    const std::vector<civic::FirmId> active_freight_firms{civic::FirmId{1}};
    const std::vector<civic::FirmId> no_active_freight;
    EXPECT_FALSE(lifecycle.can_close(civic::FirmId{1}, active_freight_firms));
    EXPECT_TRUE(lifecycle.can_close(civic::FirmId{1}, no_active_freight));
}

TEST(Stack3Households, PrimaryResidenceAndOccupancyRemainValid) {
    socio::HouseholdStore households;
    socio::Household h{};
    h.id = civic::HouseholdId{1};
    h.member_weight = 2.0;
    h.cash = civic::Money{1000};
    ASSERT_TRUE(households.insert(h));
    socio::HousingMarket housing;
    ASSERT_TRUE(housing.add_unit({socio::HousingUnitId{1}, civic::BuildingId{2}, 2.0}));
    ASSERT_TRUE(housing.add_unit({socio::HousingUnitId{2}, civic::BuildingId{3}, 2.0}));
    ASSERT_TRUE(housing.relocate(civic::HouseholdId{1}, 2.0, socio::HousingUnitId{1}));
    ASSERT_TRUE(housing.relocate(civic::HouseholdId{1}, 2.0, socio::HousingUnitId{2}));
    EXPECT_EQ(housing.primary_home(civic::HouseholdId{1}), socio::HousingUnitId{2});
    EXPECT_DOUBLE_EQ(housing.occupancy(socio::HousingUnitId{1}), 0.0);
    EXPECT_DOUBLE_EQ(housing.occupancy(socio::HousingUnitId{2}), 2.0);
    EXPECT_FALSE(housing.relocate(civic::HouseholdId{1}, 3.0, socio::HousingUnitId{2}));
}

TEST(Stack3Personhood, SoARegistryUsesStableIdsAcrossSlotReuse) {
    socio::PersonRegistry people;
    auto first = people.create({civic::HouseholdId{1}, 20, 2, 1, true, civic::Money{1000}}); ASSERT_TRUE(first);
    const auto first_id = *first;
    ASSERT_TRUE(people.erase(first_id));
    auto second = people.create({civic::HouseholdId{1}, 21, 2, 1, true, civic::Money{1000}}); ASSERT_TRUE(second);
    EXPECT_NE(second->value(), first_id.value());
    EXPECT_FALSE(people.get(first_id));
    EXPECT_TRUE(people.get(*second));
}

TEST(Stack3Personhood, FidelityTransitionsConservePopulationAndBalancesExactly) {
    socio::PopulationFidelityStore fidelity;
    ASSERT_TRUE(fidelity.add_cohort({socio::CohortId{1}, 10.0, civic::Money{5000}, socio::PopulationFidelity::weighted_cohort}));
    const auto before = fidelity.totals();
    ASSERT_TRUE(fidelity.promote(socio::CohortId{1}, 4.0));
    ASSERT_TRUE(fidelity.demote_explicit(4.0));
    const auto after = fidelity.totals();
    EXPECT_DOUBLE_EQ(after.population_weight, before.population_weight);
    EXPECT_EQ(after.cash.minor_units(), before.cash.minor_units());
}

TEST(Stack3CausalityIntegration, WagesFlowThroughLedgerIntoHouseholdIncome) {
    socio::SocioeconomicRuntime runtime{77};
    ASSERT_TRUE(runtime.households().insert({civic::HouseholdId{1}, 1.0, civic::Money{0}, civic::Money{0}, 0, {}, 0}));
    ASSERT_TRUE(runtime.register_payroll_accounts(civic::FirmId{1}, civic::HouseholdId{1}, socio::AccountId{1}, socio::AccountId{2}));
    ASSERT_TRUE(runtime.pay_wage(civic::FirmId{1}, civic::HouseholdId{1}, civic::Money{2500}, 12));
    auto household = runtime.households().get(civic::HouseholdId{1}); ASSERT_TRUE(household);
    EXPECT_EQ(household->income.minor_units(), 2500);
    auto report = runtime.ledger().reconcile(); ASSERT_TRUE(report);
    EXPECT_EQ(report->debits.minor_units(), report->credits.minor_units());
}

TEST(Stack3SaveReplay, NativeSocioeconomicStateRoundTripsWithoutSaveVersionBump) {
    socio::SocioeconomicRuntime runtime{99};
    ASSERT_TRUE(runtime.households().insert({civic::HouseholdId{7}, 3.0, civic::Money{1200}, civic::Money{10}, 1, {}, 0}));
    auto person = runtime.people().create({civic::HouseholdId{7}, 31, 4, 2, true, civic::Money{900}}); ASSERT_TRUE(person);
    const auto before = runtime.authoritative_hash();
    auto encoded = runtime.serialize_v9_extension(44); ASSERT_TRUE(encoded);
    EXPECT_NE(encoded->find("\"saveVersion\":9"), std::string::npos);
    socio::SocioeconomicRuntime restored{1};
    ASSERT_TRUE(restored.restore_v9_extension(*encoded));
    EXPECT_EQ(restored.authoritative_hash(), before);
}
