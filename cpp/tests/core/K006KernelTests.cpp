#include <gtest/gtest.h>

#include <string>
#include <vector>

#include <civic/core/NativeEngine.hpp>

TEST(NativeKernelParity, FaultedKernelRejectsFurtherMutation) {
    auto created = civic::NativeEngine::create({77, 0, civic::SpeedMode::normal});
    ASSERT_TRUE(created);
    auto& engine = **created;

    ASSERT_TRUE(engine.registerSystem({
        "forced-failure",
        {1, 0},
        {},
        {},
        {},
        {"kernel"},
        0,
        [](std::uint64_t) -> civic::Result<void> {
            return std::unexpected(civic::make_error(
                civic::ErrorCode::invalid_state,
                "forced native kernel failure"
            ));
        },
    }));

    const auto failed = engine.step(1);
    ASSERT_FALSE(failed);
    EXPECT_EQ(failed.error().code, civic::ErrorCode::invalid_state);
    EXPECT_EQ(failed.error().message, "forced native kernel failure");
    EXPECT_EQ(engine.tick(), 0U);

    const std::vector<civic::CommandEnvelope> late{{1, 2, "late", {}}};
    const auto submitted = engine.submit(late);
    ASSERT_FALSE(submitted);
    EXPECT_EQ(submitted.error().code, civic::ErrorCode::invalid_state);
    EXPECT_NE(submitted.error().message.find("kernel is faulted"), std::string::npos);

    const auto zero = engine.step(0);
    ASSERT_FALSE(zero);
    EXPECT_EQ(zero.error().code, civic::ErrorCode::invalid_state);
    EXPECT_NE(zero.error().message.find("kernel is faulted"), std::string::npos);

    const auto registered = engine.registerSystem({
        "after-fault",
        {1, 0},
        {},
        {},
        {},
        {},
        0,
        [](std::uint64_t) -> civic::Result<void> { return {}; },
    });
    ASSERT_FALSE(registered);
    EXPECT_EQ(registered.error().code, civic::ErrorCode::invalid_state);
    EXPECT_NE(registered.error().message.find("kernel is faulted"), std::string::npos);
}

TEST(NativeKernelParity, DirtySchedulerCompilesBeforeStep) {
    auto created = civic::NativeEngine::create({88, 0, civic::SpeedMode::normal});
    ASSERT_TRUE(created);
    auto& engine = **created;

    ASSERT_TRUE(engine.registerSystem({
        "cycle-a",
        {1, 0},
        {"cycle-b"},
        {},
        {},
        {},
        0,
        [](std::uint64_t) -> civic::Result<void> { return {}; },
    }));
    ASSERT_TRUE(engine.registerSystem({
        "cycle-b",
        {1, 0},
        {"cycle-a"},
        {},
        {},
        {},
        0,
        [](std::uint64_t) -> civic::Result<void> { return {}; },
    }));

    const auto failed = engine.step(1);
    ASSERT_FALSE(failed);
    EXPECT_EQ(failed.error().code, civic::ErrorCode::invalid_state);
    EXPECT_EQ(engine.tick(), 0U);

    const std::vector<civic::CommandEnvelope> still_mutable{{1, 1, "after-compile-failure", {}}};
    EXPECT_TRUE(engine.submit(still_mutable));
}
