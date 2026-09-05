void test_transit_vehicle_failure_preserves_passengers() {
    TransitOperations ops;
    TransitVehicle vehicle{TransitRunId{"run:1"}, TransitLineId{"line:1"}, 10.0, TransitVehicleState::in_service, 0};
    PassengerCohort cohort{PassengerCohortId{"cohort:x"}, TripId{"trip:x"}, 4.0, TransitLineId{"line:1"}, "out", TransitStopId{"stop:a"}, TransitStopId{"stop:b"}, {}, 0};
    ops.add_vehicle(vehicle);
    ops.set_onboard(vehicle.run_id, {cohort});
    auto stranded = ops.fail_vehicle(vehicle.run_id);
    CHECK_NEAR(stranded_weight(stranded), 4.0, 1e-9);
    CHECK_NEAR(ops.total_onboard_weight(), 0.0, 1e-9);
}

void test_multimodal_transfer_and_crowding_capacity() {
    auto roads = four_way();
    TransitNetwork network;
    network.upsert_stop(TransitStop{TransitStopId{"stop:w"}, -1, 0, TransitMode::bus});
    network.upsert_stop(TransitStop{TransitStopId{"stop:c"}, 0, 0, TransitMode::bus});
    network.upsert_stop(TransitStop{TransitStopId{"stop:e"}, 1, 0, TransitMode::bus});
    network.upsert_line(TransitLine{TransitLineId{"line:w-c"}, TransitMode::bus, {TransitStopId{"stop:w"}, TransitStopId{"stop:c"}}, 1.0, 30, true});
    network.upsert_line(TransitLine{TransitLineId{"line:c-e"}, TransitMode::bus, {TransitStopId{"stop:c"}, TransitStopId{"stop:e"}}, 1.0, 30, true});
    GeneralizedCostConfig expensive_car{};
    expensive_car.travel_time_weight = 10.0;
    MultimodalJourneyPlanner planner;
    auto plan = planner.plan(roads, network.snapshot(), JunctionId{"j:legacy:-1,0"}, JunctionId{"j:legacy:1,0"}, expensive_car);
    CHECK(plan.has_value());
    CHECK(plan->legs.size() == 2);
    CHECK(plan->legs[0].mode == TravelMode::transit);
    CHECK(plan->legs[1].mode == TravelMode::transit);

    TransitOperations ops;
    ops.add_vehicle(TransitVehicle{TransitRunId{"run:active"}, TransitLineId{"line:w-c"}, 10, TransitVehicleState::in_service, 0});
    ops.add_vehicle(TransitVehicle{TransitRunId{"run:dead"}, TransitLineId{"line:w-c"}, 90, TransitVehicleState::out_of_service, 0});
    CHECK_NEAR(ops.in_service_capacity(), 10.0, 1e-9);
}

void test_snapshot_roundtrip_and_hash() {
    TransportationAuthority engine;
    engine.load_network(four_way());
    engine.parking().upsert(ParkingFacility{ParkingFacilityId{"p:1"}, JunctionId{"j:legacy:1,0"}, 10, 2, 3, 1});
    engine.incidents().upsert(Incident{IncidentId{"i:1"}, engine.network().snapshot().carriageways.front().id, .5, .8, IncidentState::active, 2, 9});
    engine.traffic().set_load(engine.network().snapshot().carriageways.front().id, 8.25);
    auto state = engine.snapshot();
    const auto hash = engine.domain_hash();

    TransportationAuthority restored;
    restored.restore(state);
    CHECK(restored.domain_hash() == hash);
    CHECK(restored.snapshot() == state);
    CHECK_NEAR(restored.traffic().total_load(), 8.25, 1e-9);

    auto changed = state;
    changed.network.segments.front().condition = 0.77;
    restored.restore(changed);
    CHECK(restored.domain_hash() != hash);
