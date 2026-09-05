#include <civic/persistence/TransportationSaveV9.hpp>

#include <json-c/json.h>

#include <cmath>
#include <limits>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace civic {
namespace {
using JsonPtr = std::unique_ptr<json_object, decltype(&json_object_put)>;

[[noreturn]] void invalid(std::string message) { throw std::runtime_error(std::move(message)); }

json_object* field(json_object* object, const char* name) {
    if (!object || json_object_get_type(object) != json_type_object) invalid("nativeTransportation object expected");
    json_object* value = nullptr;
    return json_object_object_get_ex(object, name, &value) ? value : nullptr;
}
json_object* required(json_object* object, const char* name, json_type type) {
    auto* value = field(object, name);
    if (!value || json_object_get_type(value) != type) invalid(std::string{"nativeTransportation field has invalid type: "} + name);
    return value;
}
std::string stringField(json_object* object, const char* name, bool allowEmpty = false) {
    const auto value = std::string{json_object_get_string(required(object, name, json_type_string))};
    if (!allowEmpty && value.empty()) invalid(std::string{"nativeTransportation field must not be empty: "} + name);
    return value;
}
std::uint64_t uintField(json_object* object, const char* name) {
    auto* value = required(object, name, json_type_int);
    const auto raw = json_object_get_int64(value);
    if (raw < 0) invalid(std::string{"nativeTransportation field must be non-negative: "} + name);
    return static_cast<std::uint64_t>(raw);
}
std::size_t sizeField(json_object* object, const char* name) {
    const auto value = uintField(object, name);
    if (value > std::numeric_limits<std::size_t>::max()) invalid(std::string{"nativeTransportation field exceeds size_t: "} + name);
    return static_cast<std::size_t>(value);
}
double numberField(json_object* object, const char* name) {
    auto* value = field(object, name);
    if (!value || (json_object_get_type(value) != json_type_double && json_object_get_type(value) != json_type_int)) invalid(std::string{"nativeTransportation numeric field has invalid type: "} + name);
    const double result = json_object_get_double(value);
    if (!std::isfinite(result)) invalid(std::string{"nativeTransportation numeric field must be finite: "} + name);
    return result;
}
bool boolField(json_object* object, const char* name) { return json_object_get_boolean(required(object, name, json_type_boolean)) != 0; }

template<class Id>
std::vector<Id> ids(json_object* object, const char* name) {
    auto* values = required(object, name, json_type_array);
    std::vector<Id> result;
    result.reserve(json_object_array_length(values));
    for (std::size_t index = 0; index < json_object_array_length(values); ++index) {
        auto* raw = json_object_array_get_idx(values, index);
        if (!raw || json_object_get_type(raw) != json_type_string || std::string_view{json_object_get_string(raw)}.empty()) invalid(std::string{"nativeTransportation contains invalid id in "} + name);
        result.emplace_back(json_object_get_string(raw));
    }
    return result;
}
std::vector<std::string> strings(json_object* object, const char* name) {
    auto* values = required(object, name, json_type_array);
    std::vector<std::string> result;
    result.reserve(json_object_array_length(values));
    for (std::size_t index = 0; index < json_object_array_length(values); ++index) {
        auto* raw = json_object_array_get_idx(values, index);
        if (!raw || json_object_get_type(raw) != json_type_string) invalid(std::string{"nativeTransportation contains invalid string in "} + name);
        result.emplace_back(json_object_get_string(raw));
    }
    return result;
}

transport::RoadClass roadClass(std::string_view value) {
    if (value == "local") return transport::RoadClass::local;
    if (value == "collector") return transport::RoadClass::collector;
    if (value == "arterial") return transport::RoadClass::arterial;
    if (value == "avenue") return transport::RoadClass::avenue;
    if (value == "expressway") return transport::RoadClass::expressway;
    if (value == "highway") return transport::RoadClass::highway;
    invalid("invalid nativeTransportation road class");
}
transport::Direction direction(std::string_view value) {
    if (value == "forward") return transport::Direction::forward;
    if (value == "backward") return transport::Direction::backward;
    invalid("invalid nativeTransportation direction");
}
transport::LaneType laneType(std::string_view value) {
    if (value == "through") return transport::LaneType::through;
    if (value == "turn") return transport::LaneType::turn;
    if (value == "bus") return transport::LaneType::bus;
    if (value == "bike") return transport::LaneType::bike;
    if (value == "parking") return transport::LaneType::parking;
    if (value == "reversible") return transport::LaneType::reversible;
    if (value == "shoulder") return transport::LaneType::shoulder;
    invalid("invalid nativeTransportation lane type");
}
transport::MovementType movementType(std::string_view value) {
    if (value == "left") return transport::MovementType::left;
    if (value == "through") return transport::MovementType::through;
    if (value == "right") return transport::MovementType::right;
    if (value == "u-turn") return transport::MovementType::u_turn;
    invalid("invalid nativeTransportation movement type");
}
transport::ControlType controlType(std::string_view value) {
    if (value == "uncontrolled") return transport::ControlType::uncontrolled;
    if (value == "stop") return transport::ControlType::stop;
    if (value == "yield") return transport::ControlType::yield;
    if (value == "signal") return transport::ControlType::signal;
    invalid("invalid nativeTransportation control type");
}
transport::IncidentState incidentState(std::string_view value) {
    if (value == "planned") return transport::IncidentState::planned;
    if (value == "active") return transport::IncidentState::active;
    if (value == "clearing") return transport::IncidentState::clearing;
    if (value == "cleared") return transport::IncidentState::cleared;
    invalid("invalid nativeTransportation incident state");
}
transport::TripCause tripCause(std::string_view value) {
    if (value == "home_to_work") return transport::TripCause::home_to_work;
    if (value == "home_to_school") return transport::TripCause::home_to_school;
    if (value == "home_to_shopping") return transport::TripCause::home_to_shopping;
    if (value == "firm_to_supplier") return transport::TripCause::firm_to_supplier;
    if (value == "warehouse_to_customer") return transport::TripCause::warehouse_to_customer;
    if (value == "incident_to_facility") return transport::TripCause::incident_to_facility;
    if (value == "construction_to_supplier") return transport::TripCause::construction_to_supplier;
    invalid("invalid nativeTransportation trip cause");
}
transport::RoadVehicleStatus roadVehicleStatus(std::string_view value) {
    if (value == "moving") return transport::RoadVehicleStatus::moving;
    if (value == "queued") return transport::RoadVehicleStatus::queued;
    invalid("invalid nativeTransportation road vehicle status");
}
transport::TransitMode transitMode(std::string_view value) {
    if (value == "bus") return transport::TransitMode::bus;
    if (value == "tram") return transport::TransitMode::tram;
    if (value == "metro") return transport::TransitMode::metro;
    if (value == "rail") return transport::TransitMode::rail;
    if (value == "ferry") return transport::TransitMode::ferry;
    invalid("invalid nativeTransportation transit mode");
}
transport::TransitVehicleState transitVehicleState(std::string_view value) {
    if (value == "in_service") return transport::TransitVehicleState::in_service;
    if (value == "out_of_service") return transport::TransitVehicleState::out_of_service;
    if (value == "failed") return transport::TransitVehicleState::failed;
    invalid("invalid nativeTransportation transit vehicle state");
}

transport::PassengerCohort cohort(json_object* object) {
    transport::PassengerCohort result;
    result.id = transport::PassengerCohortId{stringField(object, "id")};
    result.trip_id = transport::TripId{stringField(object, "tripId")};
    result.traveler_weight = numberField(object, "travelerWeight");
    result.line_id = transport::TransitLineId{stringField(object, "lineId")};
    result.direction_key = stringField(object, "directionKey");
    result.boarding_stop_id = transport::TransitStopId{stringField(object, "boardingStopId")};
    result.alighting_stop_id = transport::TransitStopId{stringField(object, "alightingStopId")};
    result.enqueued_tick = uintField(object, "enqueuedTick");
    auto* legs = required(object, "transferLegs", json_type_array);
    result.transfer_legs.reserve(json_object_array_length(legs));
    for (std::size_t index = 0; index < json_object_array_length(legs); ++index) {
        auto* raw = json_object_array_get_idx(legs, index);
        if (!raw || json_object_get_type(raw) != json_type_object) invalid("invalid nativeTransportation transfer leg");
        result.transfer_legs.push_back({transport::TransitLineId{stringField(raw, "lineId")}, stringField(raw, "directionKey"), transport::TransitStopId{stringField(raw, "boardingStopId")}, transport::TransitStopId{stringField(raw, "alightingStopId")}});
    }
    return result;
}

transport::NetworkSnapshot network(json_object* object) {
    transport::NetworkSnapshot result;
    result.topology_revision = uintField(object, "topologyRevision");
    result.cost_revision = uintField(object, "costRevision");
    auto* junctions = required(object, "junctions", json_type_array);
    result.junctions.reserve(json_object_array_length(junctions));
    for (std::size_t index = 0; index < json_object_array_length(junctions); ++index) {
        auto* raw = json_object_array_get_idx(junctions, index); if (!raw || json_object_get_type(raw) != json_type_object) invalid("invalid nativeTransportation junction");
        result.junctions.push_back({transport::JunctionId{stringField(raw,"id")}, numberField(raw,"x"), numberField(raw,"y"), stringField(raw,"sourceLegacyCell",true)});
    }
    auto* segments = required(object, "segments", json_type_array);
    result.segments.reserve(json_object_array_length(segments));
    for (std::size_t index = 0; index < json_object_array_length(segments); ++index) {
        auto* raw=json_object_array_get_idx(segments,index); if(!raw||json_object_get_type(raw)!=json_type_object)invalid("invalid nativeTransportation segment");
        transport::RoadSegment value; value.id=transport::SegmentId{stringField(raw,"id")}; value.road_class=roadClass(stringField(raw,"roadClass")); value.geometry_ref=stringField(raw,"geometryRef",true); value.start_junction_id=transport::JunctionId{stringField(raw,"startJunctionId")}; value.end_junction_id=transport::JunctionId{stringField(raw,"endJunctionId")}; value.length_meters=numberField(raw,"lengthMeters"); value.speed_limit_kph=numberField(raw,"speedLimitKph"); value.condition=numberField(raw,"condition"); value.access_policy_id=stringField(raw,"accessPolicyId",true); value.toll_policy_id=stringField(raw,"tollPolicyId",true); value.carriageway_ids=ids<transport::CarriagewayId>(raw,"carriagewayIds"); value.source_legacy_cells=strings(raw,"sourceLegacyCells"); result.segments.push_back(std::move(value));
    }
    auto* carriageways=required(object,"carriageways",json_type_array); result.carriageways.reserve(json_object_array_length(carriageways));
    for(std::size_t index=0;index<json_object_array_length(carriageways);++index){auto* raw=json_object_array_get_idx(carriageways,index);if(!raw||json_object_get_type(raw)!=json_type_object)invalid("invalid nativeTransportation carriageway");transport::Carriageway value;value.id=transport::CarriagewayId{stringField(raw,"id")};value.segment_id=transport::SegmentId{stringField(raw,"segmentId")};value.direction=direction(stringField(raw,"direction"));value.from_junction_id=transport::JunctionId{stringField(raw,"fromJunctionId")};value.to_junction_id=transport::JunctionId{stringField(raw,"toJunctionId")};value.operating_class=roadClass(stringField(raw,"operatingClass"));value.lane_ids=ids<transport::LaneId>(raw,"laneIds");result.carriageways.push_back(std::move(value));}
    auto* lanes=required(object,"lanes",json_type_array);result.lanes.reserve(json_object_array_length(lanes));
    for(std::size_t index=0;index<json_object_array_length(lanes);++index){auto* raw=json_object_array_get_idx(lanes,index);if(!raw||json_object_get_type(raw)!=json_type_object)invalid("invalid nativeTransportation lane");transport::Lane value;value.id=transport::LaneId{stringField(raw,"id")};value.carriageway_id=transport::CarriagewayId{stringField(raw,"carriagewayId")};const auto ordinal=uintField(raw,"ordinal");if(ordinal>std::numeric_limits<std::uint32_t>::max())invalid("nativeTransportation lane ordinal exceeds uint32");value.ordinal=static_cast<std::uint32_t>(ordinal);value.type=laneType(stringField(raw,"type"));const auto permissions=uintField(raw,"permissions");if(permissions>std::numeric_limits<transport::VehiclePermissionMask>::max())invalid("nativeTransportation permissions exceed mask range");value.permissions=static_cast<transport::VehiclePermissionMask>(permissions);value.open=boolField(raw,"open");value.base_capacity_per_minute=numberField(raw,"baseCapacityPerMinute");value.free_flow_speed_kph=numberField(raw,"freeFlowSpeedKph");result.lanes.push_back(std::move(value));}
    auto* movements=required(object,"movements",json_type_array);result.movements.reserve(json_object_array_length(movements));
    for(std::size_t index=0;index<json_object_array_length(movements);++index){auto* raw=json_object_array_get_idx(movements,index);if(!raw||json_object_get_type(raw)!=json_type_object)invalid("invalid nativeTransportation movement");transport::TurnMovement value;value.id=transport::MovementId{stringField(raw,"id")};value.junction_id=transport::JunctionId{stringField(raw,"junctionId")};value.from_carriageway_id=transport::CarriagewayId{stringField(raw,"fromCarriagewayId")};value.to_carriageway_id=transport::CarriagewayId{stringField(raw,"toCarriagewayId")};value.from_lane_ids=ids<transport::LaneId>(raw,"fromLaneIds");value.to_lane_ids=ids<transport::LaneId>(raw,"toLaneIds");value.type=movementType(stringField(raw,"type"));const auto permissions=uintField(raw,"permissions");if(permissions>std::numeric_limits<transport::VehiclePermissionMask>::max())invalid("nativeTransportation movement permissions exceed mask range");value.permissions=static_cast<transport::VehiclePermissionMask>(permissions);value.allowed=boolField(raw,"allowed");value.base_penalty_ticks=numberField(raw,"basePenaltyTicks");result.movements.push_back(std::move(value));}
    return result;
}

transport::IntersectionControlSnapshot controls(json_object* object) {
    transport::IntersectionControlSnapshot result; result.revision=uintField(object,"revision"); auto* rows=required(object,"controls",json_type_array); result.controls.reserve(json_object_array_length(rows));
    for(std::size_t index=0;index<json_object_array_length(rows);++index){auto* raw=json_object_array_get_idx(rows,index);if(!raw||json_object_get_type(raw)!=json_type_object)invalid("invalid nativeTransportation intersection control");transport::JunctionControl value;value.junction_id=transport::JunctionId{stringField(raw,"junctionId")};value.type=controlType(stringField(raw,"type"));auto* plan=field(raw,"signalPlan");if(plan&&json_object_get_type(plan)!=json_type_null){if(json_object_get_type(plan)!=json_type_object)invalid("nativeTransportation signalPlan must be object or null");transport::SignalPlan parsed;parsed.id=transport::SignalPlanId{stringField(plan,"id")};const auto offset=uintField(plan,"offsetTicks"),duration=uintField(plan,"phaseDurationTicks");if(offset>std::numeric_limits<std::uint32_t>::max()||duration>std::numeric_limits<std::uint32_t>::max())invalid("nativeTransportation signal timing exceeds uint32");parsed.offset_ticks=static_cast<std::uint32_t>(offset);parsed.phase_duration_ticks=static_cast<std::uint32_t>(duration);auto* phases=required(plan,"phases",json_type_array);parsed.phases.reserve(json_object_array_length(phases));for(std::size_t phaseIndex=0;phaseIndex<json_object_array_length(phases);++phaseIndex){auto* phase=json_object_array_get_idx(phases,phaseIndex);if(!phase||json_object_get_type(phase)!=json_type_array)invalid("invalid nativeTransportation signal phase");std::vector<transport::MovementId> movementIds;movementIds.reserve(json_object_array_length(phase));for(std::size_t movementIndex=0;movementIndex<json_object_array_length(phase);++movementIndex){auto* id=json_object_array_get_idx(phase,movementIndex);if(!id||json_object_get_type(id)!=json_type_string||std::string_view{json_object_get_string(id)}.empty())invalid("invalid nativeTransportation signal movement id");movementIds.emplace_back(json_object_get_string(id));}parsed.phases.push_back(std::move(movementIds));}value.signal_plan=std::move(parsed);}result.controls.push_back(std::move(value));}
    return result;
}

transport::ParkingSnapshot parking(json_object* object){transport::ParkingSnapshot result;result.next_reservation_id=uintField(object,"nextReservationId");auto* facilities=required(object,"facilities",json_type_array);for(std::size_t index=0;index<json_object_array_length(facilities);++index){auto* raw=json_object_array_get_idx(facilities,index);if(!raw||json_object_get_type(raw)!=json_type_object)invalid("invalid nativeTransportation parking facility");result.facilities.push_back({transport::ParkingFacilityId{stringField(raw,"id")},transport::JunctionId{stringField(raw,"accessJunctionId")},numberField(raw,"capacity"),numberField(raw,"occupied"),numberField(raw,"price"),numberField(raw,"accessPenaltyTicks")});}auto* reservations=required(object,"reservations",json_type_array);for(std::size_t index=0;index<json_object_array_length(reservations);++index){auto* raw=json_object_array_get_idx(reservations,index);if(!raw||json_object_get_type(raw)!=json_type_object)invalid("invalid nativeTransportation parking reservation");result.reservations.push_back({transport::ParkingReservationId{stringField(raw,"id")},transport::ParkingFacilityId{stringField(raw,"facilityId")},numberField(raw,"weight")});}return result;}
transport::IncidentSnapshot incidents(json_object* object){transport::IncidentSnapshot result;result.cost_revision=uintField(object,"costRevision");auto* rows=required(object,"incidents",json_type_array);for(std::size_t index=0;index<json_object_array_length(rows);++index){auto* raw=json_object_array_get_idx(rows,index);if(!raw||json_object_get_type(raw)!=json_type_object)invalid("invalid nativeTransportation incident");result.incidents.push_back({transport::IncidentId{stringField(raw,"id")},transport::CarriagewayId{stringField(raw,"carriagewayId")},numberField(raw,"capacityFactor"),numberField(raw,"speedFactor"),incidentState(stringField(raw,"state")),uintField(raw,"startTick"),uintField(raw,"clearTick")});}return result;}
transport::TrafficFlowSnapshot traffic(json_object* object){transport::TrafficFlowSnapshot result;auto* rows=required(object,"loads",json_type_array);for(std::size_t index=0;index<json_object_array_length(rows);++index){auto* raw=json_object_array_get_idx(rows,index);if(!raw||json_object_get_type(raw)!=json_type_object)invalid("invalid nativeTransportation traffic load");result.loads.push_back({transport::CarriagewayId{stringField(raw,"carriagewayId")},numberField(raw,"weightedVehicles")});}return result;}
transport::RoadTrafficSnapshot roadTraffic(json_object* object){transport::RoadTrafficSnapshot result;result.next_vehicle_id=uintField(object,"nextVehicleId");result.completed_trips=uintField(object,"completedTrips");result.failed_trips=uintField(object,"failedTrips");result.congestion_epoch=uintField(object,"congestionEpoch");auto* rows=required(object,"vehicles",json_type_array);for(std::size_t index=0;index<json_object_array_length(rows);++index){auto* raw=json_object_array_get_idx(rows,index);if(!raw||json_object_get_type(raw)!=json_type_object)invalid("invalid nativeTransportation road vehicle");transport::ActiveRoadVehicle value;value.id=stringField(raw,"id");value.trip_id=transport::TripId{stringField(raw,"tripId")};value.cause=tripCause(stringField(raw,"cause"));value.traveler_weight=numberField(raw,"travelerWeight");value.origin_id=stringField(raw,"originId",true);value.destination_id=stringField(raw,"destinationId",true);value.carriageway_ids=ids<transport::CarriagewayId>(raw,"carriagewayIds");value.current_carriageway_index=sizeField(raw,"currentCarriagewayIndex");value.carriageway_progress_ticks=numberField(raw,"carriagewayProgressTicks");value.departure_tick=uintField(raw,"departureTick");value.accumulated_delay_ticks=numberField(raw,"accumulatedDelayTicks");value.free_flow_ticks=numberField(raw,"freeFlowTicks");value.status=roadVehicleStatus(stringField(raw,"status"));auto* queued=field(raw,"queuedJunctionId");if(queued&&json_object_get_type(queued)!=json_type_null){if(json_object_get_type(queued)!=json_type_string||std::string_view{json_object_get_string(queued)}.empty())invalid("invalid nativeTransportation queued junction id");value.queued_junction_id=transport::JunctionId{json_object_get_string(queued)};}result.vehicles.push_back(std::move(value));}return result;}
transport::TransitNetworkSnapshot transit(json_object* object){transport::TransitNetworkSnapshot result;result.revision=uintField(object,"revision");auto* stops=required(object,"stops",json_type_array);for(std::size_t index=0;index<json_object_array_length(stops);++index){auto* raw=json_object_array_get_idx(stops,index);if(!raw||json_object_get_type(raw)!=json_type_object)invalid("invalid nativeTransportation transit stop");result.stops.push_back({transport::TransitStopId{stringField(raw,"id")},numberField(raw,"x"),numberField(raw,"y"),transitMode(stringField(raw,"mode"))});}auto* lines=required(object,"lines",json_type_array);for(std::size_t index=0;index<json_object_array_length(lines);++index){auto* raw=json_object_array_get_idx(lines,index);if(!raw||json_object_get_type(raw)!=json_type_object)invalid("invalid nativeTransportation transit line");transport::TransitLine value;value.id=transport::TransitLineId{stringField(raw,"id")};value.mode=transitMode(stringField(raw,"mode"));value.stop_ids=ids<transport::TransitStopId>(raw,"stopIds");value.fare=numberField(raw,"fare");value.headway_ticks=uintField(raw,"headwayTicks");value.enabled=boolField(raw,"enabled");result.lines.push_back(std::move(value));}return result;}
transport::PassengerQueueSnapshot queues(json_object* object){transport::PassengerQueueSnapshot result;result.next_split_id=uintField(object,"nextSplitId");auto* rows=required(object,"queues",json_type_array);for(std::size_t index=0;index<json_object_array_length(rows);++index){auto* raw=json_object_array_get_idx(rows,index);if(!raw||json_object_get_type(raw)!=json_type_object)invalid("invalid nativeTransportation passenger queue");transport::PassengerQueueEntry value;value.stop_id=transport::TransitStopId{stringField(raw,"stopId")};value.line_id=transport::TransitLineId{stringField(raw,"lineId")};value.direction_key=stringField(raw,"directionKey");auto* cohorts=required(raw,"cohorts",json_type_array);for(std::size_t cohortIndex=0;cohortIndex<json_object_array_length(cohorts);++cohortIndex){auto* rawCohort=json_object_array_get_idx(cohorts,cohortIndex);if(!rawCohort||json_object_get_type(rawCohort)!=json_type_object)invalid("invalid nativeTransportation passenger cohort");value.cohorts.push_back(cohort(rawCohort));}result.queues.push_back(std::move(value));}return result;}
transport::TransitOperationsSnapshot operations(json_object* object){transport::TransitOperationsSnapshot result;result.next_run_id=uintField(object,"nextRunId");auto* rows=required(object,"vehicles",json_type_array);for(std::size_t index=0;index<json_object_array_length(rows);++index){auto* raw=json_object_array_get_idx(rows,index);if(!raw||json_object_get_type(raw)!=json_type_object)invalid("invalid nativeTransportation operation record");auto* vehicle=required(raw,"vehicle",json_type_object);transport::TransitVehicleRecord record;record.vehicle.run_id=transport::TransitRunId{stringField(vehicle,"runId")};record.vehicle.line_id=transport::TransitLineId{stringField(vehicle,"lineId")};record.vehicle.capacity=numberField(vehicle,"capacity");record.vehicle.state=transitVehicleState(stringField(vehicle,"state"));record.vehicle.stop_index=sizeField(vehicle,"stopIndex");record.vehicle.dwell_remaining=uintField(vehicle,"dwellRemaining");record.vehicle.stop_serviced=boolField(vehicle,"stopServiced");record.vehicle.reliability=numberField(vehicle,"reliability");auto* onboard=required(raw,"onboard",json_type_array);for(std::size_t cohortIndex=0;cohortIndex<json_object_array_length(onboard);++cohortIndex){auto* rawCohort=json_object_array_get_idx(onboard,cohortIndex);if(!rawCohort||json_object_get_type(rawCohort)!=json_type_object)invalid("invalid nativeTransportation onboard cohort");record.onboard.push_back(cohort(rawCohort));}result.vehicles.push_back(std::move(record));}return result;}

transport::TransportationSnapshot parseSnapshot(json_object* native) {
    if (uintField(native,"schemaVersion") != 1U) invalid("unsupported nativeTransportation schemaVersion");
    transport::TransportationSnapshot result;
    result.network=network(required(native,"network",json_type_object));
    result.controls=controls(required(native,"controls",json_type_object));
    result.parking=parking(required(native,"parking",json_type_object));
    result.incidents=incidents(required(native,"incidents",json_type_object));
    result.traffic=traffic(required(native,"traffic",json_type_object));
    result.road_traffic=roadTraffic(required(native,"roadTraffic",json_type_object));
    result.transit=transit(required(native,"transit",json_type_object));
    result.queues=queues(required(native,"queues",json_type_object));
    result.operations=operations(required(native,"operations",json_type_object));
    transport::TransportationAuthority validator; validator.restore(result); return validator.snapshot();
}
} // namespace

