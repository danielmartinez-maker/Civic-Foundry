    // One-transfer journeys. Shared stop identity is the transfer contract, and ordering on both lines must be forward.
    for (const auto& first : lines) {
        if (first.start_index < 0) continue;
        for (const auto& second : lines) {
            if (second.goal_index < 0 || first.line->id == second.line->id) continue;
            for (std::size_t first_transfer=static_cast<std::size_t>(first.start_index+1); first_transfer<first.line->stop_ids.size(); ++first_transfer) {
                const auto transfer_stop = first.line->stop_ids[first_transfer];
                auto second_it = std::find(second.line->stop_ids.begin(),second.line->stop_ids.end(),transfer_stop);
                if (second_it == second.line->stop_ids.end()) continue;
                const auto second_transfer = static_cast<int>(std::distance(second.line->stop_ids.begin(),second_it));
                if (second.goal_index <= second_transfer) continue;
                const auto* transfer = stops.at(transfer_stop);
                JunctionId transfer_junction{"transit-transfer:"+transfer_stop.value};
                // If the shared stop sits on a road junction, use the canonical road junction ID in the leg boundary.
                for (const auto& junction : roads.junctions) if (stop_matches(*transfer,junction)) { transfer_junction = junction.id; break; }
                const double first_cost = first.line->fare + static_cast<double>(static_cast<int>(first_transfer)-first.start_index)*5.0;
                const double second_cost = second.line->fare + static_cast<double>(second.goal_index-second_transfer)*5.0;
                const double transfer_penalty = 10.0;
                const double total = first_cost + second_cost + transfer_penalty;
                JourneyPlan candidate{{
                    JourneyLeg{TravelMode::transit,start,transfer_junction,first.line->id,first_cost},
                    JourneyLeg{TravelMode::transit,transfer_junction,goal,second.line->id,second_cost+transfer_penalty}
                },total};
                if (!best || total < best->total_generalized_cost-eps) best = candidate;
            }
        }
    }
    return best;
}

void TransportationAuthority::load_network(const NetworkSnapshot& s){network_.restore(s);}
TransportationSnapshot TransportationAuthority::snapshot()const{return {network_.snapshot(),controls_.snapshot(),parking_.snapshot(),incidents_.snapshot(),traffic_.snapshot(),road_traffic_.snapshot(),transit_.snapshot(),queues_.snapshot(),operations_.snapshot()};}
void TransportationAuthority::restore(const TransportationSnapshot& s) {
    validate_network(s.network);
    validate_transit(s.transit);
    IntersectionControlStore control_check; control_check.restore(s.network,s.controls);
    std::set<JunctionId> junctions; for (const auto& j : s.network.junctions) junctions.insert(j.id);
    std::set<CarriagewayId> carriageways; for (const auto& c : s.network.carriageways) carriageways.insert(c.id);
