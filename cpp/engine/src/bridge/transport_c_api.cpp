#include <civic/bridge/transport_c_api.h>
#include <civic/transport/transport_engine.hpp>

#include <cstdlib>
#include <cstring>
#include <iomanip>
#include <limits>
#include <new>
#include <sstream>
#include <string>
#include <vector>

using civic::transport::Direction;
using civic::transport::GeneralizedCostConfig;
using civic::transport::JunctionId;
using civic::transport::LegacyRoadAdapter;
using civic::transport::LegacyRoadCell;
using civic::transport::RoadClass;
using civic::transport::RoutingEngine;
using civic::transport::TransportationAuthority;

struct cf_transport_handle {
    TransportationAuthority authority;
    RoutingEngine routing;
    std::string last_error;
};

namespace {
cf_result error(cf_transport_handle* h, cf_result code, std::string message) {
    if (h) h->last_error = std::move(message);
    return code;
}
cf_result write_buffer(cf_buffer* out, const std::string& text) {
    if (!out) return CF_INVALID_ARGUMENT;
    out->data = nullptr; out->size = 0;
    auto* bytes = static_cast<uint8_t*>(std::malloc(text.size() + 1));
    if (!bytes) return CF_INTERNAL_ERROR;
    std::memcpy(bytes, text.data(), text.size()); bytes[text.size()] = 0;
    out->data = bytes; out->size = text.size(); return CF_OK;
}
std::string json_escape(const std::string& input) {
    std::ostringstream out;
    for (char raw : input) {
        const auto c = static_cast<unsigned char>(raw);
        switch (c) {
            case '"': out << "\\\""; break;
            case '\\': out << "\\\\"; break;
            case '\n': out << "\\n"; break;
            case '\r': out << "\\r"; break;
            case '\t': out << "\\t"; break;
            default: if (c < 0x20) out << "?"; else out << static_cast<char>(c);
        }
    }
    return out.str();
}
RoadClass road_class(cf_road_class value) {
    switch(value) { case CF_ROAD_LOCAL: return RoadClass::local; case CF_ROAD_COLLECTOR: return RoadClass::collector; case CF_ROAD_ARTERIAL: return RoadClass::arterial; }
    throw std::invalid_argument("invalid road class");
}
Direction direction(cf_direction value) {
    switch(value) { case CF_DIRECTION_FORWARD: return Direction::forward; case CF_DIRECTION_BACKWARD: return Direction::backward; }
    throw std::invalid_argument("invalid direction");
}
}