Result<std::optional<transport::TransportationSnapshot>> parseNativeTransportationV9(std::string_view json) {
    if (json.size() > static_cast<std::size_t>(std::numeric_limits<int>::max())) return std::unexpected(make_error(ErrorCode::serialization_failure,"nativeTransportation Save V9 JSON exceeds parser size limit"));
    json_tokener* tokener=json_tokener_new(); if(!tokener)return std::unexpected(make_error(ErrorCode::internal_error,"failed to allocate nativeTransportation parser"));
    json_object* raw=json_tokener_parse_ex(tokener,json.data(),static_cast<int>(json.size())); const auto error=json_tokener_get_error(tokener); json_tokener_free(tokener); JsonPtr root{raw,json_object_put};
    if(error!=json_tokener_success||!root||json_object_get_type(root.get())!=json_type_object)return std::unexpected(make_error(ErrorCode::serialization_failure,"invalid Save V9 JSON while reading nativeTransportation"));
    json_object* native=nullptr; if(!json_object_object_get_ex(root.get(),"nativeTransportation",&native))return std::optional<transport::TransportationSnapshot>{};
    if(!native||json_object_get_type(native)!=json_type_object)return std::unexpected(make_error(ErrorCode::serialization_failure,"nativeTransportation must be an object"));
    try{return std::optional<transport::TransportationSnapshot>{parseSnapshot(native)};}catch(const std::exception& exception){return std::unexpected(make_error(ErrorCode::serialization_failure,exception.what()));}catch(...){return std::unexpected(make_error(ErrorCode::serialization_failure,"unknown nativeTransportation hydration failure"));}
}

} // namespace civic
