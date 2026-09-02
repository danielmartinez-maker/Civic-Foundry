#include <civic/transport/transport_engine.hpp>

#include <cmath>
#include <iomanip>
#include <iostream>
#include <numeric>
#include <string>
#include <vector>

using namespace civic::transport;

namespace {
NetworkSnapshot four_way() {
    LegacyRoadAdapter adapter;
    return adapter.project(
        {
            {0, 0, RoadClass::local},
            {-1, 0, RoadClass::local},
            {1, 0, RoadClass::collector},
            {0, -1, RoadClass::arterial},
            {0, 1, RoadClass::local},
        },
        7);
}

double cohort_weight(const std::vector<PassengerCohort>& cohorts) {
    return std::accumulate(cohorts.begin(), cohorts.end(), 0.0, [](double total, const PassengerCohort& cohort) {
        return total + cohort.traveler_weight;
    });
}
} // namespace

int main() {
    std::cout << std::setprecision(17) << std::boolalpha;

    std::vector<TripSource> trip_sources;
    trip_sources.reserve(100);
    for (int index = 0; index < 100; ++index) {
        trip_sources.push_back(TripSource{"home:" + std::to_string(index), 0.01});
    }
    TripGenerator trip_generator(17);
    const auto trips = trip_generator.generate(
        TripCause::home_to_work,
        trip_sources,
        {"job:1"},
        10);
    double trip_weight = 0.0;
    for (const auto& trip : trips) trip_weight += trip.traveler_weight;

    PassengerQueues split_queues;
    const PassengerCohort split_cohort{
        PassengerCohortId{"cohort:split"},
        TripId{"trip:split"},
        10.0,
        TransitLineId{"line:1"},
        "outbound",
        TransitStopId{"stop:a"},
        TransitStopId{"stop:b"},
        {},
        0,
    };
    split_queues.enqueue(split_cohort);
    const auto split_board = split_queues.board(
        TransitStopId{"stop:a"},
        TransitLineId{"line:1"},
        "outbound",
        6.0);

    TransitNetwork completion_network;
    completion_network.upsert_stop(TransitStop{TransitStopId{"stop:a"}, 0, 0, TransitMode::bus});
    completion_network.upsert_stop(TransitStop{TransitStopId{"stop:b"}, 1, 0, TransitMode::bus});
    completion_network.upsert_line(TransitLine{
        TransitLineId{"line:1"},
        TransitMode::bus,
        {TransitStopId{"stop:a"}, TransitStopId{"stop:b"}},
        2.0,
        20,
        true,
    });
    PassengerQueues completion_queues;
    completion_queues.enqueue(PassengerCohort{
        PassengerCohortId{"cohort:completion"},
        TripId{"trip:completion"},
        80.0,
        TransitLineId{"line:1"},
        "out",
        TransitStopId{"stop:a"},
        TransitStopId{"stop:b"},
        {},
        0,
    });
    TransitOperations completion_ops;
    completion_ops.add_vehicle(TransitVehicle{
        TransitRunId{"run:completion"},
        TransitLineId{"line:1"},
        60.0,
        TransitVehicleState::in_service,
        0,
    });
    const auto completion_step_0 = completion_ops.step(completion_network.snapshot(), completion_queues, 0, 1);
    (void)completion_ops.step(completion_network.snapshot(), completion_queues, 1, 1);
    const auto completion_step_2 = completion_ops.step(completion_network.snapshot(), completion_queues, 2, 1);

    TransitOperations failure_ops;
    const TransitVehicle failure_vehicle{
        TransitRunId{"run:failure"},
        TransitLineId{"line:failure"},
        10.0,
        TransitVehicleState::in_service,
        0,
    };
    failure_ops.add_vehicle(failure_vehicle);
    failure_ops.set_onboard(
        failure_vehicle.run_id,
        {PassengerCohort{
            PassengerCohortId{"cohort:failure"},
            TripId{"trip:failure"},
            4.0,
            TransitLineId{"line:failure"},
            "out",
            TransitStopId{"stop:a"},
            TransitStopId{"stop:b"},
            {},
            0,
        }});
    const auto stranded = failure_ops.fail_vehicle(failure_vehicle.run_id);

    TransitOperations crowding_ops;
    const TransitVehicle active_vehicle{
        TransitRunId{"run:active"},
        TransitLineId{"line:crowding"},
        10.0,
        TransitVehicleState::in_service,
        0,
    };
    crowding_ops.add_vehicle(active_vehicle);
    crowding_ops.set_onboard(
        active_vehicle.run_id,
        {PassengerCohort{
            PassengerCohortId{"cohort:crowding"},
            TripId{"trip:crowding"},
            5.0,
            TransitLineId{"line:crowding"},
            "out",
            TransitStopId{"stop:a"},
            TransitStopId{"stop:b"},
            {},
            0,
        }});
    crowding_ops.add_vehicle(TransitVehicle{
        TransitRunId{"run:out"},
        TransitLineId{"line:crowding"},
        90.0,
        TransitVehicleState::out_of_service,
        0,
    });
    const double in_service_capacity = crowding_ops.in_service_capacity();
    const double onboard_weight = crowding_ops.total_onboard_weight();
    const double crowding = in_service_capacity <= 0.0 ? 0.0 : onboard_weight / in_service_capacity;

    const auto network = four_way();
    const auto carriageway = network.carriageways.front().id;
    TrafficFlowState traffic;
    traffic.set_load(carriageway, 12.5);
    const auto traffic_metric = traffic.metric(network, carriageway, 1.0);
    auto blocked = network;
    for (auto& lane : blocked.lanes) {
        if (lane.carriageway_id == carriageway) lane.base_capacity_per_minute = 0.0;
    }
    const auto blocked_metric = traffic.metric(blocked, carriageway, 1.0);

    ParkingSystem parking;
    parking.upsert(ParkingFacility{
        ParkingFacilityId{"parking:destination"},
        JunctionId{"j:legacy:1,0"},
        10.0,
        2.0,
        3.0,
        1.0,
    });
    const double parking_before = parking.generalized_penalty(ParkingFacilityId{"parking:destination"});
    const auto reservation = parking.reserve(ParkingFacilityId{"parking:destination"}, 7.0);
    const double parking_after = parking.generalized_penalty(ParkingFacilityId{"parking:destination"});

    IncidentSystem incidents;
    incidents.upsert(Incident{
        IncidentId{"incident:1"},
        carriageway,
        0.25,
        0.5,
        IncidentState::active,
        10,
        20,
    });

    std::cout
        << "{\"tripConservation\":{\"count\":" << trips.size()
        << ",\"totalWeight\":" << trip_weight
        << "},\"passengerSplit\":{\"boardedWeight\":" << split_board.boarded_weight
        << ",\"waitingWeight\":" << split_queues.total_waiting_weight()
        << ",\"totalWeight\":" << split_board.boarded_weight + split_queues.total_waiting_weight()
        << "},\"transitCompletion\":{\"boardedWeight\":" << completion_step_0.boarded_weight
        << ",\"completedWeight\":" << completion_step_2.completed_weight
        << ",\"waitingWeight\":" << completion_queues.total_waiting_weight()
        << "},\"vehicleFailure\":{\"strandedWeight\":" << cohort_weight(stranded)
        << ",\"onboardAfter\":" << failure_ops.total_onboard_weight()
        << "},\"crowding\":{\"inServiceCapacity\":" << in_service_capacity
        << ",\"onboardWeight\":" << onboard_weight
        << ",\"ratio\":" << crowding
        << "},\"congestion\":{\"weightedVehicles\":" << traffic_metric.weighted_vehicles
        << ",\"capacityPerMinute\":" << traffic_metric.capacity_per_minute
        << ",\"utilization\":" << traffic_metric.utilization
        << ",\"travelTimeMultiplier\":" << traffic_metric.travel_time_multiplier
        << ",\"speedKph\":" << traffic_metric.speed_kph
        << ",\"blockedFinite\":"
        << (std::isfinite(blocked_metric.utilization)
            && std::isfinite(blocked_metric.travel_time_multiplier)
            && std::isfinite(blocked_metric.speed_kph))
        << "},\"parking\":{\"reservationSucceeded\":" << reservation.has_value()
        << ",\"occupancy\":" << parking.occupancy(ParkingFacilityId{"parking:destination"})
        << ",\"penaltyBefore\":" << parking_before
        << ",\"penaltyAfter\":" << parking_after
        << "},\"incident\":{\"capacityFactor\":" << incidents.capacity_factor(carriageway)
        << ",\"speedFactor\":" << incidents.speed_factor(carriageway)
        << ",\"routePenalty\":" << incidents.route_penalty(carriageway)
        << ",\"costRevision\":" << incidents.cost_revision()
        << "}}\n";
    return 0;
}