extern "C" cf_transport_handle* cf_transport_create(void) {
    try { return new cf_transport_handle{}; } catch (...) { return nullptr; }
}
extern "C" void cf_transport_destroy(cf_transport_handle* handle) { delete handle; }
extern "C" cf_result cf_transport_load_legacy_roads(cf_transport_handle* h, const cf_legacy_road_cell* cells, size_t count, uint64_t revision) {
    if (!h || (count > 0 && !cells)) return error(h, CF_INVALID_ARGUMENT, "invalid legacy road buffer");
    try {
        std::vector<LegacyRoadCell> native; native.reserve(count);
        for (size_t i=0;i<count;++i) native.push_back({cells[i].x,cells[i].y,road_class(cells[i].road_class),cells[i].one_way != 0,direction(cells[i].one_way_direction)});
        h->authority.load_network(LegacyRoadAdapter{}.project(native, revision)); h->routing.clear_cache(); h->last_error.clear(); return CF_OK;
    } catch (const std::invalid_argument& e) { return error(h,CF_INVALID_ARGUMENT,e.what()); }
      catch (const std::exception& e) { return error(h,CF_INVALID_STATE,e.what()); }
      catch (...) { return error(h,CF_INTERNAL_ERROR,"unknown native transport error"); }
}
extern "C" cf_result cf_transport_find_route_json(cf_transport_handle* h, const char* start, const char* end, uint32_t permissions, cf_buffer* out) {
    if (!h || !start || !end || !out) return error(h,CF_INVALID_ARGUMENT,"invalid route arguments");
    try {
        auto route=h->routing.find_route(h->authority.network().snapshot(),JunctionId{start},JunctionId{end},permissions,GeneralizedCostConfig{});
        if(!route)return error(h,CF_NOT_FOUND,"route not found");
        std::ostringstream json;
        json << std::setprecision(std::numeric_limits<double>::max_digits10);
        json<<"{\"junctionIds\":[";
        for(size_t i=0;i<route->junction_ids.size();++i){if(i)json<<',';json<<'"'<<json_escape(route->junction_ids[i].value)<<'"';}
        json<<"],\"carriagewayIds\":[";for(size_t i=0;i<route->carriageway_ids.size();++i){if(i)json<<',';json<<'"'<<json_escape(route->carriageway_ids[i].value)<<'"';}
        json<<"],\"movementIds\":[";for(size_t i=0;i<route->movement_ids.size();++i){if(i)json<<',';json<<'"'<<json_escape(route->movement_ids[i].value)<<'"';}
        json<<"],\"totalCost\":"<<route->total_cost<<'}'; h->last_error.clear(); return write_buffer(out,json.str());
    } catch(const std::exception& e){return error(h,CF_INVALID_STATE,e.what());} catch(...){return error(h,CF_INTERNAL_ERROR,"unknown native transport error");}
}
extern "C" cf_result cf_transport_get_snapshot_json(cf_transport_handle* h, cf_buffer* out) {
    if(!h||!out)return error(h,CF_INVALID_ARGUMENT,"invalid snapshot arguments");
    try {
        const auto s=h->authority.snapshot();
        std::ostringstream json;
        json << "{\"schemaVersion\":1"
             << ",\"topologyRevision\":" << s.network.topology_revision
             << ",\"costRevision\":" << s.network.cost_revision
             << ",\"junctions\":[";
        for (size_t i=0;i<s.network.junctions.size();++i) {
            if(i) json << ',';
            const auto& value=s.network.junctions[i];
            json << "{\"id\":\"" << json_escape(value.id.value) << "\",\"x\":" << value.x << ",\"y\":" << value.y << '}';
        }
        json << "],\"segments\":[";
        for (size_t i=0;i<s.network.segments.size();++i) {
            if(i) json << ',';
            const auto& value=s.network.segments[i];
            json << "{\"id\":\"" << json_escape(value.id.value)
                 << "\",\"startJunctionId\":\"" << json_escape(value.start_junction_id.value)
                 << "\",\"endJunctionId\":\"" << json_escape(value.end_junction_id.value)
                 << "\",\"carriagewayIds\":[";
            for(size_t j=0;j<value.carriageway_ids.size();++j){if(j)json<<',';json<<'\"'<<json_escape(value.carriageway_ids[j].value)<<'\"';}
            json << "]}";
        }
        json << "],\"carriageways\":[";
        for (size_t i=0;i<s.network.carriageways.size();++i) {
            if(i) json << ',';
            const auto& value=s.network.carriageways[i];
            json << "{\"id\":\"" << json_escape(value.id.value)
                 << "\",\"segmentId\":\"" << json_escape(value.segment_id.value)
                 << "\",\"fromJunctionId\":\"" << json_escape(value.from_junction_id.value)
                 << "\",\"toJunctionId\":\"" << json_escape(value.to_junction_id.value)
                 << "\",\"laneIds\":[";
            for(size_t j=0;j<value.lane_ids.size();++j){if(j)json<<',';json<<'\"'<<json_escape(value.lane_ids[j].value)<<'\"';}
            json << "]}";
        }
        json << "],\"lanes\":[";
        for (size_t i=0;i<s.network.lanes.size();++i) {
            if(i) json << ',';
            const auto& value=s.network.lanes[i];
            json << "{\"id\":\"" << json_escape(value.id.value)
                 << "\",\"carriagewayId\":\"" << json_escape(value.carriageway_id.value)
                 << "\",\"ordinal\":" << value.ordinal
                 << ",\"permissions\":" << value.permissions
                 << ",\"open\":" << (value.open?"true":"false") << '}';
        }
        json << "],\"movements\":[";
        for (size_t i=0;i<s.network.movements.size();++i) {
            if(i) json << ',';
            const auto& value=s.network.movements[i];
            json << "{\"id\":\"" << json_escape(value.id.value)
                 << "\",\"junctionId\":\"" << json_escape(value.junction_id.value)
                 << "\",\"fromCarriagewayId\":\"" << json_escape(value.from_carriageway_id.value)
                 << "\",\"toCarriagewayId\":\"" << json_escape(value.to_carriageway_id.value)
                 << "\",\"fromLaneIds\":[";
            for(size_t j=0;j<value.from_lane_ids.size();++j){if(j)json<<',';json<<'\"'<<json_escape(value.from_lane_ids[j].value)<<'\"';}
            json << "],\"toLaneIds\":[";
            for(size_t j=0;j<value.to_lane_ids.size();++j){if(j)json<<',';json<<'\"'<<json_escape(value.to_lane_ids[j].value)<<'\"';}
            json << "],\"permissions\":" << value.permissions
                 << ",\"allowed\":" << (value.allowed?"true":"false") << '}';
        }
        json << "],\"roadSegmentCount\":" << s.network.segments.size()
             << ",\"laneCount\":" << s.network.lanes.size()
             << ",\"movementCount\":" << s.network.movements.size()
             << ",\"parkingFacilityCount\":" << s.parking.facilities.size()
             << ",\"incidentCount\":" << s.incidents.incidents.size()
             << ",\"transitStopCount\":" << s.transit.stops.size()
             << ",\"transitLineCount\":" << s.transit.lines.size()
             << ",\"waitingPassengerWeight\":" << h->authority.queues().total_waiting_weight()
             << ",\"domainHash\":\"" << h->authority.domain_hash() << "\"}";
        h->last_error.clear();
        return write_buffer(out,json.str());
    }
    catch(const std::exception& e){return error(h,CF_INVALID_STATE,e.what());}catch(...){return error(h,CF_INTERNAL_ERROR,"unknown native transport error");}
}
extern "C" uint64_t cf_transport_domain_hash(const cf_transport_handle* h){return h?h->authority.domain_hash():0;}
extern "C" cf_result cf_transport_get_last_error(const cf_transport_handle* h, cf_buffer* out){if(!h||!out)return CF_INVALID_ARGUMENT;return write_buffer(out,h->last_error);}
extern "C" void cf_buffer_free(cf_buffer* buffer){if(!buffer)return;std::free(buffer->data);buffer->data=nullptr;buffer->size=0;}
