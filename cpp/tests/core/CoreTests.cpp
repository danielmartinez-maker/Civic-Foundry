#include <gtest/gtest.h>
#include <limits>
#include <string>
#include <vector>
#include <civic/core/Kernel.hpp>
#include <civic/core/KernelTypes.hpp>
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
    ASSERT_TRUE(first);
    const auto second = journal.append(3, "second", "source-b");
    ASSERT_TRUE(second);
    EXPECT_EQ(first->sequence, 1U);
    EXPECT_EQ(second->sequence, 2U);
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

TEST(KernelTypes, RejectsZeroEveryAndIncludesOwnerLabel) {
    const auto result = civic::validateCadence({0, 0}, "zero-every-owner");
    ASSERT_FALSE(result);
    EXPECT_EQ(result.error().code, civic::ErrorCode::invalid_argument);
    EXPECT_NE(result.error().message.find("zero-every-owner"), std::string::npos);
}

TEST(KernelTypes, RejectsOffsetAtOrBeyondEvery) {
    EXPECT_FALSE(civic::validateCadence({3, 3}, "offset-owner"));
    EXPECT_FALSE(civic::validateCadence({3, 4}, "offset-owner"));
}

TEST(KernelTypes, EveryOneOffsetZeroIsDueEveryTick) {
    const civic::SystemCadence cadence{1, 0};
    EXPECT_TRUE(civic::isDue(cadence, 0));
    EXPECT_TRUE(civic::isDue(cadence, 1));
    EXPECT_TRUE(civic::isDue(cadence, 2));
    EXPECT_TRUE(civic::isDue(cadence, 100));
}

TEST(KernelTypes, CadenceThreeOffsetOneMatchesTypeScriptPattern) {
    const civic::SystemCadence cadence{3, 1};
    EXPECT_FALSE(civic::isDue(cadence, 0));
    EXPECT_TRUE(civic::isDue(cadence, 1));
    EXPECT_FALSE(civic::isDue(cadence, 2));
    EXPECT_FALSE(civic::isDue(cadence, 3));
    EXPECT_TRUE(civic::isDue(cadence, 4));
    EXPECT_TRUE(civic::isDue(cadence, 7));
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
    EXPECT_EQ(failed.error().message, "invariant failed [periodic] at tick 3: fixture failure");
    EXPECT_EQ(calls, 2);
}

TEST(InvariantContracts, RegistrationStoresStableCopiedDefinition) {
    civic::InvariantRunner runner;
    int original_calls = 0;
    int mutated_calls = 0;
    civic::InvariantDefinition definition{
        "stable",
        {2, 1},
        [&](std::uint64_t) -> civic::Result<void> { ++original_calls; return {}; }
    };
    ASSERT_TRUE(runner.registerInvariant(definition));

    definition.id = "mutated";
    definition.cadence = {1, 0};
    definition.check = [&](std::uint64_t) -> civic::Result<void> { ++mutated_calls; return {}; };

    EXPECT_EQ(runner.listIds(), (std::vector<std::string>{"stable"}));
    ASSERT_TRUE(runner.runDue(0));
    ASSERT_TRUE(runner.runDue(1));
    EXPECT_EQ(original_calls, 1);
    EXPECT_EQ(mutated_calls, 0);
}

TEST(SnapshotRegistryParity, RejectsDuplicateAndBlankIds) {
    civic::SnapshotRegistry registry;
    const auto provider = []() -> civic::Result<std::string> { return std::string{"{}"}; };

    ASSERT_TRUE(registry.registerProvider("alpha", provider));

    const auto duplicate = registry.registerProvider("alpha", provider);
    ASSERT_FALSE(duplicate);
    EXPECT_EQ(duplicate.error().code, civic::ErrorCode::invalid_argument);
    EXPECT_EQ(duplicate.error().message, "duplicate snapshot provider: alpha");

    const auto blank = registry.registerProvider("   ", provider);
    ASSERT_FALSE(blank);
    EXPECT_EQ(blank.error().code, civic::ErrorCode::invalid_argument);
    EXPECT_EQ(blank.error().message, "snapshot provider id must not be empty");

    const std::string nbsp{"\xC2\xA0"};
    const auto ecma_blank = registry.registerProvider(nbsp, provider);
    ASSERT_FALSE(ecma_blank);
    EXPECT_EQ(ecma_blank.error().code, civic::ErrorCode::invalid_argument);
}

