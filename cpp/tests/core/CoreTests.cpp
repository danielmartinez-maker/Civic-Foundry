#include <gtest/gtest.h>
#include <limits>
#include <vector>
#include <civic/core/Kernel.hpp>
#include <civic/core/NativeEngine.hpp>
#include <civic/core/RandomStreamRegistry.hpp>
#include <civic/core/StrongId.hpp>

TEST(CoreContracts, NumericAndIdentityValueTypesRoundTrip) {
    const civic::EntityId entity{11};
    EXPECT_EQ(civic::EntityId{entity.value()}, entity);
    const civic::ParcelId parcel{42};
    EXPECT_EQ(civic::ParcelId{parcel.value()}, parcel);
    const civic::BuildingId building{43};
    EXPECT_EQ(civic::BuildingId{building.value()}, building);
    const civic::FirmId firm{44};
    EXPECT_EQ(civic::FirmId{firm.value()}, firm);
    const civic::HouseholdId household{45};
    EXPECT_EQ(civic::HouseholdId{household.value()}, household);
    const civic::VehicleId vehicle{46};
    EXPECT_EQ(civic::VehicleId{vehicle.value()}, vehicle);
    const civic::NetworkNodeId node{47};
    EXPECT_EQ(civic::NetworkNodeId{node.value()}, node);
    const civic::NetworkEdgeId edge{48};
    EXPECT_EQ(civic::NetworkEdgeId{edge.value()}, edge);
    const civic::Money money{-12345};
    EXPECT_EQ(civic::Money{money.minor_units()}, money);
    auto weighted = civic::WeightedCount::create(2.5); ASSERT_TRUE(weighted);
    auto restoredWeighted = civic::WeightedCount::create(weighted->value()); ASSERT_TRUE(restoredWeighted);
    EXPECT_EQ(restoredWeighted->value(), weighted->value());
    const civic::GeometryCentimeter coordinate = -987654321;
    EXPECT_EQ(static_cast<civic::GeometryCentimeter>(coordinate), coordinate);
}

TEST(CoreContracts, WeightedCountRejectsNonFiniteAndNegative) {
    EXPECT_FALSE(civic::WeightedCount::create(-1.0));
    EXPECT_FALSE(civic::WeightedCount::create(std::numeric_limits<double>::infinity()));
    EXPECT_FALSE(civic::WeightedCount::create(std::numeric_limits<double>::quiet_NaN()));
    EXPECT_TRUE(civic::WeightedCount::create(2.5));
}

TEST(RandomParity, NamespacedStreamsMatchTypeScriptContract) {
    civic::RandomStreamRegistry registry(1);
    auto traffic = registry.stream("traffic"); ASSERT_TRUE(traffic);
    EXPECT_NEAR((*traffic)->next(), 0.4282657979056239, 1e-15);
    EXPECT_NEAR((*traffic)->next(), 0.7995955946389586, 1e-15);
    auto demographics = registry.stream("demographics"); ASSERT_TRUE(demographics);
    const auto before = (*demographics)->state();
    for (int i = 0; i < 10; ++i) (void)(*traffic)->next();
    EXPECT_EQ((*demographics)->state(), before);
    EXPECT_FALSE(registry.stream("   "));
}

TEST(CommandContracts, StableOrderingDuplicateRejectionAndPastTickParity) {
    civic::CommandQueue queue;
    const std::vector<civic::CommandEnvelope> commands{{2, 5, "b", {}}, {1, 5, "a", {}}};
    ASSERT_TRUE(queue.submit(commands, 4));
    auto ready = queue.takeReady(5);
    ASSERT_EQ(ready.size(), 2U);
    EXPECT_EQ(ready[0].sequence, 1U);
    EXPECT_EQ(ready[1].sequence, 2U);
    const std::vector<civic::CommandEnvelope> past{{3, 4, "past", {}}};
    ASSERT_TRUE(queue.submit(past, 5));
    EXPECT_EQ(queue.takeReady(6).at(0).sequence, 3U);
    const std::vector<civic::CommandEnvelope> duplicate{{4, 7, "a", {}}, {4, 7, "b", {}}};
    EXPECT_FALSE(queue.submit(duplicate, 6));
}

TEST(CommandContracts, RejectsUnsupportedEnvelopeVersion) {
    civic::CommandQueue queue;
    auto command = civic::CommandEnvelope{1, 0, "future-protocol", {}};
    command.version = civic::command_protocol_version + 1U;
    const std::vector<civic::CommandEnvelope> commands{command};
    const auto result = queue.submit(commands, 0);
    ASSERT_FALSE(result);
    EXPECT_EQ(result.error().code, civic::ErrorCode::invalid_argument);
}

