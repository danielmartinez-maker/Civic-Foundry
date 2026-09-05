#include <civic/persistence/TransportationSaveV9.hpp>

#include <civic/persistence/SaveV9.hpp>

#include <json-c/json.h>

#include <limits>
#include <memory>
#include <stdexcept>
#include <string>
#include <string_view>

namespace civic {
namespace {
using JsonPtr = std::unique_ptr<json_object, decltype(&json_object_put)>;

json_object* object() { return json_object_new_object(); }
json_object* array() { return json_object_new_array(); }
json_object* text(std::string_view value) { return json_object_new_string_len(value.data(), static_cast<int>(value.size())); }
json_object* number(double value) {
    if (!std::isfinite(value)) throw std::runtime_error("native transportation snapshot contains non-finite number");
    return json_object_new_double(value);
}
json_object* boolean(bool value) { return json_object_new_boolean(value ? 1 : 0); }
json_object* uint64(std::uint64_t value) {
    if (value > static_cast<std::uint64_t>(std::numeric_limits<std::int64_t>::max())) throw std::runtime_error("native transportation integer exceeds JSON int64 range");
    return json_object_new_int64(static_cast<std::int64_t>(value));
}
void add(json_object* target, const char* key, json_object* value) { json_object_object_add(target, key, value); }

template<class Id>
json_object* idArray(const std::vector<Id>& values) {
    auto* result = array();
    for (const auto& value : values) json_object_array_add(result, text(value.value));
    return result;
}
json_object* stringArray(const std::vector<std::string>& values) {
    auto* result = array();
    for (const auto& value : values) json_object_array_add(result, text(value));
    return result;
}

const char* roadClass(transport::RoadClass value) {
    switch (value) {
        case transport::RoadClass::local: return "local";
        case transport::RoadClass::collector: return "collector";
        case transport::RoadClass::arterial: return "arterial";
        case transport::RoadClass::avenue: return "avenue";
        case transport::RoadClass::expressway: return "expressway";
        case transport::RoadClass::highway: return "highway";
    }
    return "local";
}
const char* direction(transport::Direction value) { return value == transport::Direction::forward ? "forward" : "backward"; }
const char* laneType(transport::LaneType value) {
    switch (value) {
        case transport::LaneType::through: return "through";
        case transport::LaneType::turn: return "turn";
        case transport::LaneType::bus: return "bus";
        case transport::LaneType::bike: return "bike";
        case transport::LaneType::parking: return "parking";
        case transport::LaneType::reversible: return "reversible";
        case transport::LaneType::shoulder: return "shoulder";
    }
    return "through";
}
const char* movementType(transport::MovementType value) {
    switch (value) {
        case transport::MovementType::left: return "left";
        case transport::MovementType::through: return "through";
        case transport::MovementType::right: return "right";
        case transport::MovementType::u_turn: return "u-turn";
    }
    return "through";
}
const char* controlType(transport::ControlType value) {
    switch (value) {
        case transport::ControlType::uncontrolled: return "uncontrolled";
        case transport::ControlType::stop: return "stop";
        case transport::ControlType::yield: return "yield";
        case transport::ControlType::signal: return "signal";
    }
    return "uncontrolled";
}
const char* incidentState(transport::IncidentState value) {
    switch (value) {
        case transport::IncidentState::planned: return "planned";
        case transport::IncidentState::active: return "active";
        case transport::IncidentState::clearing: return "clearing";
        case transport::IncidentState::cleared: return "cleared";
    }
    return "cleared";
}
const char* tripCause(transport::TripCause value) {
    switch (value) {
        case transport::TripCause::home_to_work: return "home_to_work";
        case transport::TripCause::home_to_school: return "home_to_school";
        case transport::TripCause::home_to_shopping: return "home_to_shopping";
        case transport::TripCause::firm_to_supplier: return "firm_to_supplier";
        case transport::TripCause::warehouse_to_customer: return "warehouse_to_customer";
        case transport::TripCause::incident_to_facility: return "incident_to_facility";
        case transport::TripCause::construction_to_supplier: return "construction_to_supplier";
    }
    return "home_to_work";
}
const char* roadVehicleStatus(transport::RoadVehicleStatus value) { return value == transport::RoadVehicleStatus::queued ? "queued" : "moving"; }
const char* transitMode(transport::TransitMode value) {
    switch (value) {
        case transport::TransitMode::bus: return "bus";
        case transport::TransitMode::tram: return "tram";
        case transport::TransitMode::metro: return "metro";
        case transport::TransitMode::rail: return "rail";
        case transport::TransitMode::ferry: return "ferry";
    }
    return "bus";
}
const char* transitVehicleState(transport::TransitVehicleState value) {
    switch (value) {
        case transport::TransitVehicleState::in_service: return "in_service";
        case transport::TransitVehicleState::out_of_service: return "out_of_service";
        case transport::TransitVehicleState::failed: return "failed";
    }
    return "failed";
}

json_object* cohortJson(const transport::PassengerCohort& cohort) {
    auto* result = object();
    add(result, "id", text(cohort.id.value));
    add(result, "tripId", text(cohort.trip_id.value));
    add(result, "travelerWeight", number(cohort.traveler_weight));
    add(result, "lineId", text(cohort.line_id.value));
    add(result, "directionKey", text(cohort.direction_key));
    add(result, "boardingStopId", text(cohort.boarding_stop_id.value));
    add(result, "alightingStopId", text(cohort.alighting_stop_id.value));
    add(result, "enqueuedTick", uint64(cohort.enqueued_tick));
    auto* legs = array();
    for (const auto& leg : cohort.transfer_legs) {
        auto* row = object();
        add(row, "lineId", text(leg.line_id.value));
        add(row, "directionKey", text(leg.direction_key));
        add(row, "boardingStopId", text(leg.boarding_stop_id.value));
        add(row, "alightingStopId", text(leg.alighting_stop_id.value));
        json_object_array_add(legs, row);
    }
    add(result, "transferLegs", legs);
    return result;
}

json_object* snapshotObject(const transport::TransportationSnapshot& snapshot) {
    auto* root = object();
    add(root, "schemaVersion", json_object_new_int(1));

    auto* network = object();
    add(network, "topologyRevision", uint64(snapshot.network.topology_revision));
    add(network, "costRevision", uint64(snapshot.network.cost_revision));
    auto* junctions = array();
    for (const auto& value : snapshot.network.junctions) {
        auto* row = object();
        add(row, "id", text(value.id.value)); add(row, "x", number(value.x)); add(row, "y", number(value.y)); add(row, "sourceLegacyCell", text(value.source_legacy_cell));
        json_object_array_add(junctions, row);
    }
    add(network, "junctions", junctions);
    auto* segments = array();
    for (const auto& value : snapshot.network.segments) {
        auto* row = object();
        add(row, "id", text(value.id.value)); add(row, "roadClass", text(roadClass(value.road_class))); add(row, "geometryRef", text(value.geometry_ref));
        add(row, "startJunctionId", text(value.start_junction_id.value)); add(row, "endJunctionId", text(value.end_junction_id.value));
        add(row, "lengthMeters", number(value.length_meters)); add(row, "speedLimitKph", number(value.speed_limit_kph)); add(row, "condition", number(value.condition));
        add(row, "accessPolicyId", text(value.access_policy_id)); add(row, "tollPolicyId", text(value.toll_policy_id));
        add(row, "carriagewayIds", idArray(value.carriageway_ids)); add(row, "sourceLegacyCells", stringArray(value.source_legacy_cells));
        json_object_array_add(segments, row);
    }
    add(network, "segments", segments);
    auto* carriageways = array();
    for (const auto& value : snapshot.network.carriageways) {
        auto* row = object();
        add(row, "id", text(value.id.value)); add(row, "segmentId", text(value.segment_id.value)); add(row, "direction", text(direction(value.direction)));
        add(row, "fromJunctionId", text(value.from_junction_id.value)); add(row, "toJunctionId", text(value.to_junction_id.value)); add(row, "operatingClass", text(roadClass(value.operating_class))); add(row, "laneIds", idArray(value.lane_ids));
        json_object_array_add(carriageways, row);
    }
    add(network, "carriageways", carriageways);
    auto* lanes = array();
    for (const auto& value : snapshot.network.lanes) {
        auto* row = object();
        add(row, "id", text(value.id.value)); add(row, "carriagewayId", text(value.carriageway_id.value)); add(row, "ordinal", uint64(value.ordinal)); add(row, "type", text(laneType(value.type)));
        add(row, "permissions", uint64(value.permissions)); add(row, "open", boolean(value.open)); add(row, "baseCapacityPerMinute", number(value.base_capacity_per_minute)); add(row, "freeFlowSpeedKph", number(value.free_flow_speed_kph));
        json_object_array_add(lanes, row);
    }
    add(network, "lanes", lanes);
    auto* movements = array();
    for (const auto& value : snapshot.network.movements) {
        auto* row = object();
        add(row, "id", text(value.id.value)); add(row, "junctionId", text(value.junction_id.value)); add(row, "fromCarriagewayId", text(value.from_carriageway_id.value)); add(row, "toCarriagewayId", text(value.to_carriageway_id.value));
        add(row, "fromLaneIds", idArray(value.from_lane_ids)); add(row, "toLaneIds", idArray(value.to_lane_ids)); add(row, "type", text(movementType(value.type))); add(row, "permissions", uint64(value.permissions)); add(row, "allowed", boolean(value.allowed)); add(row, "basePenaltyTicks", number(value.base_penalty_ticks));
        json_object_array_add(movements, row);
    }
    add(network, "movements", movements);
    add(root, "network", network);

    auto* controls = object(); add(controls, "revision", uint64(snapshot.controls.revision));
    auto* controlRows = array();
    for (const auto& value : snapshot.controls.controls) {
        auto* row = object(); add(row, "junctionId", text(value.junction_id.value)); add(row, "type", text(controlType(value.type)));
        if (value.signal_plan) {
            auto* plan = object(); add(plan, "id", text(value.signal_plan->id.value)); add(plan, "offsetTicks", uint64(value.signal_plan->offset_ticks)); add(plan, "phaseDurationTicks", uint64(value.signal_plan->phase_duration_ticks));
            auto* phases = array(); for (const auto& phase : value.signal_plan->phases) json_object_array_add(phases, idArray(phase)); add(plan, "phases", phases); add(row, "signalPlan", plan);
        } else add(row, "signalPlan", json_object_new_null());
        json_object_array_add(controlRows, row);
    }
    add(controls, "controls", controlRows); add(root, "controls", controls);

    auto* parking = object(); add(parking, "nextReservationId", uint64(snapshot.parking.next_reservation_id));
    auto* facilities = array(); for (const auto& value : snapshot.parking.facilities) { auto* row=object(); add(row,"id",text(value.id.value)); add(row,"accessJunctionId",text(value.access_junction_id.value)); add(row,"capacity",number(value.capacity)); add(row,"occupied",number(value.occupied)); add(row,"price",number(value.price)); add(row,"accessPenaltyTicks",number(value.access_penalty_ticks)); json_object_array_add(facilities,row); } add(parking,"facilities",facilities);
    auto* reservations = array(); for (const auto& value : snapshot.parking.reservations) { auto* row=object(); add(row,"id",text(value.id.value)); add(row,"facilityId",text(value.facility_id.value)); add(row,"weight",number(value.weight)); json_object_array_add(reservations,row); } add(parking,"reservations",reservations); add(root,"parking",parking);

    auto* incidents = object(); add(incidents,"costRevision",uint64(snapshot.incidents.cost_revision)); auto* incidentRows=array();
    for (const auto& value : snapshot.incidents.incidents) { auto* row=object(); add(row,"id",text(value.id.value)); add(row,"carriagewayId",text(value.carriageway_id.value)); add(row,"capacityFactor",number(value.capacity_factor)); add(row,"speedFactor",number(value.speed_factor)); add(row,"state",text(incidentState(value.state))); add(row,"startTick",uint64(value.start_tick)); add(row,"clearTick",uint64(value.clear_tick)); json_object_array_add(incidentRows,row); }
    add(incidents,"incidents",incidentRows); add(root,"incidents",incidents);

    auto* traffic = object(); auto* loads=array(); for (const auto& value:snapshot.traffic.loads){auto* row=object();add(row,"carriagewayId",text(value.carriageway_id.value));add(row,"weightedVehicles",number(value.weighted_vehicles));json_object_array_add(loads,row);} add(traffic,"loads",loads); add(root,"traffic",traffic);

    auto* roadTraffic=object(); add(roadTraffic,"nextVehicleId",uint64(snapshot.road_traffic.next_vehicle_id)); add(roadTraffic,"completedTrips",uint64(snapshot.road_traffic.completed_trips)); add(roadTraffic,"failedTrips",uint64(snapshot.road_traffic.failed_trips)); add(roadTraffic,"congestionEpoch",uint64(snapshot.road_traffic.congestion_epoch));
    auto* roadVehicles=array(); for(const auto& value:snapshot.road_traffic.vehicles){auto* row=object();add(row,"id",text(value.id));add(row,"tripId",text(value.trip_id.value));add(row,"cause",text(tripCause(value.cause)));add(row,"travelerWeight",number(value.traveler_weight));add(row,"originId",text(value.origin_id));add(row,"destinationId",text(value.destination_id));add(row,"carriagewayIds",idArray(value.carriageway_ids));add(row,"currentCarriagewayIndex",uint64(value.current_carriageway_index));add(row,"carriagewayProgressTicks",number(value.carriageway_progress_ticks));add(row,"departureTick",uint64(value.departure_tick));add(row,"accumulatedDelayTicks",number(value.accumulated_delay_ticks));add(row,"freeFlowTicks",number(value.free_flow_ticks));add(row,"status",text(roadVehicleStatus(value.status))); if(value.queued_junction_id)add(row,"queuedJunctionId",text(value.queued_junction_id->value));else add(row,"queuedJunctionId",json_object_new_null()); json_object_array_add(roadVehicles,row);} add(roadTraffic,"vehicles",roadVehicles); add(root,"roadTraffic",roadTraffic);

    auto* transit=object(); add(transit,"revision",uint64(snapshot.transit.revision)); auto* stops=array(); for(const auto& value:snapshot.transit.stops){auto* row=object();add(row,"id",text(value.id.value));add(row,"x",number(value.x));add(row,"y",number(value.y));add(row,"mode",text(transitMode(value.mode)));json_object_array_add(stops,row);} add(transit,"stops",stops); auto* lines=array(); for(const auto& value:snapshot.transit.lines){auto* row=object();add(row,"id",text(value.id.value));add(row,"mode",text(transitMode(value.mode)));add(row,"stopIds",idArray(value.stop_ids));add(row,"fare",number(value.fare));add(row,"headwayTicks",uint64(value.headway_ticks));add(row,"enabled",boolean(value.enabled));json_object_array_add(lines,row);} add(transit,"lines",lines); add(root,"transit",transit);

    auto* queues=object(); add(queues,"nextSplitId",uint64(snapshot.queues.next_split_id)); auto* queueRows=array(); for(const auto& value:snapshot.queues.queues){auto* row=object();add(row,"stopId",text(value.stop_id.value));add(row,"lineId",text(value.line_id.value));add(row,"directionKey",text(value.direction_key));auto* cohorts=array();for(const auto& cohort:value.cohorts)json_object_array_add(cohorts,cohortJson(cohort));add(row,"cohorts",cohorts);json_object_array_add(queueRows,row);} add(queues,"queues",queueRows); add(root,"queues",queues);

    auto* operations=object(); add(operations,"nextRunId",uint64(snapshot.operations.next_run_id)); auto* operationRows=array(); for(const auto& value:snapshot.operations.vehicles){auto* row=object();auto* vehicle=object();add(vehicle,"runId",text(value.vehicle.run_id.value));add(vehicle,"lineId",text(value.vehicle.line_id.value));add(vehicle,"capacity",number(value.vehicle.capacity));add(vehicle,"state",text(transitVehicleState(value.vehicle.state)));add(vehicle,"stopIndex",uint64(value.vehicle.stop_index));add(vehicle,"dwellRemaining",uint64(value.vehicle.dwell_remaining));add(vehicle,"stopServiced",boolean(value.vehicle.stop_serviced));add(vehicle,"reliability",number(value.vehicle.reliability));add(row,"vehicle",vehicle);auto* onboard=array();for(const auto& cohort:value.onboard)json_object_array_add(onboard,cohortJson(cohort));add(row,"onboard",onboard);json_object_array_add(operationRows,row);} add(operations,"vehicles",operationRows); add(root,"operations",operations);
    return root;
}

JsonPtr parseRoot(std::string_view json) {
    if (json.size() > static_cast<std::size_t>(std::numeric_limits<int>::max())) throw std::runtime_error("Save V9 JSON exceeds parser size limit");
    json_tokener* tokener=json_tokener_new(); if(!tokener)throw std::runtime_error("failed to allocate Save V9 writer parser");
    json_object* raw=json_tokener_parse_ex(tokener,json.data(),static_cast<int>(json.size())); const auto error=json_tokener_get_error(tokener); json_tokener_free(tokener);
    if(error!=json_tokener_success||!raw||json_object_get_type(raw)!=json_type_object){if(raw)json_object_put(raw);throw std::runtime_error("invalid Save V9 JSON for transportation write");}
    return JsonPtr{raw,json_object_put};
}
} // namespace

Result<std::string> transportationSnapshotJson(const transport::TransportationSnapshot& transportation) {
    try {
        JsonPtr value{snapshotObject(transportation),json_object_put};
        return std::string{json_object_to_json_string_ext(value.get(),JSON_C_TO_STRING_PLAIN)};
    } catch(const std::exception& error) {
        return std::unexpected(make_error(ErrorCode::serialization_failure,error.what()));
    }
}

Result<std::string> writeTransportationV9(std::string_view canonicalSaveJson,const LegacyRoadAuthorityV9& roads,const transport::TransportationSnapshot& transportation) {
    try {
        auto root=parseRoot(canonicalSaveJson);
        auto* roadObject=object(); add(roadObject,"revision",uint64(roads.revision)); auto* cells=array();
        for(const auto& cell:roads.cells){auto* row=object();add(row,"x",json_object_new_int(cell.x));add(row,"y",json_object_new_int(cell.y));add(row,"type",text(roadClass(cell.road_class)));json_object_array_add(cells,row);} add(roadObject,"cells",cells); json_object_object_add(root.get(),"roads",roadObject);
        json_object_object_add(root.get(),"nativeTransportation",snapshotObject(transportation));
        const std::string raw=json_object_to_json_string_ext(root.get(),JSON_C_TO_STRING_PLAIN);
        auto parsed=parseSaveV9(raw); if(!parsed)return std::unexpected(parsed.error());
        return parsed->canonicalJson;
    } catch(const std::exception& error) {
        return std::unexpected(make_error(ErrorCode::serialization_failure,error.what()));
    } catch(...) {
        return std::unexpected(make_error(ErrorCode::serialization_failure,"unknown transportation Save V9 write failure"));
    }
}

} // namespace civic
