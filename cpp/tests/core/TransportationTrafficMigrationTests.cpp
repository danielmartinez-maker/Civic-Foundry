#include <gtest/gtest.h>

#include <algorithm>
#include <string>

#include <civic/persistence/TransportationSaveV9.hpp>

namespace {

const std::string kActiveTrafficSave = R"({"saveVersion":9,"gameVersion":"0.9.0-urban-fabric","seed":7,"clock":{"tick":11,"speed":1},"terrain":{},"world":{},"roads":{"revision":7,"cells":[{"x":0,"y":0,"type":"local"},{"x":1,"y":0,"type":"collector"},{"x":2,"y":0,"type":"arterial"}]},"traffic":{"vehicles":[{"id":"vehicle:1","tripId":"trip:1","purpose":"work","travelerWeight":2.5,"originBuildingId":"building:a","destinationBuildingId":"building:b","edgeIds":["e:n:0,0>n:1,0","e:n:1,0>n:2,0"],"currentEdgeIndex":1,"edgeProgressTicks":3.5,"departureTick":4,"accumulatedDelayTicks":2,"freeFlowTicks":8,"status":"queued","queuedNodeId":"n:2,0"}],"outcomes":[],"nextVehicleId":2,"completedTrips":0,"failedTrips":0,"congestionEpoch":9},"intersections":{"n:2,0":[{"incomingEdgeId":"e:n:1,0>n:2,0","entries":[{"vehicleId":"vehicle:1","travelerWeight":2.5,"queuedTick":10,"priority":"normal"}]}]},"urbanFabric":{"parcels":[],"lineage":[]},"zoningV2":{"parcelAssignments":[]},"buildingsV2":[],"propertyMarket":{"holdings":[],"transactions":[],"nextTransactionId":1}})";

} // namespace

TEST(NativeEngineTransportation, HydratesMappedLegacyVehicleWeightIntoDirectionalNativeTraffic) {
    auto parsed = civic::parseTransportationV9(kActiveTrafficSave);
    ASSERT_TRUE(parsed);

    auto mapped = civic::resolveLegacyEdgeV9(parsed->network, "e:n:1,0>n:2,0");
    ASSERT_TRUE(mapped);
    const auto load = std::find_if(parsed->traffic.loads.begin(), parsed->traffic.loads.end(), [&](const auto& item) {
        return item.carriageway_id == *mapped;
    });
    ASSERT_NE(load, parsed->traffic.loads.end());
    EXPECT_DOUBLE_EQ(load->weighted_vehicles, 2.5);
    EXPECT_EQ(parsed->traffic.loads.size(), 1U);
}

TEST(NativeEngineTransportation, LeavesStaleLegacyRoutesInCompatibilityStateInsteadOfRejectingSave) {
    const auto stale = [] {
        std::string value = kActiveTrafficSave;
        const std::string oldEdge = "e:n:1,0>n:2,0";
        const std::string staleEdge = "e:n:1,0>n:9,9";
        std::size_t offset = 0;
        while ((offset = value.find(oldEdge, offset)) != std::string::npos) {
            value.replace(offset, oldEdge.size(), staleEdge);
            offset += staleEdge.size();
        }
        return value;
    }();

    auto parsed = civic::parseTransportationV9(stale);
    ASSERT_TRUE(parsed);
    EXPECT_TRUE(parsed->traffic.loads.empty());
    auto continuation = civic::parseTransportationContinuationV9(stale);
    ASSERT_TRUE(continuation);
    EXPECT_NE(continuation->trafficCanonical.find("e:n:1,0>n:9,9"), std::string::npos);
}
