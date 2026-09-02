TrafficMetric TrafficFlowState::metric(const NetworkSnapshot& s,const CarriagewayId& id,double factor)const{if(!std::isfinite(factor)||factor<0||factor>1)fail("invalid incident capacity factor");const Carriageway* cw=nullptr;for(const auto& c:s.carriageways)if(c.id==id){cw=&c;break;}if(!cw)fail("unknown traffic carriageway");double cap=0,speed=std::numeric_limits<double>::infinity();for(const auto& lid:cw->lane_ids){auto it=std::find_if(s.lanes.begin(),s.lanes.end(),[&](const auto& l){return l.id==lid;});if(it!=s.lanes.end()&&travel_lane(*it)){cap+=it->base_capacity_per_minute;speed=std::min(speed,it->free_flow_speed_kph);}}cap*=factor;const auto weight=loads_.contains(id)?loads_.at(id):0;const auto raw_util=cap<=eps?(weight>eps?std::numeric_limits<double>::infinity():0):weight/cap;const auto util=std::isfinite(raw_util)?std::max(0.0,raw_util):1e6;const auto mult=1+3*std::pow(util,4);return {id,weight,cap,util,mult,std::isfinite(speed)?speed/mult:0};}
double TrafficFlowState::total_load()const{double t=0;for(auto [_,v]:loads_)t+=v;return t;}
TrafficFlowSnapshot TrafficFlowState::snapshot() const {
    TrafficFlowSnapshot s;
    for (const auto& [id,weight] : loads_) s.loads.push_back(TrafficLoadRecord{id,weight});
    return s;
}
void TrafficFlowState::restore(const TrafficFlowSnapshot& s) {
    std::map<CarriagewayId,double> next;
    for (const auto& row : s.loads) {
        require_id(row.carriageway_id,"traffic carriageway");
        nonnegative(row.weighted_vehicles,"traffic load");
        if (!next.emplace(row.carriageway_id,row.weighted_vehicles).second) fail("duplicate traffic carriageway load");
    }
    loads_ = std::move(next);
}

RoadTrafficSnapshot RoadTrafficState::snapshot() const {
    RoadTrafficSnapshot s;
    s.next_vehicle_id=next_vehicle_id_;
    s.completed_trips=completed_trips_;
    s.failed_trips=failed_trips_;
    s.congestion_epoch=congestion_epoch_;
    for(const auto& [_,vehicle]:vehicles_)s.vehicles.push_back(vehicle);
    return s;
}
TrafficFlowSnapshot RoadTrafficState::flow_snapshot() const {
    std::map<CarriagewayId,double> weights;
    for(const auto& [_,vehicle]:vehicles_){
        if(vehicle.carriageway_ids.empty()||vehicle.current_carriageway_index>=vehicle.carriageway_ids.size())fail("active road vehicle route index invalid");
        weights[vehicle.carriageway_ids[vehicle.current_carriageway_index]]+=vehicle.traveler_weight;
    }
    TrafficFlowSnapshot s;
    for(const auto& [id,weight]:weights)s.loads.push_back(TrafficLoadRecord{id,weight});
    return s;
}
void RoadTrafficState::restore(const NetworkSnapshot& network,const RoadTrafficSnapshot& s) {
    std::set<CarriagewayId> carriageways;for(const auto& carriageway:network.carriageways)carriageways.insert(carriageway.id);
    std::set<JunctionId> junctions;for(const auto& junction:network.junctions)junctions.insert(junction.id);
    std::map<std::string,ActiveRoadVehicle> next;
    for(auto vehicle:s.vehicles){
        if(vehicle.id.empty())fail("active road vehicle id must not be empty");
        require_id(vehicle.trip_id,"active road vehicle trip");
        nonnegative(vehicle.traveler_weight,"active road vehicle traveler weight");
        if(vehicle.origin_id.empty()||vehicle.destination_id.empty())fail("active road vehicle endpoints must not be empty");
        if(vehicle.carriageway_ids.empty()||vehicle.current_carriageway_index>=vehicle.carriageway_ids.size())fail("active road vehicle route index invalid");
        for(const auto& carriageway:vehicle.carriageway_ids)if(!carriageways.contains(carriageway))fail("active road vehicle references missing carriageway");
        nonnegative(vehicle.carriageway_progress_ticks,"active road vehicle progress");
        nonnegative(vehicle.accumulated_delay_ticks,"active road vehicle delay");
        nonnegative(vehicle.free_flow_ticks,"active road vehicle free-flow time");
        if(vehicle.queued_junction_id&&!junctions.contains(*vehicle.queued_junction_id))fail("active road vehicle references missing queued junction");
        switch(vehicle.cause){
            case TripCause::home_to_work: case TripCause::home_to_school: case TripCause::home_to_shopping:
            case TripCause::firm_to_supplier: case TripCause::warehouse_to_customer: case TripCause::incident_to_facility:
            case TripCause::construction_to_supplier: break;
            default: fail("active road vehicle trip cause invalid");
        }
        switch(vehicle.status){case RoadVehicleStatus::moving:case RoadVehicleStatus::queued:break;default:fail("active road vehicle status invalid");}
        if(!next.emplace(vehicle.id,std::move(vehicle)).second)fail("duplicate active road vehicle id");
    }
    vehicles_=std::move(next);
    next_vehicle_id_=std::max<std::uint64_t>(1,s.next_vehicle_id);
    completed_trips_=s.completed_trips;
    failed_trips_=s.failed_trips;
    congestion_epoch_=s.congestion_epoch;
}

TripGenerator::TripGenerator(std::uint64_t seed):state_(seed?seed:0x9e3779b97f4a7c15ull){}
std::uint64_t TripGenerator::next_random(){state_^=state_>>12;state_^=state_<<25;state_^=state_>>27;return state_*2685821657736338717ull;}
std::vector<Trip> TripGenerator::generate(TripCause cause,const std::vector<TripSource>& sources,const std::vector<std::string>& dest,std::uint64_t tick){std::vector<Trip> out;if(dest.empty())return out;auto sorted=sources;std::sort(sorted.begin(),sorted.end(),[](auto&a,auto&b){return a.id<b.id;});for(const auto& src:sorted){if(!std::isfinite(src.weight)||src.weight<0)fail("invalid trip source weight");if(src.weight<=eps)continue;const auto idx=static_cast<std::size_t>(next_random()%dest.size());out.push_back(Trip{TripId{"trip:"+std::to_string(next_trip_id_++)},cause,src.id,dest[idx],tick,src.weight});}return out;}
