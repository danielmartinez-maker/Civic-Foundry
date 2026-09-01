    PassengerCohort cohort{PassengerCohortId{"cohort:1"}, TripId{"trip:1"}, 7.5, TransitLineId{"line:1"}, "out", TransitStopId{"stop:a"}, TransitStopId{"stop:b"}, {}, 0};
    CHECK(queues.enqueue(cohort));
    const auto board = queues.board(TransitStopId{"stop:a"}, TransitLineId{"line:1"}, "out", 3.0);
    CHECK_NEAR(board.boarded_weight, 3.0, 1e-9);
    CHECK_NEAR(queues.total_waiting_weight(), 4.5, 1e-9);
    CHECK_NEAR(board.boarded_weight + queues.total_waiting_weight(), 7.5, 1e-9);

    auto qsave = queues.snapshot();
    PassengerQueues restored;
    restored.restore(qsave);
    CHECK_NEAR(restored.total_waiting_weight(), 4.5, 1e-9);
    auto dup = qsave;
    dup.queues.push_back(dup.queues.front());
    check_throws([&] { restored.restore(dup); });
}

void test_transit_operations_dwell_board_transfer_complete() {
    TransitNetwork network;
    network.upsert_stop(TransitStop{TransitStopId{"stop:a"}, 0, 0, TransitMode::bus});
    network.upsert_stop(TransitStop{TransitStopId{"stop:b"}, 1, 0, TransitMode::bus});
    network.upsert_stop(TransitStop{TransitStopId{"stop:c"}, 2, 0, TransitMode::bus});
    network.upsert_line(TransitLine{TransitLineId{"line:1"}, TransitMode::bus, {TransitStopId{"stop:a"}, TransitStopId{"stop:b"}}, 1, 10, true});
    network.upsert_line(TransitLine{TransitLineId{"line:2"}, TransitMode::bus, {TransitStopId{"stop:b"}, TransitStopId{"stop:c"}}, 1, 10, true});

    PassengerQueues queues;
    PassengerCohort passenger{
        PassengerCohortId{"cohort:transfer"}, TripId{"trip:transfer"}, 4.0,
        TransitLineId{"line:1"}, "out", TransitStopId{"stop:a"}, TransitStopId{"stop:b"},
        {TransferLeg{TransitLineId{"line:2"}, "out", TransitStopId{"stop:b"}, TransitStopId{"stop:c"}}}, 0
    };
    CHECK(queues.enqueue(passenger));

    TransitOperations first;
    first.add_vehicle(TransitVehicle{TransitRunId{"run:1"}, TransitLineId{"line:1"}, 10, TransitVehicleState::in_service, 0});
    auto s0 = first.step(network.snapshot(), queues, 0, 1);
    CHECK_NEAR(s0.boarded_weight, 4.0, 1e-9);
    CHECK_NEAR(first.total_onboard_weight(), 4.0, 1e-9);
    (void) first.step(network.snapshot(), queues, 1, 1);
    auto s2 = first.step(network.snapshot(), queues, 2, 1);
    CHECK_NEAR(s2.completed_weight, 0.0, 1e-9);
    CHECK_NEAR(queues.waiting_weight(TransitStopId{"stop:b"}, TransitLineId{"line:2"}, "out"), 4.0, 1e-9);
    CHECK_NEAR(first.total_onboard_weight(), 0.0, 1e-9);

    TransitOperations second;
    second.add_vehicle(TransitVehicle{TransitRunId{"run:2"}, TransitLineId{"line:2"}, 10, TransitVehicleState::in_service, 0});
    auto b0 = second.step(network.snapshot(), queues, 3, 1);
    CHECK_NEAR(b0.boarded_weight, 4.0, 1e-9);
    (void) second.step(network.snapshot(), queues, 4, 1);
    auto b2 = second.step(network.snapshot(), queues, 5, 1);
    CHECK_NEAR(b2.completed_weight, 4.0, 1e-9);
    CHECK_NEAR(second.total_onboard_weight(), 0.0, 1e-9);
    CHECK_NEAR(queues.total_waiting_weight(), 0.0, 1e-9);
}