TEST(CommandContracts, RejectsSequenceReuseAfterDispatch) {
    civic::CommandQueue queue;
    const std::vector<civic::CommandEnvelope> first{{1, 0, "first", {}}};
    ASSERT_TRUE(queue.submit(first, 0));
    ASSERT_EQ(queue.takeReady(0).size(), 1U);
    const std::vector<civic::CommandEnvelope> reused{{1, 1, "reused", {}}};
    EXPECT_FALSE(queue.submit(reused, 0));
}

TEST(CommandBusParity, NativeEnqueueAssignsMonotonicSequence) {
    civic::CommandQueue queue;
    const auto first = queue.enqueue(9, "first");
    ASSERT_TRUE(first);
    const auto second = queue.enqueue(3, "second", {std::byte{0x2A}});
    ASSERT_TRUE(second);

    EXPECT_EQ(*first, 1U);
    EXPECT_EQ(*second, 2U);
    EXPECT_EQ(queue.nextSequence(), 3U);
    ASSERT_EQ(queue.pending().size(), 2U);
    EXPECT_EQ(queue.pending()[0].sequence, 1U);
    EXPECT_EQ(queue.pending()[1].sequence, 2U);
    EXPECT_EQ(queue.pending()[1].payload, (std::vector<std::byte>{std::byte{0x2A}}));
}

TEST(CommandBusParity, SnapshotRestorePreservesPendingOrderAndNextSequence) {
    civic::CommandQueue source;
    ASSERT_TRUE(source.enqueue(10, "later", {std::byte{0x01}, std::byte{0x02}}));
    ASSERT_TRUE(source.enqueue(4, "earlier"));
    ASSERT_TRUE(source.enqueue(12, "future"));
    ASSERT_EQ(source.takeReady(4).size(), 1U);

    const auto snapshot = source.snapshot();
    civic::CommandQueue restored;
    ASSERT_TRUE(restored.restore(snapshot));

    EXPECT_EQ(restored.nextSequence(), source.nextSequence());
    ASSERT_EQ(restored.pending().size(), source.pending().size());
    for (std::size_t index = 0; index < source.pending().size(); ++index) {
        EXPECT_EQ(restored.pending()[index].sequence, source.pending()[index].sequence);
        EXPECT_EQ(restored.pending()[index].tick, source.pending()[index].tick);
        EXPECT_EQ(restored.pending()[index].type, source.pending()[index].type);
        EXPECT_EQ(restored.pending()[index].payload, source.pending()[index].payload);
        EXPECT_EQ(restored.pending()[index].version, source.pending()[index].version);
    }

    const std::vector<civic::CommandEnvelope> reused{{2, 20, "reused-dispatched-sequence", {}}};
    EXPECT_FALSE(restored.submit(reused, 0));
}

TEST(CommandBusParity, ExternalSequenceAdvancesInternalSequenceFloor) {
    civic::CommandQueue queue;
    const std::vector<civic::CommandEnvelope> external{{50, 5, "external", {}}};
    ASSERT_TRUE(queue.submit(external, 0));
    EXPECT_GE(queue.nextSequence(), 51U);

    const auto internal = queue.enqueue(6, "internal");
    ASSERT_TRUE(internal);
    EXPECT_GE(*internal, 51U);
    EXPECT_EQ(*internal, 51U);
}

TEST(CommandBusParity, RestoreRejectsDuplicateOrOutOfRangeSequence) {
    civic::CommandQueue queue;

    civic::CommandQueueSnapshot duplicate{
        {{1, 0, "a", {}}, {1, 1, "b", {}}},
        {1},
        2,
    };
    const auto duplicateResult = queue.restore(duplicate);
    ASSERT_FALSE(duplicateResult);
    EXPECT_EQ(duplicateResult.error().code, civic::ErrorCode::invalid_argument);

    civic::CommandQueueSnapshot outOfRange{
        {{2, 0, "a", {}}},
        {2},
        2,
    };
    const auto outOfRangeResult = queue.restore(outOfRange);
    ASSERT_FALSE(outOfRangeResult);
    EXPECT_EQ(outOfRangeResult.error().code, civic::ErrorCode::invalid_argument);
}

TEST(EventContracts, PreservesAppendSequenceAndDrainOrder) {
    civic::DomainEventJournal journal;
    const auto first = journal.append(5, "first", "source-a");
    const auto second = journal.append(3, "second", "source-b");
    EXPECT_EQ(first.sequence, 1U);
    EXPECT_EQ(second.sequence, 2U);
    ASSERT_EQ(journal.list().size(), 2U);
    EXPECT_EQ(journal.list()[0].type, "first");
    EXPECT_EQ(journal.list()[1].type, "second");
    const auto drained = journal.drain();
    ASSERT_EQ(drained.size(), 2U);
    EXPECT_EQ(drained[0].sequence, 1U);
    EXPECT_EQ(drained[1].sequence, 2U);
    EXPECT_TRUE(journal.list().empty());
    EXPECT_EQ(journal.nextSequence(), 3U);
}

