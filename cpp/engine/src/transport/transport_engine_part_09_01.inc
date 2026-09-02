void PassengerQueues::restore(const PassengerQueueSnapshot& s){std::map<std::string,PassengerQueueEntry> next;std::set<PassengerCohortId> cohort_ids;std::uint64_t max_split=0;for(auto q:s.queues){auto key=queue_key(q.stop_id,q.line_id,q.direction_key);if(next.contains(key))fail("duplicate passenger queue key");for(const auto& c:q.cohorts){validate_cohort(c);if(c.line_id!=q.line_id||c.boarding_stop_id!=q.stop_id||c.direction_key!=q.direction_key)fail("passenger queue identity mismatch");if(!cohort_ids.insert(c.id).second)fail("duplicate passenger cohort id");constexpr std::string_view prefix="passenger-split:";if(c.id.value.starts_with(prefix)){try{max_split=std::max(max_split,static_cast<std::uint64_t>(std::stoull(c.id.value.substr(prefix.size()))));}catch(...){}}}std::sort(q.cohorts.begin(),q.cohorts.end(),[](const auto&a,const auto&b){return a.enqueued_tick==b.enqueued_tick?a.id<b.id:a.enqueued_tick<b.enqueued_tick;});next.emplace(key,std::move(q));}queues_=std::move(next);next_split_id_=std::max({std::uint64_t{1},s.next_split_id,max_split+1});}

void TransitOperations::add_vehicle(TransitVehicle v) {
    require_id(v.run_id,"transit run");
    require_id(v.line_id,"transit line");
    nonnegative(v.capacity,"transit capacity");
    if (!std::isfinite(v.reliability) || v.reliability < 0 || v.reliability > 1) fail("invalid transit vehicle reliability");
    if (vehicles_.contains(v.run_id)) fail("duplicate transit run");
    vehicles_[v.run_id] = {v,{}};
}
TransitRunId TransitOperations::dispatch(const TransitLineId& line_id, double capacity) {
    require_id(line_id,"transit line");
    nonnegative(capacity,"transit capacity");
    TransitRunId id{"transit-run:"+std::to_string(next_run_id_++)};
    add_vehicle(TransitVehicle{id,line_id,capacity,TransitVehicleState::in_service,0,0,false,1.0});
    return id;
}
void TransitOperations::set_onboard(const TransitRunId& id,std::vector<PassengerCohort> c){auto it=vehicles_.find(id);if(it==vehicles_.end())fail("unknown transit run");for(const auto& p:c)validate_cohort(p);if(sum_weight(c)>it->second.vehicle.capacity+eps)fail("transit vehicle over capacity");it->second.onboard=std::move(c);}
TransitStepResult TransitOperations::step(const TransitNetworkSnapshot& network, PassengerQueues& queues, std::uint64_t tick, std::uint64_t dwell_ticks) {
    validate_transit(network);
    std::map<TransitLineId,const TransitLine*> lines;
    for (const auto& line : network.lines) lines[line.id] = &line;
    TransitStepResult result;
    for (auto& [_,record] : vehicles_) {
        auto& vehicle = record.vehicle;
        if (vehicle.state != TransitVehicleState::in_service) continue;
        auto line_it = lines.find(vehicle.line_id);
        if (line_it == lines.end() || !line_it->second->enabled || line_it->second->stop_ids.size() < 2) {
            vehicle.state = TransitVehicleState::out_of_service;
            continue;
        }
        const auto& line = *line_it->second;
