#pragma once

#include <civic/presentation/Presentation.hpp>

#include <expected>
#include <string>

namespace civic::presentation {

struct AudioMix {
    float traffic{};
    float freight{};
    float transit{};
    float construction{};
    float industrial{};
    float neighborhood{};
    float emergency{};
    float water_weather{};
    float music{};
};

class AudioPlanner {
public:
    [[nodiscard]] AudioMix plan(const FrameSnapshot& snapshot, const PresentationSettings& settings) const noexcept;
};

class IAudioBusOutput {
public:
    virtual ~IAudioBusOutput() = default;
    virtual std::expected<void, std::string> apply(const AudioMix& mix) = 0;
};

class NativeAudioRuntime final {
public:
    explicit NativeAudioRuntime(IAudioBusOutput& output) noexcept : output_(output) {}
    [[nodiscard]] std::expected<void, std::string> update(
        const FrameSnapshot& snapshot,
        const PresentationSettings& settings);
private:
    IAudioBusOutput& output_;
    AudioPlanner planner_{};
};

} // namespace civic::presentation
