#include <gtest/gtest.h>

#include <array>
#include <memory>
#include <string>
#include <vector>

#include <civic/core/NativeEngine.hpp>

namespace {

std::string minimal_save() {
    return R"({"saveVersion":9,"gameVersion":"0.9.0-urban-fabric","seed":7,"clock":{"tick":11,"speed":1},"terrain":{},"world":{},"urbanFabric":{"parcels":[],"lineage":[]},"zoningV2":{"parcelAssignments":[]},"buildingsV2":[],"propertyMarket":{"holdings":[],"transactions":[],"nextTransactionId":1},"unknownCompatibility":{"kept":true}})";
}

civic::CommandEnvelope transfer_command(
    std::uint64_t sequence,
    std::uint64_t tick,
    std::string gate) {
    return civic::CommandEnvelope{
        sequence,
        tick,
        "native.socioeconomic.transfer." + std::move(gate),
        {},
        civic::command_protocol_version,
    };
}

} // namespace

TEST(Stack3NativeEngine, TransfersSocioeconomicAuthorityInOrderAndClaimsAggregateEconomyOnlyWhenComplete) {
    auto created = civic::NativeEngine::create({91, 0, civic::SpeedMode::normal});
    ASSERT_TRUE(created);
    auto& engine = **created;

    auto economy = engine.domainHash("economy");
    ASSERT_TRUE(economy);
    EXPECT_EQ(economy->ownership, civic::DomainOwnership::unowned);

    auto inventory = engine.domainHash("economy.inventory_freight");
    ASSERT_TRUE(inventory);
    EXPECT_EQ(inventory->ownership, civic::DomainOwnership::unowned);

    const auto first = transfer_command(1, 1, "inventory_freight");
    ASSERT_TRUE(engine.submit(std::span<const civic::CommandEnvelope>{&first, 1}));
    ASSERT_TRUE(engine.step(1));

    inventory = engine.domainHash("economy.inventory_freight");
    ASSERT_TRUE(inventory);
    EXPECT_EQ(inventory->ownership, civic::DomainOwnership::owned);
    economy = engine.domainHash("economy");
    ASSERT_TRUE(economy);
    EXPECT_EQ(economy->ownership, civic::DomainOwnership::unowned);

    const std::array next{
        transfer_command(2, 2, "firms_production"),
        transfer_command(3, 2, "labor"),
    };
    ASSERT_TRUE(engine.submit(next));
    ASSERT_TRUE(engine.step(1));

    auto firms = engine.domainHash("economy.firms_production");
    auto labor = engine.domainHash("economy.labor");
    economy = engine.domainHash("economy");
    ASSERT_TRUE(firms && labor && economy);
    EXPECT_EQ(firms->ownership, civic::DomainOwnership::owned);
    EXPECT_EQ(labor->ownership, civic::DomainOwnership::owned);
    EXPECT_EQ(economy->ownership, civic::DomainOwnership::owned);
    EXPECT_NE(economy->value, 0U);
}

TEST(Stack3NativeEngine, RejectsOutOfOrderAuthorityTransferTransactionally) {
    auto created = civic::NativeEngine::create({92, 0, civic::SpeedMode::normal});
    ASSERT_TRUE(created);
    auto& engine = **created;

    const auto invalid = transfer_command(1, 1, "firms_production");
    ASSERT_TRUE(engine.submit(std::span<const civic::CommandEnvelope>{&invalid, 1}));
    auto stepped = engine.step(1);
    ASSERT_FALSE(stepped);
    EXPECT_EQ(engine.tick(), 0U);

    auto firms = engine.domainHash("economy.firms_production");
    ASSERT_TRUE(firms);
    EXPECT_EQ(firms->ownership, civic::DomainOwnership::unowned);
}

TEST(Stack3NativeEngine, SaveV9PreservesLegacyMaterializationUntilSocioeconomicCutover) {
    auto created = civic::NativeEngine::create({7, 0, civic::SpeedMode::normal});
    ASSERT_TRUE(created);
    auto& engine = **created;
    ASSERT_TRUE(engine.loadV9(minimal_save()));

    auto untouched = engine.saveV9();
    ASSERT_TRUE(untouched);
    EXPECT_EQ(untouched->find("\"nativeSocioeconomic\""), std::string::npos);
    EXPECT_NE(untouched->find("\"unknownCompatibility\""), std::string::npos);

    const auto transfer = transfer_command(1, 12, "inventory_freight");
    ASSERT_TRUE(engine.submit(std::span<const civic::CommandEnvelope>{&transfer, 1}));
    ASSERT_TRUE(engine.step(1));

    auto saved = engine.saveV9();
    ASSERT_TRUE(saved);
    EXPECT_NE(saved->find("\"nativeSocioeconomic\""), std::string::npos);
    EXPECT_NE(saved->find("\"unknownCompatibility\""), std::string::npos);

    auto second = civic::NativeEngine::create({1, 0, civic::SpeedMode::normal});
    ASSERT_TRUE(second);
    ASSERT_TRUE((*second)->loadV9(*saved));
    auto second_saved = (*second)->saveV9();
    ASSERT_TRUE(second_saved);
    EXPECT_EQ(*second_saved, *saved);
}

TEST(Stack3NativeEngine, SaveV9PreservesSocioeconomicAuthorityCutoverAndRevisions) {
    auto created = civic::NativeEngine::create({7, 0, civic::SpeedMode::normal});
    ASSERT_TRUE(created);
    auto& engine = **created;
    ASSERT_TRUE(engine.loadV9(minimal_save()));

    const std::array economy_transfers{
        transfer_command(1, 12, "inventory_freight"),
        transfer_command(2, 12, "firms_production"),
        transfer_command(3, 12, "labor"),
    };
    ASSERT_TRUE(engine.submit(economy_transfers));
    ASSERT_TRUE(engine.step(1));
    auto before = engine.domainHash("economy");
    ASSERT_TRUE(before);
    ASSERT_EQ(before->ownership, civic::DomainOwnership::owned);

    auto saved = engine.saveV9();
    ASSERT_TRUE(saved);
    EXPECT_NE(saved->find("\"authority\""), std::string::npos);

    auto restored = civic::NativeEngine::create({1, 0, civic::SpeedMode::normal});
    ASSERT_TRUE(restored);
    ASSERT_TRUE((*restored)->loadV9(*saved));
    auto after = (*restored)->domainHash("economy");
    ASSERT_TRUE(after);
    EXPECT_EQ(after->ownership, civic::DomainOwnership::owned);
    EXPECT_EQ(after->value, before->value);

    const auto next = transfer_command(1, 13, "households_housing");
    ASSERT_TRUE((*restored)->submit(std::span<const civic::CommandEnvelope>{&next, 1}));
    ASSERT_TRUE((*restored)->step(1));
    auto household_gate = (*restored)->domainHash("population.households_housing");
    ASSERT_TRUE(household_gate);
    EXPECT_EQ(household_gate->ownership, civic::DomainOwnership::owned);
}
