#include <gtest/gtest.h>

#include <civic/presentation/AssetRuntime.hpp>
#include <civic/presentation/Audio.hpp>
#include <civic/presentation/NativeUi.hpp>
#include <civic/presentation/PresentationIO.hpp>

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

TEST(SaveWorkflow, AtomicWriteLeavesNoTemporaryFileAndPreservesExactPayload) {
    const auto root = scratch("civic-foundry-native-save-test");
    SaveFileWorkflow saves{};
    const auto target = root / "city.cf9";
    ASSERT_TRUE(saves.writeAtomic(target, "save-v9-payload").has_value());
    EXPECT_FALSE(std::filesystem::exists(target.string() + ".tmp"));
    std::ifstream input(target, std::ios::binary);
    const std::string loaded((std::istreambuf_iterator<char>(input)), {});
    EXPECT_EQ(loaded, "save-v9-payload");
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
