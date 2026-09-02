#pragma once

#include <civic/presentation/Presentation.hpp>

#include <string>
#include <vector>

namespace civic::presentation {

struct VisualAcceptanceScenario {
    std::string id;
    std::string description;
    FrameSnapshot snapshot;
    PresentationSettings settings{};
};

[[nodiscard]] std::vector<VisualAcceptanceScenario> nativeVisualAcceptanceScenarios();

} // namespace civic::presentation
