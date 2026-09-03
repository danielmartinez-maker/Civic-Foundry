#include <civic/presentation/Platform.hpp>

#include <algorithm>

namespace civic::presentation {

double FrameClock::advance(std::int64_t counter, std::int64_t frequency) noexcept {
    if (frequency <= 0) return 0.0;
    if (!initialized_) { reset(counter); return 0.0; }
    const auto previous = last_counter_;
    last_counter_ = counter;
    if (counter <= previous) return 0.0;
    const double delta = static_cast<double>(counter - previous) / static_cast<double>(frequency);
    return std::clamp(delta, 0.0, 0.25);
}

} // namespace civic::presentation