TEST(ClockContracts, PreservesAcceptedSpeedModes) {
    civic::SimulationClock clock{3, civic::SpeedMode::fast};
    EXPECT_EQ(clock.tick(), 3U);
    EXPECT_EQ(clock.speed(), civic::SpeedMode::fast);
    ASSERT_TRUE(clock.setSpeed(civic::SpeedMode::paused));
    ASSERT_TRUE(clock.step(2));
    EXPECT_EQ(clock.tick(), 5U);
    EXPECT_EQ(clock.speed(), civic::SpeedMode::paused);
}

TEST(SchedulerContracts, DetectsCyclesConflictsAndInvalidCadence) {
    civic::SystemScheduler cycle;
    ASSERT_TRUE(cycle.registerSystem({"a", {1,0}, {"b"}, {}, {}, {}, 0, {}}));
    ASSERT_TRUE(cycle.registerSystem({"b", {1,0}, {"a"}, {}, {}, {}, 0, {}}));
    EXPECT_FALSE(cycle.compile());
    civic::SystemScheduler conflict;
    ASSERT_TRUE(conflict.registerSystem({"a", {1,0}, {}, {}, {}, {"world"}, 0, {}}));
    ASSERT_TRUE(conflict.registerSystem({"b", {1,0}, {}, {}, {}, {"world"}, 0, {}}));
    EXPECT_FALSE(conflict.compile());
    civic::SystemScheduler invalid;
    EXPECT_FALSE(invalid.registerSystem({"bad", {2,2}, {}, {}, {}, {}, 0, {}}));
}

TEST(SchedulerContracts, HonorsPrerequisitesTieBreaksAndCadence) {
    civic::SystemScheduler scheduler;
    ASSERT_TRUE(scheduler.registerSystem({"later", {2,0}, {"first"}, {}, {}, {}, -10, {}}));
    ASSERT_TRUE(scheduler.registerSystem({"first", {1,0}, {}, {}, {}, {}, 10, {}}));
    ASSERT_TRUE(scheduler.compile());
    EXPECT_EQ(scheduler.orderedIds(), (std::vector<std::string>{"first", "later"}));
    auto tickZero = scheduler.dueSystems(0); ASSERT_TRUE(tickZero);
    ASSERT_EQ(tickZero->size(), 2U);
    EXPECT_EQ((*tickZero)[0]->id, "first");
    EXPECT_EQ((*tickZero)[1]->id, "later");
    auto tickOne = scheduler.dueSystems(1); ASSERT_TRUE(tickOne);
    ASSERT_EQ(tickOne->size(), 1U);
    EXPECT_EQ((*tickOne)[0]->id, "first");
}

TEST(InvariantContracts, HonorsCadenceAndMapsFailures) {
    civic::InvariantRunner runner;
    int calls = 0;
    ASSERT_TRUE(runner.registerInvariant({"periodic", {2,1}, [&](std::uint64_t tick) -> civic::Result<void> {
        ++calls;
        if (tick == 3) return std::unexpected(civic::make_error(civic::ErrorCode::invalid_state, "fixture failure"));
        return {};
    }}));
    ASSERT_TRUE(runner.runDue(0));
    EXPECT_EQ(calls, 0);
    ASSERT_TRUE(runner.runDue(1));
    EXPECT_EQ(calls, 1);
    ASSERT_TRUE(runner.runDue(2));
    EXPECT_EQ(calls, 1);
    const auto failed = runner.runDue(3);
    ASSERT_FALSE(failed);
    EXPECT_EQ(failed.error().code, civic::ErrorCode::invariant_failure);
    EXPECT_NE(failed.error().message.find("periodic"), std::string::npos);
    EXPECT_EQ(calls, 2);
}

TEST(NativeEngineContracts, StepZeroIsSideEffectFreeAndDomainsAreExplicitlyUnowned) {
    auto created = civic::NativeEngine::create({42, 7, civic::SpeedMode::fast}); ASSERT_TRUE(created);
    auto before = (*created)->snapshot(); ASSERT_TRUE(before);
    ASSERT_TRUE((*created)->step(0));
    auto after = (*created)->snapshot(); ASSERT_TRUE(after);
    EXPECT_EQ(before->json, after->json);
    EXPECT_NE(after->json.find("\"speed\":2"), std::string::npos);
    auto world = (*created)->domainHash("world"); ASSERT_TRUE(world);
    EXPECT_EQ(world->ownership, civic::DomainOwnership::unowned);
}
