#include <civic/presentation/VisualReference.hpp>

#include <algorithm>
#include <cmath>
#include <iomanip>
#include <locale>
#include <sstream>

namespace civic::presentation {
namespace {

std::string escapeXml(std::string_view text) {
    std::string escaped;
    escaped.reserve(text.size());
    for (const char ch : text) {
        switch (ch) {
            case '&': escaped += "&amp;"; break;
            case '<': escaped += "&lt;"; break;
            case '>': escaped += "&gt;"; break;
            case '"': escaped += "&quot;"; break;
            case '\'': escaped += "&apos;"; break;
            default: escaped += ch; break;
        }
    }
    return escaped;
}

int colorByte(float value) noexcept {
    return static_cast<int>(std::lround(std::clamp(value, 0.0F, 1.0F) * 255.0F));
}

double pixelX(const SceneVertex& vertex, PixelViewport viewport) noexcept {
    return (static_cast<double>(vertex.x) + 1.0) * 0.5 * static_cast<double>(viewport.width);
}

double pixelY(const SceneVertex& vertex, PixelViewport viewport) noexcept {
    return (1.0 - static_cast<double>(vertex.y)) * 0.5 * static_cast<double>(viewport.height);
}

void appendTriangles(
    std::ostringstream& out,
    const std::vector<SceneVertex>& vertices,
    PixelViewport viewport,
    std::string_view group_id) {
    out << "<g id=\"" << group_id << "\">\n";
    for (std::size_t index = 0; index + 2 < vertices.size(); index += 3) {
        const auto& a = vertices[index];
        const auto& b = vertices[index + 1];
        const auto& c = vertices[index + 2];
        const float alpha = std::clamp((a.a + b.a + c.a) / 3.0F, 0.0F, 1.0F);
        out << "<polygon points=\""
            << pixelX(a, viewport) << ',' << pixelY(a, viewport) << ' '
            << pixelX(b, viewport) << ',' << pixelY(b, viewport) << ' '
            << pixelX(c, viewport) << ',' << pixelY(c, viewport)
            << "\" fill=\"rgb(" << colorByte((a.r + b.r + c.r) / 3.0F) << ' '
            << colorByte((a.g + b.g + c.g) / 3.0F) << ' '
            << colorByte((a.b + b.b + c.b) / 3.0F) << ")\" fill-opacity=\""
            << alpha << "\"/>\n";
    }
    out << "</g>\n";
}

} // namespace

std::string sceneGeometryToSvg(
    const SceneGeometry& geometry,
    PixelViewport viewport,
    std::string_view scenario_id,
    std::string_view description,
    const MiniatureTreatment& treatment) {
    const auto width = std::max<std::uint32_t>(1U, viewport.width);
    const auto height = std::max<std::uint32_t>(1U, viewport.height);
    viewport = {width, height};

    std::ostringstream out;
    out.imbue(std::locale::classic());
    out << std::fixed << std::setprecision(3);
    out << "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"" << width
        << "\" height=\"" << height << "\" viewBox=\"0 0 " << width << ' ' << height
        << "\" data-scenario=\"" << escapeXml(scenario_id)
        << "\" data-revision=\"" << geometry.revision
        << "\" data-geometry-key=\"" << geometry.geometry_key
        << "\" data-miniature=\"" << (treatment.enabled ? "true" : "false")
        << "\" data-miniature-blur-radius=\"" << treatment.blur_radius_px
        << "\" data-miniature-focus-center=\"" << treatment.focus_center
        << "\" data-miniature-focus-width=\"" << treatment.focus_width << "\">\n";
    out << "<title>" << escapeXml(scenario_id) << "</title>\n";
    out << "<desc>" << escapeXml(description) << "</desc>\n";
    out << "<rect width=\"100%\" height=\"100%\" fill=\"rgb(17 23 27)\"/>\n";
    appendTriangles(out, geometry.opaque, viewport, "opaque-scene");
    appendTriangles(out, geometry.overlay, viewport, "overlay-scene");
    out << "</svg>\n";
    return out.str();
}

} // namespace civic::presentation