TEST(SnapshotRegistryParity, UnknownCaptureFails) {
    civic::SnapshotRegistry registry;
    const auto captured = registry.capture("missing");
    ASSERT_FALSE(captured);
    EXPECT_EQ(captured.error().code, civic::ErrorCode::invalid_argument);
    EXPECT_EQ(captured.error().message, "unknown snapshot provider: missing");
}

TEST(SnapshotRegistryParity, CaptureAllUsesUtf16OrdinalOrder) {
    const std::string supplementary{"\xF0\x90\x80\x80"}; // U+10000 -> UTF-16 D800 DC00
    const std::string private_bmp{"\xEE\x80\x80"};       // U+E000
    civic::SnapshotRegistry registry;

    ASSERT_TRUE(registry.registerProvider(private_bmp, []() -> civic::Result<std::string> { return std::string{"bmp"}; }));
    ASSERT_TRUE(registry.registerProvider(supplementary, []() -> civic::Result<std::string> { return std::string{"supplementary"}; }));
    ASSERT_TRUE(registry.registerProvider("alpha", []() -> civic::Result<std::string> { return std::string{"ascii"}; }));

    const auto expected = std::vector<std::string>{"alpha", supplementary, private_bmp};
    EXPECT_EQ(registry.listIds(), expected);

    const auto captured = registry.captureAll();
    ASSERT_TRUE(captured);
    std::vector<std::string> captured_ids;
    for (const auto& [id, value] : *captured) {
        (void)value;
        captured_ids.push_back(id);
    }
    EXPECT_EQ(captured_ids, expected);
    EXPECT_EQ(captured->at("alpha"), "ascii");
    EXPECT_EQ(captured->at(supplementary), "supplementary");
    EXPECT_EQ(captured->at(private_bmp), "bmp");
}

TEST(SnapshotRegistryParity, CapturedValueIsIndependentFromLaterProviderMutation) {
    civic::SnapshotRegistry registry;
    std::string provider_state = R"({"nested":{"value":1}})";
    ASSERT_TRUE(registry.registerProvider("state", [&provider_state]() -> civic::Result<std::string> {
        return provider_state;
    }));

    const auto first = registry.capture("state");
    ASSERT_TRUE(first);
    EXPECT_EQ(*first, R"({"nested":{"value":1}})");

    provider_state = R"({"nested":{"value":8}})";
    EXPECT_EQ(*first, R"({"nested":{"value":1}})");

    const auto second = registry.capture("state");
    ASSERT_TRUE(second);
    EXPECT_EQ(*second, R"({"nested":{"value":8}})");
}

