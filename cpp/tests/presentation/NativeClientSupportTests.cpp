#include <gtest/gtest.h>

#include <civic/presentation/AssetRuntime.hpp>
#include <civic/presentation/Audio.hpp>
#include <civic/presentation/NativeHud.hpp>
#include <civic/presentation/NativePanels.hpp>
#include <civic/presentation/NativeUi.hpp>
#include <civic/presentation/PresentationIO.hpp>
#include <civic/presentation/ReleaseGates.hpp>

#include <array>
#include <cstddef>
#include <filesystem>
#include <fstream>
#include <string>
#include <variant>

using namespace civic::presentation;

namespace {
std::filesystem::path scratch(const char* name) {
    auto path = std::filesystem::temp_directory_path() / name;
    std::error_code ec;
    std::filesystem::remove_all(path, ec);
    std::filesystem::create_directories(path, ec);
    return path;
}
std::vector<std::byte> tinyGlb() {
    const std::string json = R"({"asset":{"version":"2.0"},"buffers":[{"byteLength":36}],"bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":36}],"accessors":[{"bufferView":0,"componentType":5126,"count":3,"type":"VEC3"}],"meshes":[{"primitives":[{"attributes":{"POSITION":0},"material":0}]}],"materials":[{}],"textures":[{}]})";
    std::string padded = json;
    while (padded.size() % 4 != 0) padded.push_back(' ');
    constexpr std::uint32_t binary_size = 36U;
    const std::uint32_t total = static_cast<std::uint32_t>(12U + 8U + padded.size() + 8U + binary_size);
    std::vector<std::byte> bytes(total);
    auto put32 = [&](std::size_t offset, std::uint32_t value) {
        bytes[offset] = static_cast<std::byte>(value & 0xffU);
        bytes[offset + 1] = static_cast<std::byte>((value >> 8U) & 0xffU);
        bytes[offset + 2] = static_cast<std::byte>((value >> 16U) & 0xffU);
        bytes[offset + 3] = static_cast<std::byte>((value >> 24U) & 0xffU);
    };
    put32(0, 0x46546c67U); put32(4, 2U); put32(8, total);
    put32(12, static_cast<std::uint32_t>(padded.size())); put32(16, 0x4e4f534aU);
    for (std::size_t i = 0; i < padded.size(); ++i) bytes[20 + i] = static_cast<std::byte>(static_cast<unsigned char>(padded[i]));
    const auto bin_header = 20U + padded.size();
    put32(bin_header, binary_size);
    put32(bin_header + 4U, 0x004e4942U);
    return bytes;
}
struct Sink final : ICommandSink {
    std::vector<AuthoritativeCommand> submitted;
    std::expected<void, std::string> submit(const AuthoritativeCommand& command) override { submitted.push_back(command); return {}; }
};
struct RecordingAudioOutput final : IAudioBusOutput {
    int apply_count{};
    AudioMix last{};
    std::expected<void, std::string> apply(const AudioMix& mix) override {
        ++apply_count;
        last = mix;
        return {};
    }
};
std::string readText(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    return std::string((std::istreambuf_iterator<char>(input)), {});
}
CutoverEvidence acceptedCutoverEvidence() {
    return CutoverEvidence{
        .native_kernel_authority = true,
        .native_world_cadastre_urban_authority = true,
        .native_transport_authority = true,
        .native_personhood_authority = true,
        .native_economy_authority = true,
        .native_persistence_replay = true,
        .native_client_shipping = true,
        .no_typescript_authority = true,
        .deterministic_replay = true,
        .thread_hash_match = true,
        .large_city_performance_recorded = true,
        .retained_scene = true,
        .canonical_building_v2 = true,
        .spatial_overlays = true,
        .accessibility = true,
        .robust_save = true,
        .long_horizon_soak = true,
        .reproducible_package = true,
        .visual_acceptance = true,
    };
}
}

