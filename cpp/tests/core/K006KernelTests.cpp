#include <gtest/gtest.h>

#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

#include <civic/core/NativeEngine.hpp>

namespace civic {
struct NativeEngineTestAccess final {
    static CommandQueueSnapshot commands(const NativeEngine& engine) { return engine.commands_.snapshot(); }
    static DomainEventJournalSnapshot events(const NativeEngine& engine) { return engine.events_.snapshot(); }
    static RandomStreamSnapshot random(const NativeEngine& engine) { return engine.random_.snapshot(); }
    static Result<SeededRandom*> stream(NativeEngine& engine, std::string_view name) { return engine.random_.stream(name); }
    static bool dirty(const NativeEngine& engine) noexcept { return engine.dirty_; }
    static bool faulted(const NativeEngine& engine) noexcept { return engine.fault_.has_value(); }
};
} // namespace civic

namespace {
void expectCommandSnapshotEqual(
    const civic::CommandQueueSnapshot& actual,
    const civic::CommandQueueSnapshot& expected
) {
    EXPECT_EQ(actual.next_sequence, expected.next_sequence);
    EXPECT_EQ(actual.seen_sequences, expected.seen_sequences);
    ASSERT_EQ(actual.queue.size(), expected.queue.size());
    for (std::size_t index = 0; index < actual.queue.size(); ++index) {
        EXPECT_EQ(actual.queue[index].sequence, expected.queue[index].sequence);
        EXPECT_EQ(actual.queue[index].tick, expected.queue[index].tick);
        EXPECT_EQ(actual.queue[index].type, expected.queue[index].type);
        EXPECT_EQ(actual.queue[index].payload, expected.queue[index].payload);
        EXPECT_EQ(actual.queue[index].version, expected.queue[index].version);
    }
}

void expectEventSnapshotEqual(
    const civic::DomainEventJournalSnapshot& actual,
    const civic::DomainEventJournalSnapshot& expected
) {
    EXPECT_EQ(actual.next_sequence, expected.next_sequence);
    ASSERT_EQ(actual.events.size(), expected.events.size());
    for (std::size_t index = 0; index < actual.events.size(); ++index) {
        EXPECT_EQ(actual.events[index].sequence, expected.events[index].sequence);
        EXPECT_EQ(actual.events[index].tick, expected.events[index].tick);
        EXPECT_EQ(actual.events[index].type, expected.events[index].type);
        EXPECT_EQ(actual.events[index].source, expected.events[index].source);
        EXPECT_EQ(actual.events[index].payload, expected.events[index].payload);
    }
}
} // namespace

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
    EXPECT_TRUE(civic::NativeEngineTestAccess::faulted(engine));

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
    EXPECT_TRUE(civic::NativeEngineTestAccess::dirty(engine));

    const auto failed = engine.step(1);
    ASSERT_FALSE(failed);
    EXPECT_EQ(failed.error().code, civic::ErrorCode::invalid_state);
    EXPECT_EQ(engine.tick(), 0U);
    EXPECT_FALSE(civic::NativeEngineTestAccess::faulted(engine));
    EXPECT_TRUE(civic::NativeEngineTestAccess::dirty(engine));

    const std::vector<civic::CommandEnvelope> still_mutable{{1, 1, "after-compile-failure", {}}};
    EXPECT_TRUE(engine.submit(still_mutable));
}

TEST(NativeKernelParity, StepZeroIsSideEffectFree) {
    auto created = civic::NativeEngine::create({89, 7, civic::SpeedMode::fast});
    ASSERT_TRUE(created);
    auto& engine = **created;
    int calls = 0;

    ASSERT_TRUE(engine.registerSystem({
        "zero-step-probe",
        {1, 0},
        {},
        {},
        {},
        {},
        0,
        [&](std::uint64_t) -> civic::Result<void> {
            ++calls;
            return {};
        },
    }));

    const auto before = engine.snapshot();
    ASSERT_TRUE(before);
    EXPECT_TRUE(civic::NativeEngineTestAccess::dirty(engine));

    ASSERT_TRUE(engine.step(0));

    const auto after = engine.snapshot();
    ASSERT_TRUE(after);
    EXPECT_EQ(after->json, before->json);
    EXPECT_EQ(calls, 0);
    EXPECT_TRUE(civic::NativeEngineTestAccess::dirty(engine));
    EXPECT_FALSE(civic::NativeEngineTestAccess::faulted(engine));
}

TEST(NativeKernelParity, FailedSystemRollsBackClockCommandsEventsAndRandom) {
    auto created = civic::NativeEngine::create({90, 0, civic::SpeedMode::normal});
    ASSERT_TRUE(created);
    auto& engine = **created;

    auto rollback_stream = civic::NativeEngineTestAccess::stream(engine, "rollback");
    ASSERT_TRUE(rollback_stream);

    const std::vector<civic::CommandEnvelope> commands{{1, 1, "queued-command", {std::byte{0x2A}}}};
    ASSERT_TRUE(engine.submit(commands));

    const auto commands_before = civic::NativeEngineTestAccess::commands(engine);
    const auto events_before = civic::NativeEngineTestAccess::events(engine);
    const auto random_before = civic::NativeEngineTestAccess::random(engine);
    const auto tick_before = engine.tick();
    std::uint32_t mutated_random_state = 0;

    ASSERT_TRUE(engine.registerSystem({
        "mutate-random-then-fail",
        {1, 0},
        {},
        {},
        {},
        {"kernel"},
        0,
        [&](std::uint64_t) -> civic::Result<void> {
            auto stream = civic::NativeEngineTestAccess::stream(engine, "rollback");
            if (!stream) return std::unexpected(stream.error());
            (void)(*stream)->next();
            mutated_random_state = (*stream)->state();
            return std::unexpected(civic::make_error(
                civic::ErrorCode::invalid_state,
                "forced rollback failure fixture"
            ));
        },
    }));

    const auto failed = engine.step(1);
    ASSERT_FALSE(failed);
    EXPECT_EQ(failed.error().message, "forced rollback failure fixture");
    EXPECT_EQ(engine.tick(), tick_before);
    EXPECT_NE(mutated_random_state, random_before.at("rollback"));

    expectCommandSnapshotEqual(civic::NativeEngineTestAccess::commands(engine), commands_before);
    expectEventSnapshotEqual(civic::NativeEngineTestAccess::events(engine), events_before);
    EXPECT_EQ(civic::NativeEngineTestAccess::random(engine), random_before);
    EXPECT_TRUE(civic::NativeEngineTestAccess::faulted(engine));
}
