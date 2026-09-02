#include <civic/transport/transport_engine.hpp>

#include <algorithm>
#include <cmath>
#include <limits>
#include <numeric>
#include <sstream>

namespace civic::transport {
namespace {
constexpr double eps = 1e-9;
constexpr double legacy_cell_meters = 10.0;

[[noreturn]] void fail(const std::string& message) { throw std::runtime_error(message); }
void finite(double v, std::string_view label) { if (!std::isfinite(v)) fail(std::string(label) + " must be finite"); }
void nonnegative(double v, std::string_view label) { finite(v,label); if (v < 0) fail(std::string(label) + " must be non-negative"); }
void positive(double v, std::string_view label) { finite(v,label); if (v <= 0) fail(std::string(label) + " must be positive"); }

template<class T> void require_id(const T& id, std::string_view label) { if (id.value.empty()) fail(std::string(label) + " id must not be empty"); }
template<class T> void sort_id(std::vector<T>& values) { std::sort(values.begin(), values.end(), [](const T& a, const T& b){ return a.id < b.id; }); }
template<class IdT> void sort_ids(std::vector<IdT>& values) { std::sort(values.begin(), values.end()); }

template<class T, class IdT, class F>
std::map<IdT,const T*> index_unique(const std::vector<T>& values, F id_of, std::string_view label) {
    std::map<IdT,const T*> out;
    for (const auto& value : values) {
        auto id = id_of(value); require_id(id,label);
        if (!out.emplace(id,&value).second) fail("duplicate " + std::string(label) + " id: " + id.value);
    }
    return out;
}

template<class IdT> void unique_refs(const std::vector<IdT>& ids, std::string_view label) {
    std::set<IdT> seen;
    for (const auto& id : ids) if (!seen.insert(id).second) fail(std::string(label) + " contains duplicate references");
}

int road_rank(RoadClass c) {
    switch(c) { case RoadClass::local:return 0; case RoadClass::collector:return 1; case RoadClass::arterial:return 2; case RoadClass::avenue:return 3; case RoadClass::expressway:return 4; case RoadClass::highway:return 5; }
    return 0;
}
int legacy_lane_count(RoadClass c) { switch(c) { case RoadClass::local:return 1; case RoadClass::collector:return 2; default:return 3; } }
double legacy_capacity(RoadClass c) { switch(c) { case RoadClass::local:return 60; case RoadClass::collector:return 120; default:return 240; } }
double legacy_speed_kph(RoadClass c) { switch(c) { case RoadClass::local:return 1.5*10*3.6; case RoadClass::collector:return 2.5*10*3.6; default:return 4.0*10*3.6; } }
std::string cell_key(int x,int y) { return std::to_string(x)+","+std::to_string(y); }
JunctionId legacy_junction(int x,int y) { return JunctionId{"j:legacy:"+cell_key(x,y)}; }
SegmentId legacy_segment(const std::string& a,const std::string& b) { return SegmentId{"s:legacy:"+(a<b?a+">"+b:b+">"+a)}; }
CarriagewayId legacy_carriageway(const SegmentId& s,const JunctionId& a,const JunctionId& b) { return CarriagewayId{"c:"+s.value+":"+a.value+">"+b.value}; }
LaneId legacy_lane(const CarriagewayId& c,int ordinal) { return LaneId{"l:"+c.value+":"+std::to_string(ordinal)}; }

bool travel_lane(const Lane& l) { return l.open && l.type != LaneType::parking && l.type != LaneType::shoulder; }
std::pair<int,int> heading(const Junction& a,const Junction& b) {
    const auto dx = (b.x>a.x)-(b.x<a.x); const auto dy=(b.y>a.y)-(b.y<a.y);
    if ((dx==0 && dy==0) || (dx!=0 && dy!=0)) fail("movement geometry must be cardinal");
    return {dx,dy};
}
MovementType classify_turn(const Junction& incoming_from,const Junction& junction,const Junction& outgoing_to) {
    auto [ix,iy]=heading(incoming_from,junction); auto [ox,oy]=heading(junction,outgoing_to);
    const int dot=ix*ox+iy*oy; const int cross=ix*oy-iy*ox;
    if (dot == 1) return MovementType::through;
    if (dot == -1) return MovementType::u_turn;
    if (cross == 1) return MovementType::right;
    if (cross == -1) return MovementType::left;
    fail("unable to classify turn");
}
double movement_penalty(MovementType t) { switch(t){ case MovementType::through:return 0; case MovementType::right:return 1; case MovementType::left:return 2; case MovementType::u_turn:return 4;} return 0; }

NetworkSnapshot canonical(NetworkSnapshot s) {
    for(auto& seg:s.segments){ sort_ids(seg.carriageway_ids); std::sort(seg.source_legacy_cells.begin(),seg.source_legacy_cells.end()); }
    const std::map<LaneId,std::uint32_t> ordinals = [&]{ std::map<LaneId,std::uint32_t> m; for(const auto& l:s.lanes)m[l.id]=l.ordinal; return m;}();
    for(auto& cw:s.carriageways) std::sort(cw.lane_ids.begin(),cw.lane_ids.end(),[&](auto a,auto b){auto ia=ordinals.at(a),ib=ordinals.at(b);return ia==ib?a<b:ia<ib;});
    for(auto& m:s.movements){ sort_ids(m.from_lane_ids); sort_ids(m.to_lane_ids); }
    sort_id(s.junctions); sort_id(s.segments); sort_id(s.carriageways); sort_id(s.lanes); sort_id(s.movements); return s;
}
bool same_network_content(NetworkSnapshot a, NetworkSnapshot b) { a.topology_revision=b.topology_revision=0; a.cost_revision=b.cost_revision=0; return canonical(std::move(a))==canonical(std::move(b)); }
std::string state_key(const JunctionId& j,const std::optional<CarriagewayId>& incoming) { return j.value+"|"+(incoming?incoming->value:"-"); }
std::string queue_key(const TransitStopId& s,const TransitLineId& l,std::string_view d) { return s.value+"|"+l.value+"|"+std::string(d); }

double sum_weight(const std::vector<PassengerCohort>& cohorts) { double v=0; for(const auto& c:cohorts)v+=c.traveler_weight; return v; }
