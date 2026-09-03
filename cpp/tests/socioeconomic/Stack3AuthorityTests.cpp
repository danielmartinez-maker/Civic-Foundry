#include <gtest/gtest.h>

#include <limits>
#include <string>
#include <vector>

#include <civic/socioeconomic/SocioeconomicAuthority.hpp>

namespace socio = civic::socioeconomic;

TEST(Stack3Authority, TransfersOnlyInDeclaredSubGateOrder) {
    socio::AuthorityTransferController authority;
    EXPECT_FALSE(authority.native_write_enabled(socio::SocioeconomicDomainGate::inventory_freight));
    EXPECT_FALSE(authority.transfer_to_native(socio::SocioeconomicDomainGate::firms_production));
    ASSERT_TRUE(authority.transfer_to_native(socio::SocioeconomicDomainGate::inventory_freight));
    EXPECT_TRUE(authority.native_write_enabled(socio::SocioeconomicDomainGate::inventory_freight));
    EXPECT_FALSE(authority.typescript_write_enabled(socio::SocioeconomicDomainGate::inventory_freight));
    ASSERT_TRUE(authority.transfer_to_native(socio::SocioeconomicDomainGate::firms_production));
    ASSERT_TRUE(authority.transfer_to_native(socio::SocioeconomicDomainGate::labor));
    ASSERT_TRUE(authority.transfer_to_native(socio::SocioeconomicDomainGate::households_housing));
    ASSERT_TRUE(authority.transfer_to_native(socio::SocioeconomicDomainGate::personhood_lifecycle));
    EXPECT_TRUE(authority.fully_native());
    EXPECT_FALSE(authority.transfer_to_native(socio::SocioeconomicDomainGate::personhood_lifecycle));
}

TEST(Stack3Authority, RejectsAnyDualWriterConfiguration) {
    socio::AuthorityTransferController authority;
    EXPECT_TRUE(authority.validate_single_writer(socio::SocioeconomicDomainGate::inventory_freight));
    ASSERT_TRUE(authority.transfer_to_native(socio::SocioeconomicDomainGate::inventory_freight));
    EXPECT_TRUE(authority.validate_single_writer(socio::SocioeconomicDomainGate::inventory_freight));
    EXPECT_FALSE(authority.validate_external_writer(socio::SocioeconomicDomainGate::inventory_freight, true));
    EXPECT_TRUE(authority.validate_external_writer(socio::SocioeconomicDomainGate::inventory_freight, false));
}

TEST(Stack3Authority, SupplierChoiceConsumesTypedNativeTransportQuotes) {
    const std::vector<socio::SupplierOffer> offers{
        {civic::FirmId{4}, 100, 2},
        {civic::FirmId{8}, 90, 4},
        {civic::FirmId{2}, 100, 2},
    };
    const auto provider = [](civic::FirmId supplier, std::uint64_t destination) -> civic::Result<socio::DeliveredCostQuote> {
        if (destination != 99) return std::unexpected(civic::make_error(civic::ErrorCode::invalid_argument, "unexpected destination"));
        const auto transport = supplier.value() == 8 ? 25 : 10;
        return socio::DeliveredCostQuote{transport, 3, 1, 12.5};
    };
    auto selected = socio::select_supplier_with_transport(offers, 99, provider); ASSERT_TRUE(selected);
    EXPECT_EQ(selected->supplier, civic::FirmId{2});
    EXPECT_EQ(selected->generalized_cost, 114);
}

TEST(Stack3Authority, RejectsNonFiniteTransportQuote) {
    const std::vector<socio::SupplierOffer> offers{{civic::FirmId{1}, 100, 1}};
    const auto provider = [](civic::FirmId, std::uint64_t) -> civic::Result<socio::DeliveredCostQuote> {
        return socio::DeliveredCostQuote{10, 0, 0, std::numeric_limits<double>::quiet_NaN()};
    };
    EXPECT_FALSE(socio::select_supplier_with_transport(offers, 1, provider));
}

TEST(Stack3Authority, PublishesImmutableRevisionedCompatibilitySnapshot) {
    socio::SocioeconomicAuthority authority{123};
    ASSERT_TRUE(authority.runtime().households().insert({civic::HouseholdId{1}, 2.0, civic::Money{100}, civic::Money{200}, 1, {}, 0}));
    authority.bump_revision(socio::SocioeconomicDomainGate::households_housing);
    auto first = authority.publish_snapshot(10); ASSERT_TRUE(first);
    auto held = authority.snapshots().latest(); ASSERT_TRUE(held);
    EXPECT_EQ(held->tick, 10U);
    EXPECT_EQ(held->domain_revisions.at("households_housing"), 1U);
    const auto held_payload = held->payload;

    ASSERT_TRUE(authority.runtime().households().insert({civic::HouseholdId{2}, 1.0, civic::Money{50}, civic::Money{50}, 0, {}, 0}));
    authority.bump_revision(socio::SocioeconomicDomainGate::households_housing);
    ASSERT_TRUE(authority.publish_snapshot(11));
    EXPECT_EQ(held->payload, held_payload);
    EXPECT_EQ(authority.snapshots().latest()->domain_revisions.at("households_housing"), 2U);
}

TEST(Stack3Authority, CommandJournalReplaysToSameAuthoritativeHash) {
    socio::SocioeconomicAuthority authority{77};
    ASSERT_TRUE(authority.apply({1, 5, socio::SocioeconomicCommandType::create_household, 7, 3, 1200}));
    ASSERT_TRUE(authority.apply({2, 6, socio::SocioeconomicCommandType::create_person, 7, 31, 900}));
    ASSERT_TRUE(authority.apply({3, 7, socio::SocioeconomicCommandType::create_person, 7, 9, 0}));
    const auto expected = authority.runtime().authoritative_hash();
    const auto journal = authority.journal();

    socio::SocioeconomicAuthority replayed{77};
    ASSERT_TRUE(replayed.replay(journal));
    EXPECT_EQ(replayed.runtime().authoritative_hash(), expected);
    EXPECT_EQ(replayed.journal().size(), 3U);
}

TEST(Stack3Authority, RejectsDuplicateOrOutOfOrderCommandSequences) {
    socio::SocioeconomicAuthority authority{1};
    ASSERT_TRUE(authority.apply({2, 0, socio::SocioeconomicCommandType::create_household, 1, 1, 0}));
    EXPECT_FALSE(authority.apply({2, 0, socio::SocioeconomicCommandType::create_household, 2, 1, 0}));
    EXPECT_FALSE(authority.apply({1, 0, socio::SocioeconomicCommandType::create_household, 2, 1, 0}));
}
