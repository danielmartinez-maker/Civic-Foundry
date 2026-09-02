#include <civic/presentation/MiniaturePresentation.hpp>
#include <civic/presentation/RenderPipeline.hpp>
#include <civic/presentation/SceneGeometry.hpp>
#include <civic/presentation/VisualAcceptance.hpp>
#include <civic/presentation/VisualReference.hpp>

#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>

using namespace civic::presentation;

namespace {

bool writeTextFile(const std::filesystem::path& path, const std::string& text) {
    std::ofstream output(path, std::ios::binary | std::ios::trunc);
    if (!output) return false;
    output.write(text.data(), static_cast<std::streamsize>(text.size()));
    output.flush();
    return output.good();
}

} // namespace

int main(int argc, char** argv) {
    const auto output_root = argc > 1 ? std::filesystem::path(argv[1]) : std::filesystem::path("native-visual-reference");
    std::error_code ec;
    std::filesystem::create_directories(output_root, ec);
    if (ec) {
        std::cerr << "failed to create visual-reference directory: " << ec.message() << '\n';
        return 2;
    }

    RenderPacketBuilder packet_builder{};
    SceneGeometryBuilder geometry_builder{};
    IsometricCamera camera{};
    constexpr PixelViewport viewport{1280U, 720U};

    std::string index = "<!doctype html><meta charset=\"utf-8\"><title>Civic Foundry native visual references</title>"
                        "<style>body{font-family:system-ui;background:#11171b;color:#eef2f4;margin:24px}"
                        "figure{margin:0 0 32px}img{max-width:100%;border:1px solid #52616b;background:#11171b}" 
                        "figcaption{margin:8px 0 0}</style><h1>Civic Foundry native visual references</h1>";

    std::size_t count = 0;
    for (const auto& scenario : nativeVisualAcceptanceScenarios()) {
        const auto packet = packet_builder.build(
            scenario.snapshot,
            {0.0, 0.0, static_cast<double>(scenario.snapshot.world.width), static_cast<double>(scenario.snapshot.world.height)});
        const auto geometry = geometry_builder.build(packet, camera, scenario.snapshot.world, viewport);
        const auto treatment = deriveMiniatureTreatment(scenario.settings, viewport);
        const auto svg = sceneGeometryToSvg(geometry, viewport, scenario.id, scenario.description, treatment);
        const auto filename = scenario.id + ".svg";
        if (!writeTextFile(output_root / filename, svg)) {
            std::cerr << "failed to write visual reference: " << filename << '\n';
            return 3;
        }
        index += "<figure><img src=\"" + filename + "\" alt=\"" + scenario.id +
                 "\"><figcaption><strong>" + scenario.id + "</strong> — " + scenario.description + "</figcaption></figure>";
        ++count;
    }
    index += "<p>Generated from the same retained SceneGeometry records consumed by the native renderer.</p>";
    if (!writeTextFile(output_root / "index.html", index)) {
        std::cerr << "failed to write visual-reference index\n";
        return 4;
    }

    std::cout << "{\"nativeVisualReferences\":" << count << ",\"viewport\":\"1280x720\"}\n";
    return count == 10U ? 0 : 5;
}
