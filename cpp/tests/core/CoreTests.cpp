#include <gtest/gtest.h>
#include <limits>
#include <string>
#include <vector>
#include <civic/core/Kernel.hpp>
#include <civic/core/NativeEngine.hpp>
#include <civic/core/RandomStreamRegistry.hpp>
#include <civic/core/StrongId.hpp>

TEST(CoreContracts, NumericAndIdentityValueTypesRoundTrip) {
    const civic::ParcelId parcel{42};
    const civic::ParcelId restoredParcel{parcel.value()};
    EXPECT_EQ(restoredParcel, parcel);
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

TEST(CommandContracts, RejectsSequenceReuseAfterDispatch) {
    civic::CommandQueue queue;
    const std::vector<civic::CommandEnvelope> first{{1, 0, "first", {}}};
    ASSERT_TRUE(queue.submit(first, 0));
    ASSERT_EQ(queue.takeReady(0).size(), 1U);
    const std::vector<civic::CommandEnvelope> reused{{1, 1, "reused", {}}};
    EXPECT_FALSE(queue.submit(reused, 0));
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

TEST(NativeEngineTransportation, HydratesOwnedTransportationFromSaveV9AndPreservesHash) {
    const std::string save = R"({"saveVersion":9,"gameVersion":"0.9.0-urban-fabric","seed":7,"clock":{"tick":11,"speed":1},"terrain":{},"world":{},"roads":{"revision":7,"cells":[{"x":0,"y":0,"type":"local"},{"x":1,"y":0,"type":"collector"},{"x":2,"y":0,"type":"arterial"}]},"transit":{"network":{"revision":4,"nextStopId":3,"nextLineId":2,"stops":[{"id":"s1","type":"surface_stop","x":0,"y":1},{"id":"s2","type":"surface_stop","x":2,"y":1}],"lines":[{"id":"l1","name":"BRT 1","mode":"brt","stopIds":["s1","s2"],"headwayTicks":60,"fare":2.5,"enabled":true}]},"mobility":{"decisions":[],"crowdingPenaltyTicks":0,"fiscalOperatingCursor":0,"fiscalFareCursor":0,"passengers":{"nextSplitId":1,"queues":[{"stopId":"s1","lineId":"l1","directionKey":"forward","cohorts":[{"id":"c1","personTripId":"trip:1","travelerWeight":3,"lineId":"l1","directionKey":"forward","boardingStopId":"s1","alightingStopId":"s2","destinationRoadNodeId":"j:legacy:2,0","enqueuedTick":11,"transferLegs":[]}] }]},"vehicles":{"nextVehicleId":1,"vehicles":[]},"operations":{"lines":[]}}},"urbanFabric":{"parcels":[],"lineage":[]},"zoningV2":{"parcelAssignments":[]},"buildingsV2":[],"propertyMarket":{"holdings":[],"transactions":[],"nextTransactionId":1}})";

    auto first = civic::NativeEngine::create({7, 0, civic::SpeedMode::normal}); ASSERT_TRUE(first);
    ASSERT_TRUE((*first)->loadV9(save));
    auto firstHash = (*first)->domainHash("transportation"); ASSERT_TRUE(firstHash);
    EXPECT_EQ(firstHash->ownership, civic::DomainOwnership::owned);
    EXPECT_NE(firstHash->value, 0U);

    auto saved = (*first)->saveV9(); ASSERT_TRUE(saved);
    auto second = civic::NativeEngine::create({1, 0, civic::SpeedMode::normal}); ASSERT_TRUE(second);
    ASSERT_TRUE((*second)->loadV9(*saved));
    auto secondHash = (*second)->domainHash("transportation"); ASSERT_TRUE(secondHash);
    EXPECT_EQ(secondHash->ownership, civic::DomainOwnership::owned);
    EXPECT_EQ(secondHash->value, firstHash->value);
}
