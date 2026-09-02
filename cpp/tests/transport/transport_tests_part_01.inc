    CHECK_NEAR(control.capacity_factor(ControlType::yield, nullptr, a, 0), 0.80, 1e-9);
    CHECK_NEAR(control.capacity_factor(ControlType::signal, &plan, a, 2), 1.0, 1e-9);
    CHECK_NEAR(control.capacity_factor(ControlType::signal, &plan, a, 7), 0.0, 1e-9);

    IntersectionControlStore store;
    store.upsert(snap, JunctionControl{snap.movements[0].junction_id, ControlType::signal, plan});
    CHECK_NEAR(store.capacity_factor(snap, snap.movements[0].junction_id, a, 2), 1.0, 1e-9);
    auto saved = store.snapshot();
    IntersectionControlStore restored;
    restored.restore(snap, saved);
    CHECK(restored.snapshot() == saved);
    auto bad = saved;
    bad.controls.front().junction_id = JunctionId{"missing:junction"};
    check_throws([&] { restored.restore(snap, bad); });
}

void test_routing_same_node_disconnected_and_tie_break() {
    auto snap = four_way();
    NetworkStore store;
    store.replace(snap);
    RoutingEngine routing;
    GeneralizedCostConfig cost{};

    const JunctionId center{"j:legacy:0,0"};
    auto zero = routing.find_route(store.snapshot(), center, center, permission(VehiclePermission::private_car), cost);
    CHECK(zero.has_value());
    CHECK(zero->carriageway_ids.empty());
    CHECK_NEAR(zero->total_cost, 0.0, 1e-9);

    const JunctionId west{"j:legacy:-1,0"};
    const JunctionId east{"j:legacy:1,0"};
    auto route = routing.find_route(store.snapshot(), west, east, permission(VehiclePermission::private_car), cost);
    CHECK(route.has_value());
    CHECK(route->junction_ids.front() == west);
    CHECK(route->junction_ids.back() == east);

    NetworkSnapshot isolated = snap;
    isolated.junctions.push_back(Junction{JunctionId{"j:island"}, 99, 99, {}});
    isolated.topology_revision++;
    validate_network(isolated);
    CHECK(!routing.find_route(isolated, west, JunctionId{"j:island"}, permission(VehiclePermission::private_car), cost).has_value());
}

void test_parking_and_incident_generalized_cost_and_revision() {
    auto snap = four_way();
    NetworkStore store; store.replace(snap);
    RoutingEngine routing;
    const JunctionId west{"j:legacy:-1,0"};
    const JunctionId east{"j:legacy:1,0"};
    GeneralizedCostConfig base{};
    auto before = routing.find_route(store.snapshot(), west, east, permission(VehiclePermission::private_car), base);
    CHECK(before.has_value());

    ParkingSystem parking;
    parking.upsert(ParkingFacility{ParkingFacilityId{"p:east"}, east, 2.0, 0.0, 15.0, 5.0});
    auto reservation = parking.reserve(ParkingFacilityId{"p:east"}, 1.0);
    CHECK(reservation.has_value());
    CHECK_NEAR(parking.occupancy(ParkingFacilityId{"p:east"}), 1.0, 1e-9);
    auto cost = base;
    cost.destination_parking_cost = parking.generalized_penalty(ParkingFacilityId{"p:east"});
    auto with_parking = routing.find_route(store.snapshot(), west, east, permission(VehiclePermission::private_car), cost);
    CHECK(with_parking.has_value());
    CHECK(with_parking->total_cost > before->total_cost);
