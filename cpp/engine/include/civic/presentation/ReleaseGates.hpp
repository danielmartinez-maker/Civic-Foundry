#pragma once

#include <algorithm>
#include <string>
#include <string_view>
#include <vector>

namespace civic::presentation {

struct CutoverEvidence {
    bool native_kernel_authority{};
    bool native_world_cadastre_urban_authority{};
    bool native_transport_authority{};
    bool native_personhood_authority{};
    bool native_economy_authority{};
    bool native_persistence_replay{};
    bool native_client_shipping{};
    bool no_typescript_authority{};
    bool deterministic_replay{};
    bool thread_hash_match{};
    bool large_city_performance_recorded{};
    bool retained_scene{};
    bool canonical_building_v2{};
    bool spatial_overlays{};
    bool accessibility{};
    bool robust_save{};
    bool long_horizon_soak{};
    bool reproducible_package{};
    bool visual_acceptance{};
};

struct CutoverReport {
    bool ready{};
    std::vector<std::string> blockers;

    [[nodiscard]] bool hasBlocker(std::string_view id) const {
        return std::ranges::find(blockers, id) != blockers.end();
    }
};

[[nodiscard]] inline CutoverReport evaluateCutover(const CutoverEvidence& evidence) {
    CutoverReport report{};
    const auto require = [&](bool accepted, const char* blocker) {
        if (!accepted) report.blockers.emplace_back(blocker);
    };

    require(evidence.native_kernel_authority, "native-kernel-authority");
    require(evidence.native_world_cadastre_urban_authority, "native-world-cadastre-urban-authority");
    require(evidence.native_transport_authority, "native-transport-authority");
    require(evidence.native_personhood_authority, "native-personhood-authority");
    require(evidence.native_economy_authority, "native-economy-authority");
    require(evidence.native_persistence_replay, "native-persistence-replay");
    require(evidence.native_client_shipping, "native-client-shipping");
    require(evidence.no_typescript_authority, "no-typescript-authority");
    require(evidence.deterministic_replay, "deterministic-replay");
    require(evidence.thread_hash_match, "thread-hash-match");
    require(evidence.large_city_performance_recorded, "large-city-performance-recorded");
    require(evidence.retained_scene, "retained-scene");
    require(evidence.canonical_building_v2, "canonical-building-v2");
    require(evidence.spatial_overlays, "spatial-overlays");
    require(evidence.accessibility, "native-accessibility");
    require(evidence.robust_save, "robust-native-save");
    require(evidence.long_horizon_soak, "long-horizon-soak");
    require(evidence.reproducible_package, "reproducible-native-package");
    require(evidence.visual_acceptance, "native-visual-acceptance");

    report.ready = report.blockers.empty();
    return report;
}

} // namespace civic::presentation
