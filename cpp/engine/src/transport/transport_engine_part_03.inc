          << ':' << v.vehicle.stop_serviced << ':' << v.vehicle.reliability << ':' << v.onboard.size();
        for (const auto& c : v.onboard) cohort(c);
    }
    return o.str();
}
}

void validate_network(const NetworkSnapshot& s) {
    const auto junctions=index_unique<Junction,JunctionId>(s.junctions,[](const auto& v){return v.id;},"junction");
    const auto segments=index_unique<RoadSegment,SegmentId>(s.segments,[](const auto& v){return v.id;},"segment");
    const auto carriageways=index_unique<Carriageway,CarriagewayId>(s.carriageways,[](const auto& v){return v.id;},"carriageway");
    const auto lanes=index_unique<Lane,LaneId>(s.lanes,[](const auto& v){return v.id;},"lane");
    index_unique<TurnMovement,MovementId>(s.movements,[](const auto& v){return v.id;},"movement");
    for(const auto& j:s.junctions){finite(j.x,"junction x");finite(j.y,"junction y");}
    for(const auto& seg:s.segments){
        if(!junctions.contains(seg.start_junction_id)||!junctions.contains(seg.end_junction_id)) fail("segment references missing junction");
        if (seg.start_junction_id == seg.end_junction_id) fail("segment endpoints must be distinct");
        positive(seg.length_meters,"segment length");
        nonnegative(seg.speed_limit_kph,"segment speed");
        finite(seg.condition,"segment condition");
        unique_refs(seg.carriageway_ids,"segment carriageways");
        for(const auto& id:seg.carriageway_ids){auto it=carriageways.find(id);if(it==carriageways.end()||it->second->segment_id!=seg.id)fail("segment references invalid carriageway");}
    }
    for(const auto& cw:s.carriageways){
        auto sit=segments.find(cw.segment_id);if(sit==segments.end())fail("carriageway references missing segment");const auto& seg=*sit->second;
        if(std::find(seg.carriageway_ids.begin(),seg.carriageway_ids.end(),cw.id)==seg.carriageway_ids.end())fail("carriageway not owned by segment");
        const auto from=cw.direction==Direction::forward?seg.start_junction_id:seg.end_junction_id;const auto to=cw.direction==Direction::forward?seg.end_junction_id:seg.start_junction_id;
        if (cw.from_junction_id != from || cw.to_junction_id != to) fail("carriageway endpoints mismatch");
        unique_refs(cw.lane_ids,"carriageway lanes");
        std::set<std::uint32_t> ord;
        for(const auto& id:cw.lane_ids){auto it=lanes.find(id);if(it==lanes.end()||it->second->carriageway_id!=cw.id)fail("invalid lane reference");if(!ord.insert(it->second->ordinal).second)fail("duplicate lane ordinal");}
    }
    for(const auto& l:s.lanes){if(!carriageways.contains(l.carriageway_id))fail("lane references missing carriageway"); if((l.permissions&~all_vehicle_permissions)!=0)fail("invalid lane permissions");nonnegative(l.base_capacity_per_minute,"lane capacity");nonnegative(l.free_flow_speed_kph,"lane speed");}
    for(const auto& m:s.movements){
        auto from=carriageways.find(m.from_carriageway_id),to=carriageways.find(m.to_carriageway_id);if(from==carriageways.end()||to==carriageways.end())fail("movement references missing carriageway");
        if(!junctions.contains(m.junction_id)||from->second->to_junction_id!=m.junction_id||to->second->from_junction_id!=m.junction_id)fail("movement geometry/reference invalid");
        unique_refs(m.from_lane_ids,"movement incoming lanes");unique_refs(m.to_lane_ids,"movement outgoing lanes");if(m.from_lane_ids.empty()||m.to_lane_ids.empty())fail("movement must reference lanes");
        for(const auto& id:m.from_lane_ids)if(std::find(from->second->lane_ids.begin(),from->second->lane_ids.end(),id)==from->second->lane_ids.end())fail("movement incoming lane wrong carriageway");
        for(const auto& id:m.to_lane_ids)if(std::find(to->second->lane_ids.begin(),to->second->lane_ids.end(),id)==to->second->lane_ids.end())fail("movement outgoing lane wrong carriageway");
        if ((m.permissions & ~all_vehicle_permissions) != 0) fail("invalid movement permissions");
        nonnegative(m.base_penalty_ticks,"movement penalty");
    }
}

std::vector<TurnMovement> build_turn_movements(const NetworkSnapshot& s) {
    std::map<JunctionId,const Junction*> js;for(const auto& j:s.junctions)js[j.id]=&j;
    std::map<LaneId,const Lane*> ls;for(const auto& l:s.lanes)ls[l.id]=&l;
    std::map<JunctionId,std::vector<const Carriageway*>> incoming,outgoing;for(const auto& c:s.carriageways){incoming[c.to_junction_id].push_back(&c);outgoing[c.from_junction_id].push_back(&c);}
    std::vector<TurnMovement> out;
    for(const auto& [jid,j]:js){
        for(const auto* from:incoming[jid]) for(const auto* to:outgoing[jid]){
            auto type=classify_turn(*js.at(from->from_junction_id),*j,*js.at(to->to_junction_id));if(type==MovementType::u_turn)continue;
            std::vector<LaneId> fl,tl;VehiclePermissionMask fp=0,tp=0;
            for(const auto& id:from->lane_ids)if(auto* l=ls.at(id);travel_lane(*l)){fl.push_back(id);fp|=l->permissions;}
            for(const auto& id:to->lane_ids)if(auto* l=ls.at(id);travel_lane(*l)){tl.push_back(id);tp|=l->permissions;}
            if (fl.empty() || tl.empty()) continue;
            const auto perms = fp & tp;
            if (perms == 0) continue;
            out.push_back(TurnMovement{MovementId{"m:"+jid.value+":"+from->id.value+">"+to->id.value},jid,from->id,to->id,fl,tl,type,perms,true,movement_penalty(type)});
        }
    }
    sort_id(out);return out;
}

std::vector<LaneGroup> build_lane_groups(const NetworkSnapshot& s) {