TEST(SnapshotRegistryParity, CaptureAllFreezesProviderSetBeforeCapture) {
    civic::SnapshotRegistry registry;
    bool inserted = false;
    ASSERT_TRUE(registry.registerProvider("alpha", [&]() -> civic::Result<std::string> {
        if (!inserted) {
            inserted = true;
            auto registered = registry.registerProvider("zeta", []() -> civic::Result<std::string> {
                return std::string{"late"};
            });
            if (!registered) return std::unexpected(registered.error());
        }
        return std::string{"initial"};
    }));

    const auto captured = registry.captureAll();
    ASSERT_TRUE(captured);
    EXPECT_EQ(captured->size(), 1U);
    EXPECT_EQ(captured->at("alpha"), "initial");
    EXPECT_FALSE(captured->contains("zeta"));
    EXPECT_EQ(registry.listIds(), (std::vector<std::string>{"alpha", "zeta"}));
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

TEST(RandomParity, RootSeedAndSameNameUseUint32StreamSemantics) {
    civic::RandomStreamRegistry baseline(1U);
    const auto wrapped_seed = static_cast<std::uint32_t>(0x100000001ULL);
    civic::RandomStreamRegistry wrapped(wrapped_seed);
    auto baseline_traffic = baseline.stream("traffic"); ASSERT_TRUE(baseline_traffic);
    auto wrapped_traffic = wrapped.stream("traffic"); ASSERT_TRUE(wrapped_traffic);
    EXPECT_DOUBLE_EQ((*baseline_traffic)->next(), (*wrapped_traffic)->next());

    civic::RandomStreamRegistry registry(7U);
    auto first = registry.stream("traffic"); ASSERT_TRUE(first);
    (void)(*first)->next();
    const auto state = (*first)->state();
    auto second = registry.stream("traffic"); ASSERT_TRUE(second);
    EXPECT_EQ(*first, *second);
    EXPECT_EQ((*second)->state(), state);
}

TEST(RandomParity, RestoreZeroStateUsesSeededRandomFallback) {
    civic::RandomStreamRegistry registry(9U);
    civic::RandomStreamSnapshot snapshot;
    snapshot.emplace("traffic", 0U);
    ASSERT_TRUE(registry.restore(snapshot));

    auto traffic = registry.stream("traffic"); ASSERT_TRUE(traffic);
    EXPECT_EQ((*traffic)->state(), 0x6d2b79f5U);
    civic::SeededRandom expected(0U);
    EXPECT_DOUBLE_EQ((*traffic)->next(), expected.next());
}

TEST(SchedulerContracts, RegistrationValidationMatchesTypeScriptDiagnostics) {
    civic::SystemScheduler scheduler;

    const auto duplicate_read = scheduler.registerSystem({"dup-read", {1,0}, {}, {}, {"traffic", "traffic"}, {}, 0, {}});
    ASSERT_FALSE(duplicate_read);
    EXPECT_EQ(duplicate_read.error().message, "duplicate read domain for system dup-read: traffic");

    const auto duplicate_write = scheduler.registerSystem({"dup-write", {1,0}, {}, {}, {}, {"traffic", "traffic"}, 0, {}});
    ASSERT_FALSE(duplicate_write);
    EXPECT_EQ(duplicate_write.error().message, "duplicate write domain for system dup-write: traffic");

    const auto read_write = scheduler.registerSystem({"read-write", {1,0}, {}, {}, {"traffic"}, {"traffic"}, 0, {}});
    ASSERT_FALSE(read_write);
    EXPECT_EQ(read_write.error().message, "domain declared as read and write for system read-write: traffic");

    const auto self_after = scheduler.registerSystem({"self-after", {1,0}, {"self-after"}, {}, {}, {}, 0, {}});
    ASSERT_FALSE(self_after);
    EXPECT_EQ(self_after.error().message, "self dependency for kernel system self-after");

    const auto invalid_cadence = scheduler.registerSystem({"bad-cadence", {2,2}, {}, {}, {}, {}, 0, {}});
    ASSERT_FALSE(invalid_cadence);
    EXPECT_EQ(invalid_cadence.error().message, "invalid cadence for system bad-cadence");
}

TEST(SchedulerContracts, CadenceOverlapUsesGcdArithmeticAndDependencyPaths) {
    civic::SystemScheduler disjoint;
    ASSERT_TRUE(disjoint.registerSystem({"even", {2,0}, {}, {}, {}, {"market"}, 0, {}}));
    ASSERT_TRUE(disjoint.registerSystem({"odd", {2,1}, {}, {}, {}, {"market"}, 0, {}}));
    EXPECT_TRUE(disjoint.compile());

    civic::SystemScheduler overlapping;
    ASSERT_TRUE(overlapping.registerSystem({"four", {4,1}, {}, {}, {}, {"market"}, 0, {}}));
    ASSERT_TRUE(overlapping.registerSystem({"six", {6,3}, {}, {}, {}, {"market"}, 0, {}}));
    const auto conflict = overlapping.compile();
    ASSERT_FALSE(conflict);
    EXPECT_EQ(conflict.error().message, "ambiguous write conflict on domain market: four, six");

    civic::SystemScheduler ordered;
    ASSERT_TRUE(ordered.registerSystem({"four", {4,1}, {}, {}, {}, {"market"}, 0, {}}));
    ASSERT_TRUE(ordered.registerSystem({"six", {6,3}, {"four"}, {}, {}, {"market"}, 0, {}}));
    ASSERT_TRUE(ordered.compile());
    EXPECT_EQ(ordered.orderedIds(), (std::vector<std::string>{"four", "six"}));
}

TEST(SchedulerContracts, OrderFieldBreaksTopologicalTies) {
    civic::SystemScheduler scheduler;
    ASSERT_TRUE(scheduler.registerSystem({"beta", {1,0}, {}, {}, {}, {}, 5, {}}));
    ASSERT_TRUE(scheduler.registerSystem({"gamma", {1,0}, {}, {}, {}, {}, -1, {}}));
    ASSERT_TRUE(scheduler.registerSystem({"alpha", {1,0}, {}, {}, {}, {}, 5, {}}));
    ASSERT_TRUE(scheduler.compile());
    EXPECT_EQ(scheduler.orderedIds(), (std::vector<std::string>{"gamma", "alpha", "beta"}));
}

TEST(SchedulerContracts, UnknownDependenciesAndCycleParticipantsAreDeterministic) {
    civic::SystemScheduler unknown_after;
    ASSERT_TRUE(unknown_after.registerSystem({"traffic", {1,0}, {"roads"}, {}, {}, {}, 0, {}}));
    const auto after_result = unknown_after.compile();
    ASSERT_FALSE(after_result);
    EXPECT_EQ(after_result.error().message, "unknown kernel dependency: roads -> traffic");

    civic::SystemScheduler unknown_before;
    ASSERT_TRUE(unknown_before.registerSystem({"traffic", {1,0}, {}, {"roads"}, {}, {}, 0, {}}));
    const auto before_result = unknown_before.compile();
    ASSERT_FALSE(before_result);
    EXPECT_EQ(before_result.error().message, "unknown kernel dependency: traffic -> roads");

    civic::SystemScheduler cycle;
    ASSERT_TRUE(cycle.registerSystem({"c", {1,0}, {"b"}, {}, {}, {}, 0, {}}));
    ASSERT_TRUE(cycle.registerSystem({"a", {1,0}, {"c"}, {}, {}, {}, 0, {}}));
    ASSERT_TRUE(cycle.registerSystem({"b", {1,0}, {"a"}, {}, {}, {}, 0, {}}));
    const auto cycle_result = cycle.compile();
    ASSERT_FALSE(cycle_result);
    EXPECT_EQ(cycle_result.error().message, "kernel dependency cycle: a -> b -> c");
}

TEST(SchedulerContracts, DueFilteringAndListIdsAreIndependentOfCompiledOrder) {
    civic::SystemScheduler scheduler;
    ASSERT_TRUE(scheduler.registerSystem({"zeta", {2,0}, {}, {}, {}, {}, -5, {}}));
    ASSERT_TRUE(scheduler.registerSystem({"alpha", {2,1}, {}, {}, {}, {}, 10, {}}));

    EXPECT_EQ(scheduler.listSystemIds(), (std::vector<std::string>{"alpha", "zeta"}));
    ASSERT_TRUE(scheduler.compile());
    EXPECT_EQ(scheduler.orderedIds(), (std::vector<std::string>{"zeta", "alpha"}));
    EXPECT_EQ(scheduler.listSystemIds(), (std::vector<std::string>{"alpha", "zeta"}));

    const auto tick_one = scheduler.dueSystems(1);
    ASSERT_TRUE(tick_one);
    ASSERT_EQ(tick_one->size(), 1U);
    EXPECT_EQ((*tick_one)[0]->id, "alpha");

    const auto tick_two = scheduler.dueSystems(2);
    ASSERT_TRUE(tick_two);
    ASSERT_EQ(tick_two->size(), 1U);
    EXPECT_EQ((*tick_two)[0]->id, "zeta");
}
