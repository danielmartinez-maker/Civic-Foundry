        if (vehicle.stop_index >= line.stop_ids.size()) fail("transit vehicle stop index out of range");
        if (vehicle.stop_serviced) {
            if (vehicle.dwell_remaining > 0) --vehicle.dwell_remaining;
            if (vehicle.dwell_remaining > 0) continue;
            vehicle.stop_index = (vehicle.stop_index + 1) % line.stop_ids.size();
            vehicle.stop_serviced = false;
            continue;
        }

        const auto stop_id = line.stop_ids[vehicle.stop_index];
        std::vector<PassengerCohort> continuing;
        for (auto cohort : record.onboard) {
            if (cohort.alighting_stop_id != stop_id) {
                continuing.push_back(std::move(cohort));
                continue;
            }
            const double weight = cohort.traveler_weight;
            if (!cohort.transfer_legs.empty()) {
                if (queues.enqueue_next_transfer(std::move(cohort),tick)) result.transferred_weight += weight;
                else result.cancelled_weight += weight;
            } else {
                result.completed_weight += weight;
            }
        }
        record.onboard = std::move(continuing);
        const double available = std::max(0.0,vehicle.capacity-sum_weight(record.onboard));
        auto boarded = queues.board(stop_id,vehicle.line_id,"out",available);
        result.boarded_weight += boarded.boarded_weight;
        record.onboard.insert(record.onboard.end(),boarded.boarded.begin(),boarded.boarded.end());
        vehicle.stop_serviced = true;
        vehicle.dwell_remaining = dwell_ticks;
    }
    return result;
}
std::vector<PassengerCohort> TransitOperations::fail_vehicle(const TransitRunId& id){auto it=vehicles_.find(id);if(it==vehicles_.end())return {};it->second.vehicle.state=TransitVehicleState::failed;auto stranded=std::move(it->second.onboard);it->second.onboard.clear();return stranded;}
double TransitOperations::total_onboard_weight()const{double t=0;for(const auto& [_,r]:vehicles_)t+=sum_weight(r.onboard);return t;}
double TransitOperations::in_service_capacity()const{double t=0;for(const auto& [_,r]:vehicles_)if(r.vehicle.state==TransitVehicleState::in_service)t+=r.vehicle.capacity;return t;}
double TransitOperations::crowding_ratio() const { const auto capacity=in_service_capacity(); return capacity<=eps?0.0:total_onboard_weight()/capacity; }
TransitOperationsSnapshot TransitOperations::snapshot()const{TransitOperationsSnapshot s;s.next_run_id=next_run_id_;for(const auto& [_,v]:vehicles_)s.vehicles.push_back(v);return s;}
