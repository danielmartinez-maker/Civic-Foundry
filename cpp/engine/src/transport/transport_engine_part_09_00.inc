bool PassengerQueues::enqueue(PassengerCohort c){try{validate_cohort(c);}catch(...){return false;}auto key=queue_key(c.boarding_stop_id,c.line_id,c.direction_key);auto [it,inserted]=queues_.try_emplace(key,PassengerQueueEntry{c.boarding_stop_id,c.line_id,c.direction_key,{}});it->second.cohorts.push_back(std::move(c));std::sort(it->second.cohorts.begin(),it->second.cohorts.end(),[](const auto&a,const auto&b){return a.enqueued_tick==b.enqueued_tick?a.id<b.id:a.enqueued_tick<b.enqueued_tick;});return true;}
BoardingResult PassengerQueues::board(const TransitStopId& stop,const TransitLineId& line,std::string_view dir,double capacity){double remain=std::max(0.0,std::isfinite(capacity)?capacity:0.0);BoardingResult r;auto key=queue_key(stop,line,dir);auto it=queues_.find(key);if(it!=queues_.end()){auto& cohorts=it->second.cohorts;while(!cohorts.empty()&&remain>eps){auto& first=cohorts.front();if(first.traveler_weight<=remain+eps){r.boarded.push_back(first);remain-=first.traveler_weight;cohorts.erase(cohorts.begin());}else{auto piece=first;piece.id=PassengerCohortId{"passenger-split:"+std::to_string(next_split_id_++)};piece.traveler_weight=remain;r.boarded.push_back(piece);first.traveler_weight-=remain;remain=0;}}if(cohorts.empty())queues_.erase(it);}r.boarded_weight=sum_weight(r.boarded);auto qit=queues_.find(key);r.left_behind_weight=qit==queues_.end()?0:sum_weight(qit->second.cohorts);return r;}
bool PassengerQueues::enqueue_next_transfer(PassengerCohort cohort, std::uint64_t tick) {
    if (cohort.transfer_legs.empty()) return false;
    const auto next = cohort.transfer_legs.front();
    cohort.transfer_legs.erase(cohort.transfer_legs.begin());
    cohort.line_id = next.line_id;
    cohort.direction_key = next.direction_key;
    cohort.boarding_stop_id = next.boarding_stop_id;
    cohort.alighting_stop_id = next.alighting_stop_id;
    cohort.enqueued_tick = tick;
    return enqueue(std::move(cohort));
}
double PassengerQueues::waiting_weight(const TransitStopId& stop,const TransitLineId& line,std::string_view dir) const {
    const auto it = queues_.find(queue_key(stop,line,dir));
    return it == queues_.end() ? 0.0 : sum_weight(it->second.cohorts);
}
double PassengerQueues::total_waiting_weight()const{double t=0;for(const auto& [_,q]:queues_)t+=sum_weight(q.cohorts);return t;}
PassengerQueueSnapshot PassengerQueues::snapshot()const{PassengerQueueSnapshot s;s.next_split_id=next_split_id_;for(const auto& [_,q]:queues_)s.queues.push_back(q);return s;}