TEST(SettingsPersistence, RoundTripsMachinePreferencesOutsideCitySave) {
    const auto root = scratch("civic-foundry-native-settings-test");
    SettingsStore store(root / "settings.json");
    PresentationSettings settings{};
    settings.ui_scale = 1.35F; settings.reduced_motion = true; settings.master_volume = 0.42F;
    ASSERT_TRUE(store.save(settings).has_value());
    const auto loaded = store.load();
    ASSERT_TRUE(loaded.has_value());
    EXPECT_FLOAT_EQ(loaded->ui_scale, 1.35F);
    EXPECT_TRUE(loaded->reduced_motion);
    EXPECT_FLOAT_EQ(loaded->master_volume, 0.42F);
}

TEST(SettingsPersistence, RoundTripsAccessibilityPolicyAndCustomKeyBindings) {
    const auto root = scratch("civic-foundry-native-settings-accessibility-test");
    SettingsStore store(root / "settings.json");
    PresentationSettings settings{};
    settings.high_contrast = true;
    settings.minimum_alert_severity = AlertSeverity::Warning;
    settings.keybindings.inspect = 0x51;
    settings.keybindings.speed_very_fast = 0x57;

    ASSERT_TRUE(store.save(settings).has_value());
    const auto loaded = store.load();
    ASSERT_TRUE(loaded.has_value()) << loaded.error();
    EXPECT_TRUE(loaded->high_contrast);
    EXPECT_EQ(loaded->minimum_alert_severity, AlertSeverity::Warning);
    EXPECT_EQ(loaded->keybindings.inspect, 0x51);
    EXPECT_EQ(loaded->keybindings.speed_very_fast, 0x57);
    EXPECT_EQ(resolveHudShortcut(0x51, {}, loaded->keybindings), HudShortcutAction::InspectTool);
}

TEST(SettingsPersistence, OlderSettingsWithoutVisualEffectsFlagRemainLoadable) {
    const auto root = scratch("civic-foundry-native-settings-legacy-test");
    const auto path = root / "settings.json";
    std::ofstream output(path, std::ios::binary);
    output << R"({
      "masterVolume":1.0,
      "musicVolume":0.8,
      "uiScale":1.0,
      "cameraSensitivity":1.0,
      "cameraSmoothing":0.35,
      "tiltShiftStrength":0.55,
      "inputSensitivity":1.0,
      "reducedMotion":false,
      "colorIndependentCues":true
    })";
    output.close();

    SettingsStore store(path);
    const auto loaded = store.load();
    ASSERT_TRUE(loaded.has_value()) << loaded.error();
    EXPECT_TRUE(loaded->visual_effects);
    EXPECT_FALSE(loaded->high_contrast);
    EXPECT_EQ(loaded->minimum_alert_severity, AlertSeverity::Info);
    EXPECT_FLOAT_EQ(loaded->tilt_shift_strength, 0.55F);
}

TEST(SaveWorkflow, AtomicWriteLeavesNoTemporaryFileAndPreservesExactPayload) {
    const auto root = scratch("civic-foundry-native-save-test");
    SaveFileWorkflow saves{};
    const auto target = root / "city.cf9";
    ASSERT_TRUE(saves.writeAtomic(target, "save-v9-payload").has_value());
    EXPECT_FALSE(std::filesystem::exists(target.string() + ".tmp"));
    EXPECT_EQ(readText(target), "save-v9-payload");
}

TEST(SaveWorkflow, ReplacementKeepsLastKnownGoodBackupAndValidatedLoadCanRecoverIt) {
    const auto root = scratch("civic-foundry-native-save-backup-test");
    SaveFileWorkflow saves{};
    const auto target = root / "city.cf9";
    ASSERT_TRUE(saves.writeAtomic(target, "good-v9-a").has_value());
    ASSERT_TRUE(saves.writeAtomic(target, "good-v9-b").has_value());

    auto backup = target;
    backup += ".bak";
    ASSERT_TRUE(std::filesystem::exists(backup));
    EXPECT_EQ(readText(backup), "good-v9-a");

    std::ofstream corrupt(target, std::ios::binary | std::ios::trunc);
    corrupt << "corrupt";
    corrupt.close();

    const auto recovered = saves.readValidated(target, [](std::string_view payload) {
        return payload.starts_with("good-v9-");
    });
    ASSERT_TRUE(recovered.has_value()) << recovered.error();
    EXPECT_TRUE(recovered->used_backup);
    EXPECT_EQ(recovered->payload, "good-v9-a");
}

