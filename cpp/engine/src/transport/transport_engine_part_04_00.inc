    std::map<LaneId,const Lane*> lane;for(const auto& l:s.lanes)lane[l.id]=&l;
    std::vector<LaneGroup> groups;
    for(const auto& cw:s.carriageways){std::vector<LaneId> ids;VehiclePermissionMask perms=0;double cap=0,speed=std::numeric_limits<double>::infinity();
        for(const auto& id:cw.lane_ids){const auto* l=lane.at(id);if(!travel_lane(*l))continue;ids.push_back(id);perms|=l->permissions;cap+=l->base_capacity_per_minute;speed=std::min(speed,l->free_flow_speed_kph);}
        if (ids.empty()) continue;
        std::vector<MovementId> mids;
        for (const auto& m : s.movements) if (m.from_carriageway_id == cw.id && m.allowed) mids.push_back(m.id);
        sort_ids(mids);
        groups.push_back(LaneGroup{LaneGroupId{"lg:"+cw.id.value},cw.id,ids,mids,perms,cap,speed});}
    sort_id(groups);return groups;
}

MutationResult NetworkStore::replace(const NetworkSnapshot& input){validate_network(input);auto candidate=canonical(input);if(same_network_content(candidate,state_))return {false,{}};const auto next=state_.topology_revision+1;const auto cost=state_.cost_revision;state_=std::move(candidate);state_.topology_revision=next;state_.cost_revision=cost;return {true,{}};}
MutationResult NetworkStore::set_lane_open(const LaneId& id,bool open){auto next=state_;auto it=std::find_if(next.lanes.begin(),next.lanes.end(),[&](const auto& l){return l.id==id;});if(it==next.lanes.end())return {false,"unknown lane"};if(it->open==open)return {false,{}};it->open=open;next.topology_revision=state_.topology_revision+1;validate_network(next);state_=canonical(std::move(next));return {true,{}};}
MutationResult NetworkStore::set_lane_permissions(const LaneId& id,VehiclePermissionMask p){if((p&~all_vehicle_permissions)!=0)return {false,"invalid permissions"};auto next=state_;auto it=std::find_if(next.lanes.begin(),next.lanes.end(),[&](const auto& l){return l.id==id;});if(it==next.lanes.end())return {false,"unknown lane"};if(it->permissions==p)return {false,{}};it->permissions=p;next.topology_revision=state_.topology_revision+1;validate_network(next);state_=canonical(std::move(next));return {true,{}};}
MutationResult NetworkStore::set_movement_allowed(const MovementId& id,bool allowed){auto next=state_;auto it=std::find_if(next.movements.begin(),next.movements.end(),[&](const auto& m){return m.id==id;});if(it==next.movements.end())return {false,"unknown movement"};if(it->allowed==allowed)return {false,{}};it->allowed=allowed;next.topology_revision=state_.topology_revision+1;validate_network(next);state_=canonical(std::move(next));return {true,{}};}
std::uint64_t NetworkStore::advance_cost_revision(){return ++state_.cost_revision;}
NetworkSnapshot NetworkStore::snapshot()const{return state_;}
void NetworkStore::restore(const NetworkSnapshot& s){validate_network(s);state_=canonical(s);}

NetworkSnapshot LegacyRoadAdapter::project(const std::vector<LegacyRoadCell>& cells,std::uint64_t revision) const {
