#pragma once

#include <cstdint>
#include <vector>

namespace civic::presentation {

enum class PlatformEventType : std::uint8_t {
    Close,
    Resize,
    FocusGained,
    FocusLost,
    PointerDown,
    PointerMove,
    PointerUp,
    PointerCancel,
    Wheel,
    KeyDown,
    KeyUp,
};

struct PlatformEvent {
    PlatformEventType type{PlatformEventType::Close};
    int data1{};
    int data2{};
    double x{};
    double y{};
    double wheel{};
};

class PlatformEventQueue {
public:
    void push(PlatformEvent event) { events_.push_back(event); }
    [[nodiscard]] std::vector<PlatformEvent> drain() { auto result = std::move(events_); events_.clear(); return result; }
private:
    std::vector<PlatformEvent> events_;
};

class FrameClock {
public:
    void reset(std::int64_t counter) noexcept { last_counter_ = counter; initialized_ = true; }
    [[nodiscard]] double advance(std::int64_t counter, std::int64_t frequency) noexcept;
private:
    std::int64_t last_counter_{};
    bool initialized_{false};
};

} // namespace civic::presentation