TEST(GlbRuntime, ParsesSupportedContainerAndCountsRuntimeResources) {
    GlbLoader loader{};
    const auto asset = loader.load(tinyGlb(), "fixture.glb");
    ASSERT_TRUE(asset.has_value()) << asset.error();
    EXPECT_EQ(asset->primitive_count, 1U);
    EXPECT_EQ(asset->material_count, 1U);
    EXPECT_EQ(asset->texture_count, 1U);
    EXPECT_FALSE(asset->diagnostic_placeholder);
}

TEST(GlbRuntime, BrokenAssetProducesExplicitDiagnosticPlaceholder) {
    GlbLoader loader{};
    const std::array<std::byte, 4> broken{};
    const auto asset = loader.loadOrPlaceholder(broken, "broken.glb");
    EXPECT_TRUE(asset.diagnostic_placeholder);
    EXPECT_FALSE(asset.diagnostic_message.empty());
}

TEST(NativeUi, MutationsLeaveUiAsTypedCommandsOnly) {
    Sink sink{};
    NativeUiController ui(sink);
    ASSERT_TRUE(ui.buildRoad({{1.0,1.0},{4.0,1.0}}, RoadClass::Collector).has_value());
    ASSERT_TRUE(ui.zoneParcel("parcel:7", "MX-3").has_value());
    ASSERT_EQ(sink.submitted.size(), 2U);
    EXPECT_TRUE(std::holds_alternative<BuildRoadCommand>(sink.submitted[0]));
    EXPECT_TRUE(std::holds_alternative<ZoneParcelCommand>(sink.submitted[1]));
}

TEST(NativeUi, SimulationSpeedAcceptsOnlyAuthoritativeClockModes) {
    Sink sink{};
    NativeUiController ui(sink);
    for (const int speed : {0, 1, 2, 4}) {
        ASSERT_TRUE(ui.setSimulationSpeed(speed).has_value());
    }
    const auto before_invalid = sink.submitted.size();
    EXPECT_FALSE(ui.setSimulationSpeed(3).has_value());
    EXPECT_EQ(sink.submitted.size(), before_invalid);
}

TEST(AudioPlanner, DerivesAmbienceOnlyFromSnapshotState) {
    FrameSnapshot snapshot{};
    snapshot.roads.push_back({"r", 1, RoadClass::Arterial, {0,0}, {2,0}, 2, false, 1.0F, 0.5F, 0.7F, 600.0F});
    snapshot.vehicles.push_back({"freight", 1, VehicleKind::Freight, {1,0}, 0.0F, 1.0F, false});
    snapshot.buildings.push_back({"construction", 1, "p", {{0,0},{1,0},{1,1}}, 2, 7.0F, {}, 1.0F, 0.4F});
    AudioPlanner planner{};
    const auto mix = planner.plan(snapshot, PresentationSettings{});
    EXPECT_GT(mix.traffic, 0.0F);
    EXPECT_GT(mix.freight, 0.0F);
    EXPECT_GT(mix.construction, 0.0F);
}

TEST(NativeAudioRuntime, AppliesSnapshotDerivedIndustrialNeighborhoodAndMobilityBuses) {
    FrameSnapshot snapshot{};
    snapshot.roads.push_back({"r", 1, RoadClass::Arterial, {0,0}, {2,0}, 2, false, 1.0F, 0.5F, 0.7F, 600.0F});
    snapshot.vehicles.push_back({"freight", 1, VehicleKind::Freight, {1,0}, 0.0F, 1.0F, false});
    snapshot.buildings.push_back({"industrial", 1, "p1", {{0,0},{1,0},{1,1}}, 2, 7.0F, {{BuildingUse::Industrial, 1.0F}}, 1.0F, 1.0F});
    snapshot.buildings.push_back({"home", 1, "p2", {{2,0},{3,0},{3,1}}, 2, 7.0F, {{BuildingUse::Residential, 1.0F}}, 1.0F, 1.0F});

    RecordingAudioOutput output{};
    NativeAudioRuntime runtime(output);
    ASSERT_TRUE(runtime.update(snapshot, PresentationSettings{}).has_value());
    EXPECT_EQ(output.apply_count, 1);
    EXPECT_GT(output.last.traffic, 0.0F);
    EXPECT_GT(output.last.freight, 0.0F);
    EXPECT_GT(output.last.industrial, 0.0F);
    EXPECT_GT(output.last.neighborhood, 0.0F);
}

