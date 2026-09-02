#include <gtest/gtest.h>

#include <civic/transport/Transportation.hpp>

#include <cmath>
#include <limits>

namespace civic::transport {
namespace {
JunctionId junction(std::int32_t x, std::int32_t y) {
    return JunctionId{"j:legacy:" + std::to_string(x) + "," + std::to_string(y)};
}
LegacyRoadState lineRoad() {
    return {4, {{0, 0, RoadClass::local}, {1, 0, RoadClass::collector}, {2, 0, RoadClass::arterial}}};
}
TransportNetworkSnapshot migrate(const LegacyRoadState& roads) {
    LegacyRoadMigrationAdapter adapter;
    auto migration = adapter.project(roads);
    EXPECT_TRUE(migration.has_value());
    TransportNetworkStore store;
    auto result = store.replaceAuthority(std::move(migration->authority));
    EXPECT_TRUE(result.ok);
    return store.snapshot();
}
} // namespace

TEST(CppTransportationMigration, PreservesDirectionalLegacyCapacity) {
    auto snapshot = migrate({1, {{0, 0, RoadClass::local}, {1, 0, RoadClass::arterial}}});
    ASSERT_EQ(snapshot.carriageways.size(), 2U);
    for (const auto& carriageway : snapshot.carriageways) {
        double capacity = 0.0;
        for (const auto& lane_id : carriageway.laneIds) {
            const auto it = std::ranges::find(snapshot.lanes, lane_id, &Lane::id);
            ASSERT_NE(it, snapshot.lanes.end());
            capacity += it->baseCapacityPerMinute;
        }
        if (carriageway.fromJunctionId == junction(0, 0)) EXPECT_NEAR(capacity, 60.0, 1e-9);
        if (carriageway.fromJunctionId == junction(1, 0)) EXPECT_NEAR(capacity, 240.0, 1e-9);
    }
}

TEST(CppTransportationNetwork, LaneClosuresInvalidateTopologyWithoutInvalidatingAuthority) {
    TransportationEngine engine;
    ASSERT_TRUE(engine.migrateLegacyRoads(lineRoad()).has_value());
    auto before = engine.network().topologyRevision();
    auto lane = engine.network().snapshot().lanes.front().id;
    auto changed = engine.network().setLaneOperatingState(lane, LaneState::closed);
    EXPECT_TRUE(changed.ok);
    EXPECT_TRUE(changed.changed);
    EXPECT_EQ(engine.network().topologyRevision(), before + 1U);
    auto no_op = engine.network().setLaneOperatingState(lane, LaneState::closed);
    EXPECT_TRUE(no_op.ok);
    EXPECT_FALSE(no_op.changed);
}

TEST(CppTransportationRouting, SameNodeRouteIsValidZeroEdge) {
    TransportationEngine engine;
    ASSERT_TRUE(engine.migrateLegacyRoads(lineRoad()).has_value());
    auto result = engine.route(RouteRequest{junction(0, 0), junction(0, 0), RoutePreference{}, 0});
    ASSERT_TRUE(result.has_value());
    EXPECT_TRUE(result->reachable);
    EXPECT_TRUE(result->carriageways.empty());
    EXPECT_DOUBLE_EQ(result->generalizedCost, 0.0);
}

TEST(CppTransportationParkingAndIncidents, CostAndCapacityAffectRouting) {
    TransportationEngine engine;
    ASSERT_TRUE(engine.migrateLegacyRoads(lineRoad()).has_value());
    ParkingFacility parking{ParkingFacilityId{"p1"}, ParkingKind::garage, junction(2, 0), 10, 0, 100, 5};
    ASSERT_TRUE(engine.parking().upsert(parking, engine.network().snapshot()).has_value());
    auto route = engine.route(RouteRequest{junction(0, 0), junction(2, 0), RoutePreference{}, 0});
    ASSERT_TRUE(route.has_value());
    EXPECT_GT(route->generalizedCost, 100.0);
    EXPECT_TRUE(engine.parking().reserve(parking.id, 10).has_value());
    EXPECT_FALSE(engine.parking().reserve(parking.id, 1).has_value());

    const auto network = engine.network().snapshot();
    ASSERT_FALSE(network.carriageways.empty());
    Incident incident{IncidentId{"i1"}, {network.carriageways.front().id}, {}, {}, 0, 10, 0.0, 0.0, 50.0, IncidentState::active};
    ASSERT_TRUE(engine.incidents().upsert(incident, network, 0).has_value());
    auto blocked = engine.route(RouteRequest{network.carriageways.front().fromJunctionId, network.carriageways.front().toJunctionId, RoutePreference{}, 0});
    ASSERT_TRUE(blocked.has_value());
    EXPECT_FALSE(blocked->reachable);
}

TEST(CppTransportationTrafficAndTrips, ConservesWeightedDemandAndRejectsNonFiniteTraffic) {
    CausalTripGenerator generator;
    auto trips = generator.generate(TripCause::home_work, junction(0, 0), 10.0, {{junction(1, 0), 1.0}, {junction(2, 0), 3.0}});
    ASSERT_TRUE(trips.has_value());
    ASSERT_EQ(trips->size(), 2U);
    double total = 0.0;
    for (const auto& trip : *trips) total += trip.travelerWeight;
    EXPECT_NEAR(total, 10.0, 1e-9);
    EXPECT_NEAR(trips->front().travelerWeight, 2.5, 1e-9);

    TransportationEngine engine;
    ASSERT_TRUE(engine.migrateLegacyRoads(lineRoad()).has_value());
    auto groups = buildLaneGroups(engine.network().snapshot());
    ASSERT_TRUE(groups.has_value());
    ASSERT_FALSE(groups->empty());
    EXPECT_FALSE(engine.traffic().setStock(groups->front().id, std::numeric_limits<double>::infinity()).has_value());
}

TEST(CppTransportationModeChoice, DeterministicTieBreakPrefersCar) {
    ModeChoiceSystem choice;
    auto result = choice.choose({{TravelMode::transit, 5.0, true}, {TravelMode::car, 5.0, true}});
    ASSERT_TRUE(result.has_value());
    EXPECT_EQ(result->mode, TravelMode::car);
    EXPECT_FALSE(choice.choose({{TravelMode::car, std::numeric_limits<double>::quiet_NaN(), true}}).has_value());
}

TEST(CppTransportationTransit, FailedVehiclesRequeuePassengersWithoutLoss) {
    TransportationEngine engine;
    ASSERT_TRUE(engine.migrateLegacyRoads(lineRoad()).has_value());
    TransitNetwork transit;
    auto roads = engine.network().snapshot();
    ASSERT_TRUE(transit.upsertStop({TransitStopId{"s0"}, junction(0, 0), "A", true}, roads).has_value());
    ASSERT_TRUE(transit.upsertStop({TransitStopId{"s1"}, junction(1, 0), "B", true}, roads).has_value());
    ASSERT_TRUE(transit.upsertStop({TransitStopId{"s2"}, junction(2, 0), "C", true}, roads).has_value());
    ASSERT_TRUE(transit.upsertLine({TransitLineId{"l1"}, "Line", TransitMode::bus, {TransitStopId{"s0"}, TransitStopId{"s1"}, TransitStopId{"s2"}}, 1.0, 2, 1.0}).has_value());

    PassengerQueueSystem queues;
    PassengerCohort cohort{PassengerCohortId{"c1"}, TripId{"t1"}, 10.0, TransitLineId{"l1"}, "forward", TransitStopId{"s0"}, TransitStopId{"s2"}, junction(2, 0), 0, {}};
    ASSERT_TRUE(queues.enqueue(cohort, transit).has_value());
    TransitOperations operations;
    auto vehicle = operations.dispatch(TransitLineId{"l1"}, 4.0, 0, transit);
    ASSERT_TRUE(vehicle.has_value());
    ASSERT_TRUE(operations.step(0, transit, queues).has_value());
    EXPECT_NEAR(queues.waitingWeight(), 6.0, 1e-9);
    EXPECT_NEAR(operations.onboardWeight(), 4.0, 1e-9);
    ASSERT_TRUE(operations.failVehicle(*vehicle, 0, transit, queues).has_value());
    EXPECT_NEAR(queues.waitingWeight(), 10.0, 1e-9);
    EXPECT_NEAR(operations.onboardWeight(), 0.0, 1e-9);
    EXPECT_NEAR(operations.activeCapacity(), 0.0, 1e-9);
}

TEST(CppTransportationSnapshot, CanonicalHashIsDeterministic) {
    TransportationEngine first;
    TransportationEngine second;
    ASSERT_TRUE(first.migrateLegacyRoads(lineRoad()).has_value());
    ASSERT_TRUE(second.migrateLegacyRoads(lineRoad()).has_value());
    auto a = first.snapshot();
    auto b = second.snapshot();
    ASSERT_TRUE(a.has_value());
    ASSERT_TRUE(b.has_value());
    EXPECT_EQ(canonicalHash(*a), canonicalHash(*b));
}

} // namespace civic::transport
