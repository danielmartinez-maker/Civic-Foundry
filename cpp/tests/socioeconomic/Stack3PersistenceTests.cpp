#include <gtest/gtest.h>

#include <vector>

#include <civic/socioeconomic/SocioeconomicPersistence.hpp>

namespace socio = civic::socioeconomic;

TEST(Stack3Persistence, RoundTripsAllAuthoritativeSocioeconomicStores) {
    socio::SocioeconomicRuntime runtime{321};

    socio::Firm firm{};
    firm.id = civic::FirmId{5};
    firm.sector = socio::SectorRuntimeId{2};
    firm.location = civic::BuildingId{8};
    firm.employment = 7.0;
    firm.cash = civic::Money{50000};
    firm.debt = civic::Money{12000};
    ASSERT_TRUE(runtime.firms().insert(firm));

    ASSERT_TRUE(runtime.inventories().create(socio::InventoryId{1}, socio::ProductRuntimeId{1}, 20, 100));
    ASSERT_TRUE(runtime.inventories().create(socio::InventoryId{2}, socio::ProductRuntimeId{1}, 4, 10));
    auto order = socio::reserve_freight_order(runtime.freight(), runtime.inventories(), {socio::InventoryId{1}, socio::InventoryId{2}, socio::ProductRuntimeId{1}, 8});
    ASSERT_TRUE(order);
    auto delivery = runtime.freight().deliver(*order, 8, runtime.inventories()); ASSERT_TRUE(delivery);
    EXPECT_EQ(delivery->delivered, 6);
    EXPECT_EQ(delivery->still_active, 2);

    ASSERT_TRUE(runtime.households().insert({civic::HouseholdId{7}, 2.0, civic::Money{1400}, civic::Money{9000}, 1, {}, 1, civic::Money{400}}));
    socio::PersonInput person_input{civic::HouseholdId{7}, 42, 5, 3, true, civic::Money{1400}};
    person_input.resident = true;
    person_input.life_stage = socio::PersonLifeStage::adult;
    person_input.provenance = socio::PersonHistoryProvenance::imported_fact;
    person_input.home_entity = civic::EntityId{80};
    person_input.location = socio::PersonLocation{socio::PersonLocationKind::building, civic::EntityId{81}};
    auto person = runtime.people().create(person_input); ASSERT_TRUE(person);
    ASSERT_TRUE(runtime.ledger().transfer(socio::AccountId{1}, socio::AccountId{2}, civic::Money{1400}, 18, socio::LedgerReason::payroll, civic::EntityId{5}));

    const auto expected_hash = runtime.authoritative_hash();
    auto encoded = socio::SocioeconomicPersistence::serialize_v9_extension(runtime, 18); ASSERT_TRUE(encoded);
    auto restored = socio::SocioeconomicPersistence::restore_v9_extension(*encoded); ASSERT_TRUE(restored);

    EXPECT_EQ(restored->authoritative_hash(), expected_hash);
    EXPECT_EQ(restored->firms().next_id(), civic::FirmId{6});
    EXPECT_EQ(restored->inventories().quantity(socio::InventoryId{1}), 12);
    EXPECT_EQ(restored->inventories().quantity(socio::InventoryId{2}), 10);
    auto restored_order = restored->freight().get(*order); ASSERT_TRUE(restored_order);
    EXPECT_EQ(restored_order->delivered, 6);
    EXPECT_EQ(restored_order->active, 2);
    auto restored_person = restored->people().get(*person); ASSERT_TRUE(restored_person);
    EXPECT_TRUE(restored_person->resident);
    EXPECT_EQ(restored_person->life_stage, socio::PersonLifeStage::adult);
    EXPECT_EQ(restored_person->provenance, socio::PersonHistoryProvenance::imported_fact);
    EXPECT_EQ(restored_person->home_entity, civic::EntityId{80});
    ASSERT_TRUE(restored_person->location);
    EXPECT_EQ(restored_person->location->kind, socio::PersonLocationKind::building);
    EXPECT_EQ(restored_person->location->entity, civic::EntityId{81});
    auto reconciliation = restored->ledger().reconcile(); ASSERT_TRUE(reconciliation);
    EXPECT_EQ(reconciliation->entry_count, 1U);
}

