#include <civic/transport/Transportation.hpp>

#include <array>
#include <charconv>
#include <cstddef>
#include <cstring>
#include <iomanip>
#include <numbers>
#include <queue>
#include <sstream>
#include <unordered_map>

namespace civic::transport {
namespace {

template<class Id>
[[nodiscard]] Result<void> requireId(const Id& id, std::string_view label) {
    if (id.empty()) return std::unexpected(make_error(ErrorCode::invariant_failure, std::string(label) + " id must not be empty"));
    return {};
}
[[nodiscard]] Result<void> requireFinite(double value, std::string_view label) {
    if (!std::isfinite(value)) return std::unexpected(make_error(ErrorCode::invariant_failure, std::string(label) + " must be finite"));
    return {};
}
[[nodiscard]] Result<void> requireNonNegative(double value, std::string_view label) {
    auto finite = requireFinite(value, label); if (!finite) return finite;
    if (value < 0.0) return std::unexpected(make_error(ErrorCode::invariant_failure, std::string(label) + " must be non-negative"));
    return {};
}
[[nodiscard]] Result<void> requirePermissionMask(VehiclePermissionMask value, std::string_view label) {
    if ((value & ~all_vehicle_permissions) != 0U) return std::unexpected(make_error(ErrorCode::invariant_failure, std::string(label) + " has invalid permission bits"));
    return {};
}

template<class T, class GetId>
[[nodiscard]] Result<void> requireUniqueIds(const std::vector<T>& values, std::string_view label, GetId get_id) {
    using Id = std::decay_t<decltype(get_id(values.front()))>;
    std::set<Id> ids;
    for (const auto& value : values) {
        const auto& id = get_id(value);
        auto valid = requireId(id, label); if (!valid) return valid;
        if (!ids.insert(id).second) return std::unexpected(make_error(ErrorCode::invariant_failure, "duplicate " + std::string(label) + " id: " + id.value()));
    }
    return {};
}

template<class Id>
[[nodiscard]] bool uniqueRefs(const std::vector<Id>& ids) {
    return std::set<Id>(ids.begin(), ids.end()).size() == ids.size();
}

template<class T>
void sortById(std::vector<T>& values) {
    std::sort(values.begin(), values.end(), [](const T& a, const T& b) { return a.id < b.id; });
}

[[nodiscard]] bool isTravelLane(LaneType type) noexcept {
    return type != LaneType::parking && type != LaneType::shoulder;
}

[[nodiscard]] std::string cellKey(std::int32_t x, std::int32_t y) {
    return std::to_string(x) + "," + std::to_string(y);
}
[[nodiscard]] JunctionId legacyJunctionId(std::string_view key) { return JunctionId{"j:legacy:" + std::string(key)}; }
[[nodiscard]] SegmentId legacySegmentId(std::string_view a, std::string_view b) {
    const auto ordered = a < b ? std::pair{a, b} : std::pair{b, a};
    return SegmentId{"s:legacy:" + std::string(ordered.first) + ">" + std::string(ordered.second)};
}
[[nodiscard]] CarriagewayId legacyCarriagewayId(const SegmentId& segment, const JunctionId& from, const JunctionId& to) {
    return CarriagewayId{"c:" + segment.value() + ":" + from.value() + ">" + to.value()};
}
[[nodiscard]] LaneId legacyLaneId(const CarriagewayId& carriageway, std::uint32_t ordinal) {
    return LaneId{"l:" + carriageway.value() + ":" + std::to_string(ordinal)};
}
[[nodiscard]] MovementId legacyMovementId(const JunctionId& junction, const CarriagewayId& from, const CarriagewayId& to) {
    return MovementId{"m:" + junction.value() + ":" + from.value() + ">" + to.value()};
}
[[nodiscard]] int roadRank(RoadClass value) noexcept { return static_cast<int>(value); }

[[nodiscard]] TransportAuthority canonicalize(TransportAuthority authority) {
    sortById(authority.junctions); sortById(authority.segments); sortById(authority.carriageways); sortById(authority.lanes); sortById(authority.movements);
    std::map<LaneId, std::uint32_t> ordinals;
    for (const auto& lane : authority.lanes) ordinals[lane.id] = lane.ordinal;
    for (auto& segment : authority.segments) {
        std::sort(segment.carriagewayIds.begin(), segment.carriagewayIds.end());
        std::sort(segment.sourceLegacyCells.begin(), segment.sourceLegacyCells.end());
    }
    for (auto& carriageway : authority.carriageways) {
        std::sort(carriageway.laneIds.begin(), carriageway.laneIds.end(), [&](const LaneId& a, const LaneId& b) {
            const auto ao = ordinals.contains(a) ? ordinals[a] : 0U;
            const auto bo = ordinals.contains(b) ? ordinals[b] : 0U;
            if (ao != bo) return ao < bo;
            return a < b;
        });
    }
    for (auto& movement : authority.movements) {
        auto order = [&](const LaneId& a, const LaneId& b) {
            const auto ao = ordinals.contains(a) ? ordinals[a] : 0U;
            const auto bo = ordinals.contains(b) ? ordinals[b] : 0U;
            if (ao != bo) return ao < bo;
            return a < b;
        };
        std::sort(movement.fromLaneIds.begin(), movement.fromLaneIds.end(), order);
        std::sort(movement.toLaneIds.begin(), movement.toLaneIds.end(), order);
    }
    return authority;
}

[[nodiscard]] const Junction* findJunction(const TransportNetworkSnapshot& snapshot, const JunctionId& id) noexcept {
    const auto it = std::lower_bound(snapshot.junctions.begin(), snapshot.junctions.end(), id, [](const Junction& j, const JunctionId& needle){ return j.id < needle; });
    return it != snapshot.junctions.end() && it->id == id ? &*it : nullptr;
}
[[nodiscard]] const Lane* findLane(const TransportNetworkSnapshot& snapshot, const LaneId& id) noexcept {
    const auto it = std::lower_bound(snapshot.lanes.begin(), snapshot.lanes.end(), id, [](const Lane& lane, const LaneId& needle){ return lane.id < needle; });
    return it != snapshot.lanes.end() && it->id == id ? &*it : nullptr;
}

[[nodiscard]] std::pair<double,double> heading(const Junction& from, const Junction& to) noexcept {
    return {to.x - from.x, to.y - from.y};
}
[[nodiscard]] MovementType classifyMovement(const Junction& incoming_from, const Junction& junction, const Junction& outgoing_to) noexcept {
    const auto [ax, ay] = heading(incoming_from, junction);
    const auto [bx, by] = heading(junction, outgoing_to);
    const double dot = ax * bx + ay * by;
    const double cross = ax * by - ay * bx;
    if (dot < -0.5) return MovementType::u_turn;
    if (std::abs(cross) < 0.5 && dot > 0.0) return MovementType::through;
    return cross > 0.0 ? MovementType::right : MovementType::left;
}

[[nodiscard]] VehiclePermissionMask eligiblePermissions(const TransportNetworkSnapshot& snapshot, const Carriageway& carriageway) noexcept {
    VehiclePermissionMask mask = 0U;
    for (const auto& lane_id : carriageway.laneIds) {
        const auto* lane = findLane(snapshot, lane_id);
        if (!lane || lane->operatingState != LaneState::open || !isTravelLane(lane->type)) continue;
        mask |= lane->permissions;
    }
    return mask;
}

} // namespace

const RoadClassDefinition& roadClassDefinition(RoadClass road_class) {
    static const std::array<RoadClassDefinition, 6> values{{
        {1U, 60.0, 1.5, 54.0}, {2U, 120.0, 2.5, 90.0}, {3U, 240.0, 4.0, 144.0},
        {3U, 300.0, 4.5, 162.0}, {3U, 360.0, 5.5, 198.0}, {4U, 480.0, 6.0, 216.0},
    }};
    return values.at(static_cast<std::size_t>(road_class));
}

Result<RoadClass> parseRoadClass(std::string_view value) {
    if (value == "local") return RoadClass::local; if (value == "collector") return RoadClass::collector; if (value == "arterial") return RoadClass::arterial;
    if (value == "avenue") return RoadClass::avenue; if (value == "expressway") return RoadClass::expressway; if (value == "highway") return RoadClass::highway;
    return std::unexpected(make_error(ErrorCode::invalid_argument, "unknown road class: " + std::string(value)));
}
std::string_view toString(RoadClass value) noexcept {
    switch (value) { case RoadClass::local:return "local"; case RoadClass::collector:return "collector"; case RoadClass::arterial:return "arterial"; case RoadClass::avenue:return "avenue"; case RoadClass::expressway:return "expressway"; case RoadClass::highway:return "highway"; }
    return "local";
}

Result<void> TransportNetworkStore::validate(const TransportAuthority& authority) const {
    if (!authority.junctions.empty()) { auto r = requireUniqueIds(authority.junctions, "junction", [](const Junction& v) -> const JunctionId& { return v.id; }); if (!r) return r; }
    if (!authority.segments.empty()) { auto r = requireUniqueIds(authority.segments, "segment", [](const RoadSegment& v) -> const SegmentId& { return v.id; }); if (!r) return r; }
    if (!authority.carriageways.empty()) { auto r = requireUniqueIds(authority.carriageways, "carriageway", [](const Carriageway& v) -> const CarriagewayId& { return v.id; }); if (!r) return r; }
    if (!authority.lanes.empty()) { auto r = requireUniqueIds(authority.lanes, "lane", [](const Lane& v) -> const LaneId& { return v.id; }); if (!r) return r; }
    if (!authority.movements.empty()) { auto r = requireUniqueIds(authority.movements, "movement", [](const TurnMovement& v) -> const MovementId& { return v.id; }); if (!r) return r; }
    std::map<JunctionId, const Junction*> junctions; for (const auto& v : authority.junctions) junctions.emplace(v.id, &v);
    std::map<SegmentId, const RoadSegment*> segments; for (const auto& v : authority.segments) segments.emplace(v.id, &v);
    std::map<CarriagewayId, const Carriageway*> carriageways; for (const auto& v : authority.carriageways) carriageways.emplace(v.id, &v);
    std::map<LaneId, const Lane*> lanes; for (const auto& v : authority.lanes) lanes.emplace(v.id, &v);
    for (const auto& junction : authority.junctions) { auto x=requireFinite(junction.x,"junction x");if(!x)return x;auto y=requireFinite(junction.y,"junction y");if(!y)return y; }
    for (const auto& segment : authority.segments) {
        if (!junctions.contains(segment.startJunctionId) || !junctions.contains(segment.endJunctionId)) return std::unexpected(make_error(ErrorCode::invariant_failure,"segment references missing junction: "+segment.id.value()));
        if (segment.startJunctionId == segment.endJunctionId) return std::unexpected(make_error(ErrorCode::invariant_failure,"segment endpoints must differ: "+segment.id.value()));
        if (!uniqueRefs(segment.carriagewayIds)) return std::unexpected(make_error(ErrorCode::invariant_failure,"segment has duplicate carriageway references: "+segment.id.value()));
        auto length=requireNonNegative(segment.lengthMeters,"segment length");if(!length||segment.lengthMeters<=0.0)return std::unexpected(make_error(ErrorCode::invariant_failure,"segment length must be positive"));
        auto speed=requireNonNegative(segment.speedLimitKph,"segment speed");if(!speed)return speed;auto condition=requireFinite(segment.condition,"segment condition");if(!condition)return condition;
        for(const auto& carriageway_id:segment.carriagewayIds){const auto it=carriageways.find(carriageway_id);if(it==carriageways.end()||it->second->segmentId!=segment.id)return std::unexpected(make_error(ErrorCode::invariant_failure,"segment references invalid carriageway: "+carriageway_id.value()));}
    }
    for (const auto& carriageway : authority.carriageways) {
        const auto segment_it=segments.find(carriageway.segmentId);if(segment_it==segments.end())return std::unexpected(make_error(ErrorCode::invariant_failure,"carriageway references missing segment: "+carriageway.id.value()));const auto& segment=*segment_it->second;
        if(std::ranges::find(segment.carriagewayIds,carriageway.id)==segment.carriagewayIds.end())return std::unexpected(make_error(ErrorCode::invariant_failure,"carriageway not owned by parent segment: "+carriageway.id.value()));
        const auto expected_from=carriageway.direction==Direction::forward?segment.startJunctionId:segment.endJunctionId;const auto expected_to=carriageway.direction==Direction::forward?segment.endJunctionId:segment.startJunctionId;
        if(carriageway.fromJunctionId!=expected_from||carriageway.toJunctionId!=expected_to)return std::unexpected(make_error(ErrorCode::invariant_failure,"carriageway endpoints do not match segment orientation: "+carriageway.id.value()));
        if(!uniqueRefs(carriageway.laneIds))return std::unexpected(make_error(ErrorCode::invariant_failure,"carriageway has duplicate lane refs: "+carriageway.id.value()));std::set<std::uint32_t> ordinals;
        for(const auto& lane_id:carriageway.laneIds){const auto lane_it=lanes.find(lane_id);if(lane_it==lanes.end()||lane_it->second->carriagewayId!=carriageway.id)return std::unexpected(make_error(ErrorCode::invariant_failure,"carriageway references invalid lane: "+lane_id.value()));if(!ordinals.insert(lane_it->second->ordinal).second)return std::unexpected(make_error(ErrorCode::invariant_failure,"duplicate lane ordinal in carriageway: "+carriageway.id.value()));}
    }
    for(const auto& lane:authority.lanes){const auto carriageway_it=carriageways.find(lane.carriagewayId);if(carriageway_it==carriageways.end()||std::ranges::find(carriageway_it->second->laneIds,lane.id)==carriageway_it->second->laneIds.end())return std::unexpected(make_error(ErrorCode::invariant_failure,"lane references invalid carriageway: "+lane.id.value()));auto permissions=requirePermissionMask(lane.permissions,"lane permissions");if(!permissions)return permissions;auto capacity=requireNonNegative(lane.baseCapacityPerMinute,"lane capacity");if(!capacity)return capacity;auto speed=requireNonNegative(lane.freeFlowSpeedKph,"lane speed");if(!speed)return speed;if((lane.type==LaneType::parking||lane.type==LaneType::shoulder)&&lane.baseCapacityPerMinute!=0.0)return std::unexpected(make_error(ErrorCode::invariant_failure,"parking/shoulder lane travel capacity must be zero"));}
    for(const auto& movement:authority.movements){const auto from_it=carriageways.find(movement.fromCarriagewayId);const auto to_it=carriageways.find(movement.toCarriagewayId);if(from_it==carriageways.end()||to_it==carriageways.end())return std::unexpected(make_error(ErrorCode::invariant_failure,"movement references missing carriageway: "+movement.id.value()));if(!junctions.contains(movement.junctionId)||from_it->second->toJunctionId!=movement.junctionId||to_it->second->fromJunctionId!=movement.junctionId)return std::unexpected(make_error(ErrorCode::invariant_failure,"movement carriageways do not meet at junction: "+movement.id.value()));if(movement.fromLaneIds.empty()||movement.toLaneIds.empty()||!uniqueRefs(movement.fromLaneIds)||!uniqueRefs(movement.toLaneIds))return std::unexpected(make_error(ErrorCode::invariant_failure,"movement lane membership invalid: "+movement.id.value()));for(const auto& lane_id:movement.fromLaneIds){const auto lane_it=lanes.find(lane_id);if(lane_it==lanes.end()||lane_it->second->carriagewayId!=movement.fromCarriagewayId)return std::unexpected(make_error(ErrorCode::invariant_failure,"movement incoming lane belongs to wrong carriageway: "+movement.id.value()));}for(const auto& lane_id:movement.toLaneIds){const auto lane_it=lanes.find(lane_id);if(lane_it==lanes.end()||lane_it->second->carriagewayId!=movement.toCarriagewayId)return std::unexpected(make_error(ErrorCode::invariant_failure,"movement outgoing lane belongs to wrong carriageway: "+movement.id.value()));}auto permissions=requirePermissionMask(movement.permissions,"movement permissions");if(!permissions)return permissions;auto penalty=requireNonNegative(movement.basePenaltyTicks,"movement penalty");if(!penalty)return penalty;}
    return {};
}
Result<void> TransportNetworkStore::validate() const{return validate(authority_);} 
MutationResult TransportNetworkStore::replaceAuthority(TransportAuthority authority){auto valid=validate(authority);if(!valid)return{false,false,valid.error().message};authority=canonicalize(std::move(authority));if(authority==authority_)return{true,false,{}};authority_=std::move(authority);++topology_revision_;return{true,true,{}};}
MutationResult TransportNetworkStore::setLaneOperatingState(const LaneId& id,LaneState state){auto candidate=authority_;const auto it=std::ranges::find(candidate.lanes,id,&Lane::id);if(it==candidate.lanes.end())return{false,false,"unknown lane: "+id.value()};if(it->operatingState==state)return{true,false,{}};it->operatingState=state;auto valid=validate(candidate);if(!valid)return{false,false,valid.error().message};authority_=canonicalize(std::move(candidate));++topology_revision_;return{true,true,{}};}
MutationResult TransportNetworkStore::setLanePermissions(const LaneId& id,VehiclePermissionMask permissions){if((permissions&~all_vehicle_permissions)!=0U)return{false,false,"invalid permissions"};auto candidate=authority_;const auto it=std::ranges::find(candidate.lanes,id,&Lane::id);if(it==candidate.lanes.end())return{false,false,"unknown lane: "+id.value()};if(it->permissions==permissions)return{true,false,{}};it->permissions=permissions;auto valid=validate(candidate);if(!valid)return{false,false,valid.error().message};authority_=canonicalize(std::move(candidate));++topology_revision_;return{true,true,{}};}
MutationResult TransportNetworkStore::setMovementAllowed(const MovementId& id,bool allowed){auto candidate=authority_;const auto it=std::ranges::find(candidate.movements,id,&TurnMovement::id);if(it==candidate.movements.end())return{false,false,"unknown movement: "+id.value()};if(it->allowed==allowed)return{true,false,{}};it->allowed=allowed;auto valid=validate(candidate);if(!valid)return{false,false,valid.error().message};authority_=canonicalize(std::move(candidate));++topology_revision_;return{true,true,{}};}
MutationResult TransportNetworkStore::setMovementPermissions(const MovementId& id,VehiclePermissionMask permissions){if((permissions&~all_vehicle_permissions)!=0U)return{false,false,"invalid permissions"};auto candidate=authority_;const auto it=std::ranges::find(candidate.movements,id,&TurnMovement::id);if(it==candidate.movements.end())return{false,false,"unknown movement: "+id.value()};if(it->permissions==permissions)return{true,false,{}};it->permissions=permissions;auto valid=validate(candidate);if(!valid)return{false,false,valid.error().message};authority_=canonicalize(std::move(candidate));++topology_revision_;return{true,true,{}};}
TransportNetworkSnapshot TransportNetworkStore::snapshot()const{auto copy=canonicalize(authority_);TransportNetworkSnapshot result;static_cast<TransportAuthority&>(result)=std::move(copy);result.topologyRevision=topology_revision_;result.costRevision=cost_revision_;return result;}
Result<void> TransportNetworkStore::restore(const TransportNetworkSnapshot& snapshot_value){TransportAuthority candidate=snapshot_value;auto valid=validate(candidate);if(!valid)return valid;authority_=canonicalize(std::move(candidate));topology_revision_=snapshot_value.topologyRevision;cost_revision_=snapshot_value.costRevision;return{};}
const Carriageway* TransportNetworkStore::carriageway(const CarriagewayId& id)const noexcept{const auto it=std::ranges::find(authority_.carriageways,id,&Carriageway::id);return it==authority_.carriageways.end()?nullptr:&*it;}const Lane* TransportNetworkStore::lane(const LaneId& id)const noexcept{const auto it=std::ranges::find(authority_.lanes,id,&Lane::id);return it==authority_.lanes.end()?nullptr:&*it;}const TurnMovement* TransportNetworkStore::movement(const MovementId& id)const noexcept{const auto it=std::ranges::find(authority_.movements,id,&TurnMovement::id);return it==authority_.movements.end()?nullptr:&*it;}

Result<std::vector<LaneGroup>> buildLaneGroups(const TransportNetworkSnapshot& snapshot){std::map<CarriagewayId,std::vector<const TurnMovement*>> by_carriageway;for(const auto& movement:snapshot.movements)if(movement.allowed)by_carriageway[movement.fromCarriagewayId].push_back(&movement);std::vector<LaneGroup> groups;for(const auto& carriageway:snapshot.carriageways){struct Signature final{VehiclePermissionMask permissions{};double speed{};std::vector<MovementId> movements;auto operator<=>(const Signature&)const=default;};std::map<Signature,std::vector<const Lane*>> buckets;for(const auto& lane_id:carriageway.laneIds){const auto* lane=findLane(snapshot,lane_id);if(!lane||lane->operatingState!=LaneState::open||!isTravelLane(lane->type)||lane->baseCapacityPerMinute<=0.0)continue;Signature signature{lane->permissions,lane->freeFlowSpeedKph,{}};const auto found=by_carriageway.find(carriageway.id);if(found!=by_carriageway.end())for(const auto* movement:found->second)if(std::ranges::find(movement->fromLaneIds,lane->id)!=movement->fromLaneIds.end()&&(movement->permissions&lane->permissions)!=0U)signature.movements.push_back(movement->id);std::sort(signature.movements.begin(),signature.movements.end());buckets[signature].push_back(lane);}std::uint32_t ordinal=0U;for(auto&[signature,lanes]:buckets){std::sort(lanes.begin(),lanes.end(),[](const Lane* a,const Lane* b){return a->ordinal<b->ordinal||(a->ordinal==b->ordinal&&a->id<b->id);});LaneGroup group;group.id=LaneGroupId{"lg:"+carriageway.id.value()+":"+std::to_string(ordinal++)};group.carriagewayId=carriageway.id;group.permissions=signature.permissions;group.freeFlowSpeedKph=signature.speed;group.movementIds=signature.movements;for(const auto* lane:lanes){group.laneIds.push_back(lane->id);group.capacityPerMinute+=lane->baseCapacityPerMinute;}groups.push_back(std::move(group));}}sortById(groups);return groups;}

Result<LegacyMigrationResult> LegacyRoadMigrationAdapter::project(const LegacyRoadState& state) const {
    std::map<std::string,LegacyRoadCell> cells;for(const auto& cell:state.cells){if(cell.roadClass>RoadClass::arterial)return std::unexpected(make_error(ErrorCode::invalid_argument,"legacy roads only support local/collector/arterial"));const auto key=cellKey(cell.x,cell.y);if(!cells.emplace(key,cell).second)return std::unexpected(make_error(ErrorCode::invariant_failure,"duplicate legacy road cell: "+key));}
    TransportAuthority authority;for(const auto&[key,cell]:cells)authority.junctions.push_back(Junction{legacyJunctionId(key),static_cast<double>(cell.x),static_cast<double>(cell.y),key});
    std::set<std::pair<std::string,std::string>> pairs;constexpr std::array<std::pair<std::int32_t,std::int32_t>,4> directions{{{1,0},{-1,0},{0,1},{0,-1}}};for(const auto&[key,cell]:cells)for(const auto&[dx,dy]:directions){const auto other_key=cellKey(cell.x+dx,cell.y+dy);if(!cells.contains(other_key))continue;pairs.insert(key<other_key?std::pair{key,other_key}:std::pair{other_key,key});}
    for(const auto&[a_key,b_key]:pairs){const auto& a=cells.at(a_key);const auto& b=cells.at(b_key);const auto a_junction=legacyJunctionId(a_key);const auto b_junction=legacyJunctionId(b_key);const auto segment_id=legacySegmentId(a_key,b_key);const auto parent_class=roadRank(a.roadClass)>=roadRank(b.roadClass)?a.roadClass:b.roadClass;const auto a_to_b_id=legacyCarriagewayId(segment_id,a_junction,b_junction);const auto b_to_a_id=legacyCarriagewayId(segment_id,b_junction,a_junction);authority.segments.push_back(RoadSegment{segment_id,parent_class,"legacy:"+a_key+">"+b_key,a_junction,b_junction,10.0,std::max(roadClassDefinition(a.roadClass).freeFlowSpeedKph,roadClassDefinition(b.roadClass).freeFlowSpeedKph),1.0,"legacy",std::nullopt,{a_to_b_id,b_to_a_id},{a_key,b_key}});auto make_carriageway=[&](const LegacyRoadCell& source,const CarriagewayId& id,Direction dir,const JunctionId& from,const JunctionId& to){Carriageway carriageway{id,segment_id,dir,from,to,source.roadClass,{}};const auto& definition=roadClassDefinition(source.roadClass);const double lane_capacity=definition.capacityPerMinute/static_cast<double>(definition.legacyLaneCount);for(std::uint32_t ordinal=0U;ordinal<definition.legacyLaneCount;++ordinal){const auto lane_id=legacyLaneId(id,ordinal);carriageway.laneIds.push_back(lane_id);authority.lanes.push_back(Lane{lane_id,id,ordinal,LaneType::through,all_vehicle_permissions,LaneState::open,lane_capacity,definition.freeFlowSpeedKph});}authority.carriageways.push_back(std::move(carriageway));};make_carriageway(a,a_to_b_id,Direction::forward,a_junction,b_junction);make_carriageway(b,b_to_a_id,Direction::backward,b_junction,a_junction);}
    auto partial=canonicalize(authority);TransportNetworkSnapshot snapshot;static_cast<TransportAuthority&>(snapshot)=partial;for(const auto& junction:partial.junctions){std::vector<const Carriageway*> incoming,outgoing;for(const auto& carriageway:partial.carriageways){if(carriageway.toJunctionId==junction.id)incoming.push_back(&carriageway);if(carriageway.fromJunctionId==junction.id)outgoing.push_back(&carriageway);}for(const auto* from:incoming)for(const auto* to:outgoing){const auto* incoming_from=findJunction(snapshot,from->fromJunctionId);const auto* outgoing_to=findJunction(snapshot,to->toJunctionId);if(!incoming_from||!outgoing_to)continue;const auto type=classifyMovement(*incoming_from,junction,*outgoing_to);VehiclePermissionMask permissions=eligiblePermissions(snapshot,*from)&eligiblePermissions(snapshot,*to);std::vector<LaneId> from_lanes,to_lanes;for(const auto& id:from->laneIds){const auto* lane=findLane(snapshot,id);if(lane&&isTravelLane(lane->type)&&lane->operatingState==LaneState::open)from_lanes.push_back(id);}for(const auto& id:to->laneIds){const auto* lane=findLane(snapshot,id);if(lane&&isTravelLane(lane->type)&&lane->operatingState==LaneState::open)to_lanes.push_back(id);}authority.movements.push_back(TurnMovement{legacyMovementId(junction.id,from->id,to->id),junction.id,from->id,to->id,std::move(from_lanes),std::move(to_lanes),type,permissions,type!=MovementType::u_turn,type==MovementType::through?0.0:(type==MovementType::right?1.0:2.0)});}}
    TransportNetworkStore validator;auto result=validator.replaceAuthority(authority);if(!result.ok)return std::unexpected(make_error(ErrorCode::invariant_failure,result.reason));auto migrated=validator.snapshot();LegacyMigrationResult output;static_cast<TransportAuthority&>(output.authority)=static_cast<const TransportAuthority&>(migrated);return output;
}

} // namespace civic::transport
