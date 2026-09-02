#pragma once

#include <civic/presentation/Presentation.hpp>

namespace civic::presentation {

struct AudioMix {
    float traffic{};
    float freight{};
    float transit{};
    float construction{};
    float emergency{};
    float water_weather{};
    float music{};
};

class AudioPlanner {
public:
    [[nodiscard]] AudioMix plan(const FrameSnapshot& snapshot, const PresentationSettings& settings) const noexcept;
};

} // namespace civic::presentation