TEST(Stack3Persistence, FullRoundTripPreservesPersonAllocatorAfterHighestIdDeletion) {
    socio::SocioeconomicRuntime runtime{654};
    ASSERT_TRUE(runtime.households().insert({civic::HouseholdId{1}, 1.0, civic::Money{0}, civic::Money{0}, 0, {}, 0, civic::Money{0}}));

    auto first = runtime.people().create({civic::HouseholdId{1}, 20, 1, 1, false, civic::Money{0}}); ASSERT_TRUE(first);
    auto second = runtime.people().create({civic::HouseholdId{1}, 21, 1, 1, false, civic::Money{0}}); ASSERT_TRUE(second);
    auto third = runtime.people().create({civic::HouseholdId{1}, 22, 1, 1, false, civic::Money{0}}); ASSERT_TRUE(third);
    ASSERT_TRUE(runtime.people().erase(*third));
    ASSERT_EQ(runtime.people().next_id(), socio::PersonId{4});

    auto encoded = socio::SocioeconomicPersistence::serialize_v9_extension(runtime, 3); ASSERT_TRUE(encoded);
    auto restored = socio::SocioeconomicPersistence::restore_v9_extension(*encoded); ASSERT_TRUE(restored);
    EXPECT_FALSE(restored->people().get(*third));
    EXPECT_EQ(restored->people().next_id(), socio::PersonId{4});
    auto fourth = restored->people().create({civic::HouseholdId{1}, 23, 1, 1, false, civic::Money{0}}); ASSERT_TRUE(fourth);
    EXPECT_EQ(*fourth, socio::PersonId{4});
}

TEST(Stack3FreightReservation, MovingCargoOutOfSourceAndBackIsConserved) {
    socio::InventoryStore inventories;
    ASSERT_TRUE(inventories.create(socio::InventoryId{1}, socio::ProductRuntimeId{1}, 10, 10));
    ASSERT_TRUE(inventories.create(socio::InventoryId{2}, socio::ProductRuntimeId{1}, 0, 10));
    socio::FreightOrderStore freight;

    auto order = socio::reserve_freight_order(freight, inventories, {socio::InventoryId{1}, socio::InventoryId{2}, socio::ProductRuntimeId{1}, 6}); ASSERT_TRUE(order);
    EXPECT_EQ(inventories.quantity(socio::InventoryId{1}), 4);
    ASSERT_TRUE(freight.cancel(*order, inventories));
    EXPECT_EQ(inventories.quantity(socio::InventoryId{1}), 10);
    auto invariant = freight.conservation(*order); ASSERT_TRUE(invariant);
    EXPECT_TRUE(invariant->balanced);
}

TEST(Stack3PersonRestore, PreservesStableIdsAllocatorAndSparseStateAcrossTombstones) {
    socio::PersonRegistry people;
    socio::PersonInput first_input{civic::HouseholdId{1}, 20, 1, 1, false, civic::Money{0}};
    first_input.resident = true;
    first_input.life_stage = socio::PersonLifeStage::teen;
    first_input.provenance = socio::PersonHistoryProvenance::bootstrap_background;
    first_input.home_entity = civic::EntityId{40};
    first_input.location = socio::PersonLocation{socio::PersonLocationKind::network, civic::EntityId{41}};
    auto first = people.create(first_input); ASSERT_TRUE(first);
    auto second = people.create({civic::HouseholdId{1}, 30, 2, 2, true, civic::Money{100}}); ASSERT_TRUE(second);
    ASSERT_TRUE(people.erase(*first));
    const auto snapshot = people.snapshot();
    ASSERT_EQ(snapshot.size(), 1U);

    socio::PersonRegistry restored;
    ASSERT_TRUE(socio::restore_person_registry(restored, snapshot, socio::PersonId{3}));
    EXPECT_FALSE(restored.get(*first));
    EXPECT_TRUE(restored.get(*second));
    auto third = restored.create({civic::HouseholdId{1}, 40, 3, 3, true, civic::Money{200}}); ASSERT_TRUE(third);
    EXPECT_EQ(*third, socio::PersonId{3});
    auto third_view = restored.get(*third); ASSERT_TRUE(third_view);
    EXPECT_FALSE(third_view->home_entity);
    EXPECT_FALSE(third_view->location);
}
