    changed = state;
    changed.parking.next_reservation_id = 42;
    restored.restore(changed);
    CHECK(restored.domain_hash() != hash);

    auto dangling = state;
    dangling.incidents.incidents.front().carriageway_id = CarriagewayId{"missing:cw"};
    check_throws([&] { restored.restore(dangling); });
    dangling = state;
    dangling.parking.facilities.front().access_junction_id = JunctionId{"missing:junction"};
    check_throws([&] { restored.restore(dangling); });
}
}

int main() {
    test_legacy_projection_and_network_invariants();
    test_intersection_control_conflicts();
    test_signal_cycle_and_control_capacity();
    test_routing_same_node_disconnected_and_tie_break();
    test_parking_and_incident_generalized_cost_and_revision();
    test_lane_aware_traffic_and_finite_input();
    test_causal_trip_conservation();
    test_mode_choice();
    test_transit_network_and_passenger_conservation_restore();
    test_transit_operations_dwell_board_transfer_complete();
    test_transit_vehicle_failure_preserves_passengers();
    test_multimodal_transfer_and_crowding_capacity();
    test_snapshot_roundtrip_and_hash();
    test_native_road_traffic_progression_and_incident_conservation();
    test_native_same_node_road_trip_completes_without_active_vehicle();
    if (failures) { std::cerr << failures << " failure(s)\n"; return 1; }
    std::cout << "transport tests passed\n";
    return 0;
}
