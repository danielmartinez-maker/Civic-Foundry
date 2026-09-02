#include <gtest/gtest.h>

#include <algorithm>
#include <string>

#include <civic/core/NativeEngine.hpp>
#include <civic/persistence/TransportationSaveV9.hpp>

namespace {

const std::string kActiveTrafficSave = R"({"saveVersion":9,"gameVersion":"0.9.0-urban-fabric","seed":7,"clock":{"tick":11,"speed":1},"terrain":{},"world":{},"roads":{"revision":7,"cells":[{"x":0,"y":0,"type":"local"},{"x":1,"y":0,"type":"collector"},{"x":2,"y":0,"type":"arterial"}]},"traffic":{"vehicles":[{"id":"vehicle:1","tripId":"trip:1","purpose":"commute","travelerWeight":2.5,"originBuildingId":"building:a","destinationBuildingId":"building:b","edgeIds":["e:n:0,0>n:1,0","e:n:1,0>n:2,0"],"currentEdgeIndex":1,"edgeProgressTicks":3.5,"departureTick":4,"accumulatedDelayTicks":2,"freeFlowTicks":8,"status":"queued","queuedNodeId":"n:2,0"}],"outcomes":[],"nextVehicleId":2,"completedTrips":0,"failedTrips":0,"congestionEpoch":9},"intersections":{"n:2,0":[{"incomingEdgeId":"e:n:1,0>n:2,0","entries":[{"vehicleId":"vehicle:1","travelerWeight":2.5,"queuedTick":10,"priority":"normal"}]}]},"urbanFabric":{"parcels":[],"lineage":[]},"zoningV2":{"parcelAssignments":[]},"buildingsV2":[],"propertyMarket":{"holdings":[],"transactions":[],"nextTransactionId":1}})";

} // namespace

TEST(NativeEngineTransportation, HydratesMappedLegacyVehicleWeightIntoDirectionalNativeTraffic) {
    auto engine = civic::NativeEngine::create({7, 0, civic::SpeedMode::normal});
    ASSERT_TRUE(engine);
    ASSERT_TRUE((*engine)->loadV9(kActiveTrafficSave));
    const auto snapshot = (*engine)->transportation().snapshot();

    auto mapped = civic::resolveLegacyEdgeV9(snapshot.network, "e:n:1,0>n:2,0");
    ASSERT_TRUE(mapped);
    const auto load = std::find_if(snapshot.traffic.loads.begin(), snapshot.traffic.loads.end(), [&](const auto& item) {
        return item.carriageway_id == *mapped;
    });
    ASSERT_NE(load, snapshot.traffic.loads.end());
    EXPECT_DOUBLE_EQ(load->weighted_vehicles, 2.5);
    EXPECT_EQ(snapshot.traffic.loads.size(), 1U);
}

TEST(NativeEngineTransportation, PublishesTypedActiveRoadVehicleContinuationWithNativeRouteIds) {
    auto engine = civic::NativeEngine::create({7, 0, civic::SpeedMode::normal});
    ASSERT_TRUE(engine);
    ASSERT_TRUE((*engine)->loadV9(kActiveTrafficSave));

    const auto& roadTraffic = (*engine)->roadTraffic();
    ASSERT_EQ(roadTraffic.vehicles.size(), 1U);
    const auto& vehicle = roadTraffic.vehicles.front();
    EXPECT_EQ(vehicle.id, "vehicle:1");
    EXPECT_EQ(vehicle.tripId, "trip:1");
    EXPECT_EQ(vehicle.purpose, "commute");
    EXPECT_DOUBLE_EQ(vehicle.travelerWeight, 2.5);
    EXPECT_EQ(vehicle.carriagewayIds.size(), 2U);
    EXPECT_EQ(vehicle.currentCarriagewayIndex, 1U);
    EXPECT_DOUBLE_EQ(vehicle.carriagewayProgressTicks, 3.5);
    EXPECT_EQ(vehicle.departureTick, 4U);
    EXPECT_DOUBLE_EQ(vehicle.accumulatedDelayTicks, 2.0);
    EXPECT_DOUBLE_EQ(vehicle.freeFlowTicks, 8.0);
    EXPECT_EQ(vehicle.status, civic::RoadTrafficVehicleStatusV9::queued);
    ASSERT_TRUE(vehicle.queuedJunctionId.has_value());
    EXPECT_EQ(vehicle.queuedJunctionId->value, "j:legacy:2,0");
    EXPECT_EQ(roadTraffic.nextVehicleId, 2U);
    EXPECT_EQ(roadTraffic.completedTrips, 0U);
    EXPECT_EQ(roadTraffic.failedTrips, 0U);
    EXPECT_EQ(roadTraffic.congestionEpoch, 9U);
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

    auto engine = civic::NativeEngine::create({7, 0, civic::SpeedMode::normal});
    ASSERT_TRUE(engine);
    ASSERT_TRUE((*engine)->loadV9(stale));
    EXPECT_TRUE((*engine)->transportation().snapshot().traffic.loads.empty());
    EXPECT_TRUE((*engine)->roadTraffic().vehicles.empty());
    auto continuation = civic::parseTransportationContinuationV9(stale);
    ASSERT_TRUE(continuation);
    EXPECT_NE(continuation->trafficCanonical.find("e:n:1,0>n:9,9"), std::string::npos);
}
