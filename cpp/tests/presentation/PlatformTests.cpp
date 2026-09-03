#include <gtest/gtest.h>

#include <civic/presentation/Platform.hpp>

#ifdef _WIN32
#include <civic/presentation/D3D12Backend.hpp>
#include <civic/presentation/NativeWindow.hpp>
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#endif

using namespace civic::presentation;

TEST(PlatformEvents, QueuePreservesOrderAndDrainsExactlyOnce) {
    PlatformEventQueue queue{};
    queue.push({PlatformEventType::Resize, 1280, 720});
    queue.push({PlatformEventType::FocusLost});
    const auto events = queue.drain();
    ASSERT_EQ(events.size(), 2U);
    EXPECT_EQ(events[0].type, PlatformEventType::Resize);
    EXPECT_EQ(events[1].type, PlatformEventType::FocusLost);
    EXPECT_TRUE(queue.drain().empty());
}

TEST(FrameClock, RejectsNegativeAndCapsPathologicalDelta) {
    FrameClock clock{};
    clock.reset(1000);
    EXPECT_DOUBLE_EQ(clock.advance(900, 1000), 0.0);
    EXPECT_DOUBLE_EQ(clock.advance(6000, 1000), 0.25);
    EXPECT_NEAR(clock.advance(6016, 1000), 0.016, 1e-9);
}

#ifdef _WIN32
TEST(D3D12Backend, UninitializedFrameFailsExplicitly) {
    D3D12Backend backend{};
    EXPECT_FALSE(backend.beginFrame().has_value());
    EXPECT_FALSE(backend.deviceLostReason().empty());
}

namespace {
bool observeMessage(
    void* user_data,
    void*,
    std::uint32_t message,
    std::uintptr_t,
    std::intptr_t) noexcept {
    auto* observed = static_cast<std::uint32_t*>(user_data);
    if (observed) *observed = message;
    return true;
}
}

TEST(NativeWindow, RawMessageHookDoesNotSuppressCivicPlatformEvents) {
    NativeWindowConfig config{};
    config.visible = false;
    auto window = NativeWindow::create(config);
    ASSERT_TRUE(window.has_value()) << window.error();
    (void)(*window)->drainEvents();

    std::uint32_t observed = 0U;
    (*window)->setMessageHandler(&observeMessage, &observed);
    SendMessageW(
        static_cast<HWND>((*window)->nativeHandle()),
        WM_MOUSEMOVE,
        0,
        MAKELPARAM(12, 34));

    EXPECT_EQ(observed, static_cast<std::uint32_t>(WM_MOUSEMOVE));
    const auto events = (*window)->drainEvents();
    ASSERT_EQ(events.size(), 1U);
    EXPECT_EQ(events.front().type, PlatformEventType::PointerMove);
    EXPECT_DOUBLE_EQ(events.front().x, 12.0);
    EXPECT_DOUBLE_EQ(events.front().y, 34.0);
}
#endif
