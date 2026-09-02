#include <gtest/gtest.h>

#include <algorithm>
#include <string>
#include <vector>

#include <civic/core/NativeEngine.hpp>
#include <civic/persistence/TransportationSaveV9.hpp>

namespace {

const std::string kTrafficContinuationSave = R"({"saveVersion":9,"gameVersion":"0.9.0-urban-fabric","seed":7,"clock":{"tick":11,"speed":1},"terrain":{},"world":{},"roads":{"revision":7,"cells":[{"x":0,"y":0,"type":"local"},{"x":1,"y":0,"type":"collector"},{"x":2,"y":0,"type":"arterial"}]},"traffic":{"vehicles":[{"id":"vehicle:1","tripId":"trip:1","purpose":"work","travelerWeight":2.5,"originBuildingId":"building:a","destinationBuildingId":"building:b","edgeIds":["e:n:0,0>n:1,0","e:n:1,0>n:2,0"],"currentEdgeIndex":1,"edgeProgressTicks":3.5,"departureTick":4,"accumulatedDelayTicks":2,"freeFlowTicks":8,"status":"queued","queuedNodeId":"n:2,0"}],"outcomes":[{"tripId":"trip:done","purpose":"shopping","travelerWeight":1.25,"success":true,"freeFlowTicks":4,"actualTravelTicks":5}],"nextVehicleId":2,"completedTrips":1,"failedTrips":0,"congestionEpoch":9},"intersections":{"n:2,0":[{"incomingEdgeId":"e:n:1,0>n:2,0","entries":[{"vehicleId":"vehicle:1","travelerWeight":2.5,"queuedTick":10,"priority":"normal"}]}]},"urbanFabric":{"parcels":[],"lineage":[]},"zoningV2":{"parcelAssignments":[]},"buildingsV2":[],"propertyMarket":{"holdings":[],"transactions":[],"nextTransactionId":1}})";

std::uint64_t transportationHash(const std::string& save) {
    auto engine = civic::NativeEngine::create({7, 0, civic::SpeedMode::normal});
    EXPECT_TRUE(engine);
    if (!engine) return 0;
    auto loaded = (*engine)->loadV9(save);
    EXPECT_TRUE(loaded);
    if (!loaded) return 0;
    auto hash = (*engine)->domainHash("transportation");
    EXPECT_TRUE(hash);
    return hash ? hash->value : 0;
}

std::string replaceOnce(std::string source, const std::string& from, const std::string& to) {
    const auto offset = source.find(from);
    EXPECT_NE(offset, std::string::npos);
    if (offset != std::string::npos) source.replace(offset, from.size(), to);
    return source;
}

const civic::transport::Carriageway* findCarriageway(
    const civic::transport::NetworkSnapshot& network,
    const civic::transport::CarriagewayId& id) {
    const auto iterator = std::find_if(network.carriageways.begin(), network.carriageways.end(), [&](const auto& carriageway) {
        return carriageway.id == id;
    });
    return iterator == network.carriageways.end() ? nullptr : &*iterator;
}

} // namespace

TEST(NativeEngineTransportation, PreservesLegacyTrafficAndIntersectionContinuationInMigrationHash) {
    auto continuation = civic::parseTransportationContinuationV9(kTrafficContinuationSave);
    ASSERT_TRUE(continuation);
    EXPECT_NE(continuation->trafficCanonical.find("vehicle:1"), std::string::npos);
    EXPECT_NE(continuation->trafficCanonical.find("edgeProgressTicks"), std::string::npos);
    EXPECT_NE(continuation->intersectionsCanonical.find("vehicle:1"), std::string::npos);
    EXPECT_NE(continuation->intersectionsCanonical.find("queuedTick"), std::string::npos);

    const auto baseline = transportationHash(kTrafficContinuationSave);
    EXPECT_NE(baseline, 0U);

    const auto progressed = replaceOnce(kTrafficContinuationSave, "\"edgeProgressTicks\":3.5", "\"edgeProgressTicks\":4.5");
    EXPECT_NE(transportationHash(progressed), baseline);

    const auto requeued = replaceOnce(kTrafficContinuationSave, "\"queuedTick\":10", "\"queuedTick\":11");
    EXPECT_NE(transportationHash(requeued), baseline);
}

TEST(NativeEngineTransportation, ResolvesLegacyGraphEdgesToExactNativeCarriageways) {
    const std::vector<civic::transport::LegacyRoadCell> roads{
        {0, 0, civic::transport::RoadClass::local, false, civic::transport::Direction::forward},
        {1, 0, civic::transport::RoadClass::collector, false, civic::transport::Direction::forward},
        {2, 0, civic::transport::RoadClass::arterial, false, civic::transport::Direction::forward},
    };
    const auto network = civic::transport::LegacyRoadAdapter{}.project(roads, 7);

    auto forward = civic::resolveLegacyEdgeV9(network, "e:n:0,0>n:1,0");
    ASSERT_TRUE(forward);
    const auto* forwardCarriageway = findCarriageway(network, *forward);
    ASSERT_NE(forwardCarriageway, nullptr);
    EXPECT_EQ(forwardCarriageway->from_junction_id.value, "j:legacy:0,0");
    EXPECT_EQ(forwardCarriageway->to_junction_id.value, "j:legacy:1,0");

    auto reverse = civic::resolveLegacyEdgeV9(network, "e:n:1,0>n:0,0");
    ASSERT_TRUE(reverse);
    const auto* reverseCarriageway = findCarriageway(network, *reverse);
    ASSERT_NE(reverseCarriageway, nullptr);
    EXPECT_EQ(reverseCarriageway->from_junction_id.value, "j:legacy:1,0");
    EXPECT_EQ(reverseCarriageway->to_junction_id.value, "j:legacy:0,0");
    EXPECT_NE(reverse->value, forward->value);

    EXPECT_FALSE(civic::resolveLegacyEdgeV9(network, "e:n:0,0>n:9,9"));
    EXPECT_FALSE(civic::resolveLegacyEdgeV9(network, "not-an-edge"));
    EXPECT_FALSE(civic::resolveLegacyEdgeV9(network, "e:n:0,0>n:1,0:trailing"));
}
