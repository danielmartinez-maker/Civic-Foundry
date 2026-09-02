void test_native_road_traffic_progression_and_incident_conservation() {
    LegacyRoadAdapter adapter;
    const auto network = adapter.project({
        {0, 0, RoadClass::local},
        {1, 0, RoadClass::local},
        {2, 0, RoadClass::local},
    }, 21);

    RoutingEngine routing;
    const auto route = routing.find_route(
        network,
        JunctionId{"j:legacy:0,0"},
        JunctionId{"j:legacy:2,0"},
        permission(VehiclePermission::private_car),
        GeneralizedCostConfig{});
    CHECK(route.has_value());
    if (!route) return;

    RoadTrafficState traffic;
    const RoadTripSubmission submission{
        TripId{"trip:runtime"},
        TripCause::home_to_work,
        2.5,
        "building:home",
        "building:work",
        *route,
        0,
    };
    const auto vehicle_id = traffic.submit(network, submission);
    CHECK(vehicle_id.has_value());
    CHECK(traffic.snapshot().vehicles.size() == 1);
    CHECK_NEAR(traffic.flow_snapshot().loads.front().weighted_vehicles, 2.5, 1e-9);

    IntersectionControlStore controls;
    IncidentSystem incidents;
    const auto first_carriageway = route->carriageway_ids.front();
    incidents.upsert(Incident{
        IncidentId{"incident:block"},
        first_carriageway,
        0.0,
        0.0,
        IncidentState::active,
        1,
        0,
    });

    const auto blocked = traffic.step(network, controls, incidents, 1);
    CHECK(blocked.completed_weight == 0.0);
    CHECK(blocked.failed_weight == 0.0);
    CHECK(blocked.active_vehicle_count == 1);
    const auto blocked_snapshot = traffic.snapshot();
    CHECK(blocked_snapshot.vehicles.front().status == RoadVehicleStatus::queued);
    CHECK_NEAR(blocked_snapshot.vehicles.front().traveler_weight, 2.5, 1e-9);

    incidents.clear(IncidentId{"incident:block"});
    double completed_weight = 0.0;
    for (std::uint64_t tick = 2; tick < 20 && traffic.snapshot().vehicles.size() > 0; ++tick) {
        completed_weight += traffic.step(network, controls, incidents, tick).completed_weight;
    }
    CHECK(traffic.snapshot().vehicles.empty());
    CHECK_NEAR(completed_weight, 2.5, 1e-9);
    CHECK(traffic.snapshot().completed_trips == 1);
    CHECK(traffic.snapshot().failed_trips == 0);
}

void test_native_same_node_road_trip_completes_without_active_vehicle() {
    LegacyRoadAdapter adapter;
    const auto network = adapter.project({{4, 4, RoadClass::local}}, 22);
    RoutingEngine routing;
    const auto route = routing.find_route(
        network,
        JunctionId{"j:legacy:4,4"},
        JunctionId{"j:legacy:4,4"},
        permission(VehiclePermission::private_car),
        GeneralizedCostConfig{});
    CHECK(route.has_value());
    if (!route) return;

    RoadTrafficState traffic;
    const auto vehicle_id = traffic.submit(network, RoadTripSubmission{
        TripId{"trip:same-node"},
        TripCause::home_to_shopping,
        1.25,
        "building:a",
        "building:a",
        *route,
        0,
    });
    CHECK(!vehicle_id.has_value());
    CHECK(traffic.snapshot().vehicles.empty());
    CHECK(traffic.snapshot().completed_trips == 1);
}
