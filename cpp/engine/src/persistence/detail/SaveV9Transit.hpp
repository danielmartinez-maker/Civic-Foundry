#pragma once

#include "SaveV9Json.hpp"

namespace civic::save_v9_detail {
inline Result<void> validateTransitState(json_object* root) {
    json_object* transit = nullptr;
    if (!json_object_object_get_ex(root, "transit", &transit) || !isObject(transit)) return {};
    auto network = requireField(transit, "network", json_type_object); if (!network) return std::unexpected(network.error());
    auto mobility = requireField(transit, "mobility", json_type_object); if (!mobility) return std::unexpected(mobility.error());
    auto stops = requireField(*network, "stops", json_type_array); if (!stops) return std::unexpected(stops.error());
    auto lines = requireField(*network, "lines", json_type_array); if (!lines) return std::unexpected(lines.error());

    std::set<std::string, std::less<>> stop_ids;
    for (std::size_t index = 0; index < json_object_array_length(*stops); ++index) {
        auto* row = json_object_array_get_idx(*stops, index);
        if (!isObject(row)) return std::unexpected(make_error(ErrorCode::serialization_failure, "transit stop must be an object"));
        auto id = requireStringField(row, "id", "transit stop id"); if (!id) return std::unexpected(id.error());
        stop_ids.insert(*id);
    }
    std::set<std::string, std::less<>> line_ids;
    for (std::size_t index = 0; index < json_object_array_length(*lines); ++index) {
        auto* row = json_object_array_get_idx(*lines, index);
        if (!isObject(row)) return std::unexpected(make_error(ErrorCode::serialization_failure, "transit line must be an object"));
        auto id = requireStringField(row, "id", "transit line id"); if (!id) return std::unexpected(id.error());
        line_ids.insert(*id);
    }
    for (std::size_t index = 0; index < json_object_array_length(*lines); ++index) {
        auto* line = json_object_array_get_idx(*lines, index);
        auto refs = requireField(line, "stopIds", json_type_array); if (!refs) return std::unexpected(refs.error());
        std::set<std::string, std::less<>> seen;
        for (std::size_t ref_index = 0; ref_index < json_object_array_length(*refs); ++ref_index) {
            auto* raw = json_object_array_get_idx(*refs, ref_index);
            if (!raw || json_object_get_type(raw) != json_type_string || !nonBlank(json_object_get_string(raw))) return std::unexpected(make_error(ErrorCode::serialization_failure, "transit line stop id must be non-empty"));
            const std::string id = json_object_get_string(raw);
            if (!stop_ids.contains(id)) return std::unexpected(make_error(ErrorCode::serialization_failure, "transit line references missing stop: " + id));
            if (!seen.insert(id).second) return std::unexpected(make_error(ErrorCode::serialization_failure, "transit line contains duplicate stop: " + id));
        }
    }

    auto passengers = requireField(*mobility, "passengers", json_type_object); if (!passengers) return std::unexpected(passengers.error());
    auto vehicles = requireField(*mobility, "vehicles", json_type_object); if (!vehicles) return std::unexpected(vehicles.error());
    auto operations = requireField(*mobility, "operations", json_type_object); if (!operations) return std::unexpected(operations.error());
    auto queues = requireField(*passengers, "queues", json_type_array); if (!queues) return std::unexpected(queues.error());
    auto vehicle_rows = requireField(*vehicles, "vehicles", json_type_array); if (!vehicle_rows) return std::unexpected(vehicle_rows.error());
    auto operation_rows = requireField(*operations, "lines", json_type_array); if (!operation_rows) return std::unexpected(operation_rows.error());

    std::set<std::string, std::less<>> cohort_ids;
    auto validateCohort = [&](json_object* cohort, std::string_view source) -> Result<void> {
        if (!isObject(cohort)) return std::unexpected(make_error(ErrorCode::serialization_failure, std::string{source} + " must be an object"));
        auto id = requireStringField(cohort, "id", std::string{source} + " id"); if (!id) return std::unexpected(id.error());
        if (!cohort_ids.insert(*id).second) return std::unexpected(make_error(ErrorCode::serialization_failure, "duplicate transit passenger cohort: " + *id));
        auto line = requireStringField(cohort, "lineId", std::string{source} + " lineId"); if (!line) return std::unexpected(line.error());
        auto board = requireStringField(cohort, "boardingStopId", std::string{source} + " boardingStopId"); if (!board) return std::unexpected(board.error());
        auto alight = requireStringField(cohort, "alightingStopId", std::string{source} + " alightingStopId"); if (!alight) return std::unexpected(alight.error());
        if (!line_ids.contains(*line) || !stop_ids.contains(*board) || !stop_ids.contains(*alight)) return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid transit passenger reference"));
        auto legs = requireField(cohort, "transferLegs", json_type_array); if (!legs) return std::unexpected(legs.error());
        for (std::size_t index = 0; index < json_object_array_length(*legs); ++index) {
            auto* leg = json_object_array_get_idx(*legs, index);
            if (!isObject(leg)) return std::unexpected(make_error(ErrorCode::serialization_failure, "transit transfer leg must be an object"));
            auto leg_line = requireStringField(leg, "lineId", "transit transfer lineId"); if (!leg_line) return std::unexpected(leg_line.error());
            auto leg_board = requireStringField(leg, "boardingStopId", "transit transfer boardingStopId"); if (!leg_board) return std::unexpected(leg_board.error());
            auto leg_alight = requireStringField(leg, "alightingStopId", "transit transfer alightingStopId"); if (!leg_alight) return std::unexpected(leg_alight.error());
            if (!line_ids.contains(*leg_line) || !stop_ids.contains(*leg_board) || !stop_ids.contains(*leg_alight)) return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid transit transfer reference"));
        }
        return {};
    };

    std::set<std::string, std::less<>> queue_keys;
    for (std::size_t index = 0; index < json_object_array_length(*queues); ++index) {
        auto* queue = json_object_array_get_idx(*queues, index);
        if (!isObject(queue)) return std::unexpected(make_error(ErrorCode::serialization_failure, "transit passenger queue must be an object"));
        auto stop = requireStringField(queue, "stopId", "transit queue stopId"); if (!stop) return std::unexpected(stop.error());
        auto line = requireStringField(queue, "lineId", "transit queue lineId"); if (!line) return std::unexpected(line.error());
        auto direction = requireStringField(queue, "directionKey", "transit queue directionKey"); if (!direction) return std::unexpected(direction.error());
        const std::string key = *stop + "|" + *line + "|" + *direction;
        if (!queue_keys.insert(key).second) return std::unexpected(make_error(ErrorCode::serialization_failure, "duplicate transit passenger queue: " + key));
        if (!stop_ids.contains(*stop) || !line_ids.contains(*line)) return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid transit queue reference"));
        auto cohorts = requireField(queue, "cohorts", json_type_array); if (!cohorts) return std::unexpected(cohorts.error());
        for (std::size_t cohort_index = 0; cohort_index < json_object_array_length(*cohorts); ++cohort_index) {
            auto result = validateCohort(json_object_array_get_idx(*cohorts, cohort_index), "transit queue cohort");
            if (!result) return result;
        }
    }
    for (std::size_t index = 0; index < json_object_array_length(*vehicle_rows); ++index) {
        auto* vehicle = json_object_array_get_idx(*vehicle_rows, index);
        if (!isObject(vehicle)) return std::unexpected(make_error(ErrorCode::serialization_failure, "transit vehicle must be an object"));
        auto line = requireStringField(vehicle, "lineId", "transit vehicle lineId"); if (!line) return std::unexpected(line.error());
        if (!line_ids.contains(*line)) return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid transit vehicle line reference"));
        auto onboard = requireField(vehicle, "onboard", json_type_array); if (!onboard) return std::unexpected(onboard.error());
        for (std::size_t cohort_index = 0; cohort_index < json_object_array_length(*onboard); ++cohort_index) {
            auto result = validateCohort(json_object_array_get_idx(*onboard, cohort_index), "onboard transit cohort");
            if (!result) return result;
        }
    }
    std::set<std::string, std::less<>> operation_ids;
    for (std::size_t index = 0; index < json_object_array_length(*operation_rows); ++index) {
        auto* row = json_object_array_get_idx(*operation_rows, index);
        if (!isObject(row)) return std::unexpected(make_error(ErrorCode::serialization_failure, "transit operation line must be an object"));
        auto line = requireStringField(row, "lineId", "transit operation lineId"); if (!line) return std::unexpected(line.error());
        if (!line_ids.contains(*line)) return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid transit operations line reference"));
        if (!operation_ids.insert(*line).second) return std::unexpected(make_error(ErrorCode::serialization_failure, "duplicate transit operations line: " + *line));
    }
    return {};
}
} // namespace civic::save_v9_detail
