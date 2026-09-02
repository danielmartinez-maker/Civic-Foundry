#include <gtest/gtest.h>

#include <civic/presentation/ReleaseGates.hpp>

using civic::presentation::CutoverEvidence;
using civic::presentation::evaluateCutover;

TEST(CutoverGate, DefaultEvidenceRejectsEveryRequiredAcceptanceFact) {
    const auto report = evaluateCutover(CutoverEvidence{});
    EXPECT_FALSE(report.ready);
    EXPECT_TRUE(report.hasBlocker("native-kernel-authority"));
    EXPECT_TRUE(report.hasBlocker("native-world-cadastre-urban-authority"));
    EXPECT_TRUE(report.hasBlocker("native-transport-authority"));
    EXPECT_TRUE(report.hasBlocker("native-personhood-authority"));
    EXPECT_TRUE(report.hasBlocker("native-economy-authority"));
    EXPECT_TRUE(report.hasBlocker("native-persistence-replay"));
    EXPECT_TRUE(report.hasBlocker("native-client-shipping"));
    EXPECT_TRUE(report.hasBlocker("no-typescript-authority"));
    EXPECT_TRUE(report.hasBlocker("deterministic-replay"));
    EXPECT_TRUE(report.hasBlocker("thread-hash-match"));
    EXPECT_TRUE(report.hasBlocker("large-city-performance-recorded"));
    EXPECT_TRUE(report.hasBlocker("retained-scene"));
    EXPECT_TRUE(report.hasBlocker("canonical-building-v2"));
    EXPECT_TRUE(report.hasBlocker("spatial-overlays"));
    EXPECT_TRUE(report.hasBlocker("native-accessibility"));
    EXPECT_TRUE(report.hasBlocker("robust-native-save"));
    EXPECT_TRUE(report.hasBlocker("long-horizon-soak"));
    EXPECT_TRUE(report.hasBlocker("reproducible-native-package"));
    EXPECT_TRUE(report.hasBlocker("native-visual-acceptance"));
}

TEST(CutoverGate, FullyAcceptedEvidenceIsReady) {
    CutoverEvidence evidence{};
    evidence.native_kernel_authority = true;
    evidence.native_world_cadastre_urban_authority = true;
    evidence.native_transport_authority = true;
    evidence.native_personhood_authority = true;
    evidence.native_economy_authority = true;
    evidence.native_persistence_replay = true;
    evidence.native_client_shipping = true;
    evidence.no_typescript_authority = true;
    evidence.deterministic_replay = true;
    evidence.thread_hash_match = true;
    evidence.large_city_performance_recorded = true;
    evidence.retained_scene = true;
    evidence.canonical_building_v2 = true;
    evidence.spatial_overlays = true;
    evidence.accessibility = true;
    evidence.robust_save = true;
    evidence.long_horizon_soak = true;
    evidence.reproducible_package = true;
    evidence.visual_acceptance = true;

    const auto report = evaluateCutover(evidence);
    EXPECT_TRUE(report.ready);
    EXPECT_TRUE(report.blockers.empty());
}

TEST(CutoverGate, OneMissingAuthorityFactKeepsFinalRetirementBlocked) {
    CutoverEvidence evidence{};
    evidence.native_kernel_authority = true;
    evidence.native_world_cadastre_urban_authority = true;
    evidence.native_transport_authority = false;
    evidence.native_personhood_authority = true;
    evidence.native_economy_authority = true;
    evidence.native_persistence_replay = true;
    evidence.native_client_shipping = true;
    evidence.no_typescript_authority = true;
    evidence.deterministic_replay = true;
    evidence.thread_hash_match = true;
    evidence.large_city_performance_recorded = true;
    evidence.retained_scene = true;
    evidence.canonical_building_v2 = true;
    evidence.spatial_overlays = true;
    evidence.accessibility = true;
    evidence.robust_save = true;
    evidence.long_horizon_soak = true;
    evidence.reproducible_package = true;
    evidence.visual_acceptance = true;

    const auto report = evaluateCutover(evidence);
    EXPECT_FALSE(report.ready);
    ASSERT_EQ(report.blockers.size(), 1U);
    EXPECT_EQ(report.blockers.front(), "native-transport-authority");
}
