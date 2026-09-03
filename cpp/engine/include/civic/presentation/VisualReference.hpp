#pragma once

#include <civic/presentation/MiniaturePresentation.hpp>
#include <civic/presentation/SceneGeometry.hpp>

#include <string>
#include <string_view>

namespace civic::presentation {

[[nodiscard]] std::string sceneGeometryToSvg(
    const SceneGeometry& geometry,
    PixelViewport viewport,
    std::string_view scenario_id,
    std::string_view description,
    const MiniatureTreatment& treatment);

} // namespace civic::presentation