TEST(NativePanels, CarriesInspectorTrendHistoryAndCausalContributorsWithoutAuthorityMutation) {
    NativePanelSnapshot panels{};
    panels.inspector = InspectorSnapshot{
        .entity = {EntityKind::Parcel, "parcel:7"},
        .title = "Parcel parcel:7",
        .fields = {{"Area", "640.0 m2"}, {"District", "MX-3"}},
    };
    panels.management.push_back(ManagementPanelSnapshot{
        .id = "economy-housing",
        .title = "Economy & Housing",
        .fields = {{"Active firms", "18"}},
        .diagnostics = {{
            .id = "freight-delay",
            .label = "Freight delay",
            .current_value = 6.0,
            .previous_value = 4.0,
            .unit = "ticks",
            .history = {{100, 3.0}, {200, 4.0}, {300, 6.0}},
            .contributors = {{"Congestion", 1.4, "arterial queueing"}, {"Incidents", 0.6, "blocked movement"}},
        }},
    });

    ASSERT_TRUE(panels.inspector.has_value());
    EXPECT_EQ(panels.inspector->entity.id, "parcel:7");
    const auto* economy = findManagementPanel(panels, "economy-housing");
    ASSERT_NE(economy, nullptr);
    ASSERT_EQ(economy->diagnostics.size(), 1U);
    EXPECT_EQ(classifyTrend(economy->diagnostics.front()), TrendDirection::Up);
    EXPECT_EQ(economy->diagnostics.front().contributors.front().label, "Congestion");
}

TEST(CutoverAuthority, RequiresEveryAlphaGameplayDomainToBeOwned) {
    std::array<DomainAuthorityEvidence, 7> domains{{
        {"world", true},
        {"cadastre", true},
        {"buildings", true},
        {"transportation", true},
        {"population", true},
        {"economy", true},
        {"services", true},
    }};
    EXPECT_TRUE(alphaGameplayAuthorityReady(domains));
    domains[3].owned = false;
    EXPECT_FALSE(alphaGameplayAuthorityReady(domains));
}

TEST(CutoverAuthority, RejectsMissingOrDuplicateDomainEvidence) {
    const std::array<DomainAuthorityEvidence, 6> missing{{
        {"world", true}, {"cadastre", true}, {"buildings", true},
        {"transportation", true}, {"population", true}, {"economy", true},
    }};
    EXPECT_FALSE(alphaGameplayAuthorityReady(missing));

    const std::array<DomainAuthorityEvidence, 7> duplicate{{
        {"world", true}, {"cadastre", true}, {"buildings", true},
        {"transportation", true}, {"population", true}, {"economy", true},
        {"economy", true},
    }};
    EXPECT_FALSE(alphaGameplayAuthorityReady(duplicate));
}

TEST(CutoverGate, BlocksLegacyRetirementWhenAnyRequiredEvidenceIsMissing) {
    auto evidence = acceptedCutoverEvidence();
    evidence.native_world_cadastre_urban_authority = false;
    evidence.visual_acceptance = false;

    const auto report = evaluateCutover(evidence);
    EXPECT_FALSE(report.ready);
    EXPECT_TRUE(report.hasBlocker("native-world-cadastre-urban-authority"));
    EXPECT_TRUE(report.hasBlocker("native-visual-acceptance"));
}

TEST(CutoverGate, AllowsRetirementOnlyWhenEveryStack4AcceptanceFactIsTrue) {
    const auto report = evaluateCutover(acceptedCutoverEvidence());
    EXPECT_TRUE(report.ready);
    EXPECT_TRUE(report.blockers.empty());
}
