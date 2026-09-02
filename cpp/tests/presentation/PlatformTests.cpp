#include <gtest/gtest.h>

#include <civic/presentation/Platform.hpp>

#ifdef _WIN32
#include <civic/presentation/D3D12Backend.hpp>
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
#endif
