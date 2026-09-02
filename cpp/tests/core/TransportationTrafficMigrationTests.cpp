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

TEST(NativeEngineTransportation, PublishesActiveRoadVehiclesInsideTransportationSnapshot) {
    auto engine = civic::NativeEngine::create({7, 0, civic::SpeedMode::normal});
    ASSERT_TRUE(engine);
    ASSERT_TRUE((*engine)->loadV9(kActiveTrafficSave));

    const auto snapshot = (*engine)->transportation().snapshot();
    const auto& roadTraffic = snapshot.road_traffic;
    ASSERT_EQ(roadTraffic.vehicles.size(), 1U);
    const auto& vehicle = roadTraffic.vehicles.front();
    EXPECT_EQ(vehicle.id, "vehicle:1");
    EXPECT_EQ(vehicle.trip_id.value, "trip:1");
    EXPECT_EQ(vehicle.cause, civic::transport::TripCause::home_to_work);
    EXPECT_DOUBLE_EQ(vehicle.traveler_weight, 2.5);
    EXPECT_EQ(vehicle.carriageway_ids.size(), 2U);
    EXPECT_EQ(vehicle.current_carriageway_index, 1U);
    EXPECT_DOUBLE_EQ(vehicle.carriageway_progress_ticks, 3.5);
    EXPECT_EQ(vehicle.departure_tick, 4U);
    EXPECT_DOUBLE_EQ(vehicle.accumulated_delay_ticks, 2.0);
    EXPECT_DOUBLE_EQ(vehicle.free_flow_ticks, 8.0);
    EXPECT_EQ(vehicle.status, civic::transport::RoadVehicleStatus::queued);
    ASSERT_TRUE(vehicle.queued_junction_id.has_value());
    EXPECT_EQ(vehicle.queued_junction_id->value, "j:legacy:2,0");
    EXPECT_EQ(roadTraffic.next_vehicle_id, 2U);
    EXPECT_EQ(roadTraffic.completed_trips, 0U);
    EXPECT_EQ(roadTraffic.failed_trips, 0U);
    EXPECT_EQ(roadTraffic.congestion_epoch, 9U);
}

TEST(NativeEngineTransportation, ClampsRestoredNextVehicleIdLikeTypeScriptTrafficState) {
    auto save = kActiveTrafficSave;
    const auto offset = save.find("\"nextVehicleId\":2");
    ASSERT_NE(offset, std::string::npos);
    save.replace(offset, std::string{"\"nextVehicleId\":2"}.size(), "\"nextVehicleId\":0");

    auto engine = civic::NativeEngine::create({7, 0, civic::SpeedMode::normal});
    ASSERT_TRUE(engine);
    ASSERT_TRUE((*engine)->loadV9(save));
    EXPECT_EQ((*engine)->transportation().snapshot().road_traffic.next_vehicle_id, 1U);
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
    const auto snapshot = (*engine)->transportation().snapshot();
    EXPECT_TRUE(snapshot.traffic.loads.empty());
    EXPECT_TRUE(snapshot.road_traffic.vehicles.empty());
    auto continuation = civic::parseTransportationContinuationV9(stale);
    ASSERT_TRUE(continuation);
    EXPECT_NE(continuation->trafficCanonical.find("e:n:1,0>n:9,9"), std::string::npos);
}
