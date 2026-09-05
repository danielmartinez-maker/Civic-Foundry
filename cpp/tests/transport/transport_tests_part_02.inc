    parking.release(*reservation);
    CHECK_NEAR(parking.occupancy(ParkingFacilityId{"p:east"}), 0.0, 1e-9);

    IncidentSystem incidents;
    const auto affected = before->carriageway_ids.front();
    auto old_epoch = incidents.cost_revision();
    incidents.upsert(Incident{IncidentId{"incident:1"}, affected, 0.25, 0.5, IncidentState::active, 10, 20});
    CHECK(incidents.cost_revision() > old_epoch);
    cost.destination_parking_cost = 0;
    cost.incident_penalty = [&](const CarriagewayId& id) { return incidents.route_penalty(id); };
    auto disrupted = routing.find_route(store.snapshot(), west, east, permission(VehiclePermission::private_car), cost);
    CHECK(disrupted.has_value());
    CHECK(disrupted->total_cost > before->total_cost);
}

void test_lane_aware_traffic_and_finite_input() {
    TrafficFlowState traffic;
    auto snap = four_way();
    const auto cw = snap.carriageways.front().id;
    traffic.set_load(cw, 12.5);
    const auto metric = traffic.metric(snap, cw, 1.0);
    CHECK_NEAR(metric.weighted_vehicles, 12.5, 1e-9);
    CHECK(metric.capacity_per_minute > 0);
    CHECK(metric.travel_time_multiplier >= 1.0);
    auto blocked = snap;
    for (auto& lane : blocked.lanes) if (lane.carriageway_id == cw) lane.base_capacity_per_minute = 0.0;
    const auto blocked_metric = traffic.metric(blocked, cw, 1.0);
    CHECK(std::isfinite(blocked_metric.utilization));
    CHECK(std::isfinite(blocked_metric.travel_time_multiplier));
    CHECK(std::isfinite(blocked_metric.speed_kph));
    check_throws([&] { traffic.set_load(cw, std::numeric_limits<double>::infinity()); });
    check_throws([&] { traffic.set_load(cw, -1.0); });
}

void test_causal_trip_conservation() {
    TripGenerator generator(1234);
    std::vector<TripSource> sources{
        {"home:a", 3.25}, {"home:b", 1.75}
    };
    std::vector<std::string> destinations{"job:a", "job:b"};
    auto trips = generator.generate(TripCause::home_to_work, sources, destinations, 55);
    double total = 0;
    for (const auto& trip : trips) total += trip.traveler_weight;
    CHECK_NEAR(total, 5.0, 1e-9);
    CHECK(trips.size() == 2);
}

void test_mode_choice() {
    ModeChoice chooser;
    ModeChoiceInput input{};
    input.car = ModeAlternative{true, 30, 0, 0, 2, 3, 0, 0, 0};
    input.transit = ModeAlternative{true, 20, 4, 1, 0, 0, 0, 0, 0};
    CHECK(chooser.choose(input).mode == TravelMode::transit);
    input.transit.available = false;
    CHECK(chooser.choose(input).mode == TravelMode::car);
}

void test_transit_network_and_passenger_conservation_restore() {
    TransitNetwork network;
    network.upsert_stop(TransitStop{TransitStopId{"stop:a"}, 0, 0, TransitMode::bus});
    network.upsert_stop(TransitStop{TransitStopId{"stop:b"}, 1, 0, TransitMode::bus});
    network.upsert_line(TransitLine{TransitLineId{"line:1"}, TransitMode::bus, {TransitStopId{"stop:a"}, TransitStopId{"stop:b"}}, 10.0, 60, true});
    validate_transit(network.snapshot());

    PassengerQueues queues;
