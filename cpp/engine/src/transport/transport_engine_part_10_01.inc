void TransitOperations::restore(const TransitOperationsSnapshot& s){vehicles_.clear();for(auto r:s.vehicles){require_id(r.vehicle.run_id,"transit run");require_id(r.vehicle.line_id,"transit line");nonnegative(r.vehicle.capacity,"transit capacity");if(!std::isfinite(r.vehicle.reliability)||r.vehicle.reliability<0||r.vehicle.reliability>1)fail("invalid restored transit reliability");for(const auto& c:r.onboard)validate_cohort(c);if(sum_weight(r.onboard)>r.vehicle.capacity+eps)fail("restored transit vehicle over capacity");if(!vehicles_.emplace(r.vehicle.run_id,std::move(r)).second)fail("duplicate transit run restore");}next_run_id_=std::max<std::uint64_t>(1,s.next_run_id);}

double stranded_weight(const std::vector<PassengerCohort>& c){return sum_weight(c);}

std::optional<JourneyPlan> MultimodalJourneyPlanner::plan(const NetworkSnapshot& roads,const TransitNetworkSnapshot& transit,const JunctionId& start,const JunctionId& goal,const GeneralizedCostConfig& cfg) {
    RoutingEngine routing;
    auto car = routing.find_route(roads,start,goal,permission(VehiclePermission::private_car),cfg);
    std::optional<JourneyPlan> best;
    if (car) best = JourneyPlan{{JourneyLeg{TravelMode::car,start,goal,TransitLineId{},car->total_cost}},car->total_cost};
    if (start == goal) return JourneyPlan{{},0};

    std::map<TransitStopId,const TransitStop*> stops;
    for (const auto& stop : transit.stops) stops[stop.id] = &stop;
    const Junction* start_junction = nullptr;
    const Junction* goal_junction = nullptr;
    for (const auto& junction : roads.junctions) {
        if (junction.id == start) start_junction = &junction;
        if (junction.id == goal) goal_junction = &junction;
    }
    if (!start_junction || !goal_junction) return best;

    auto stop_matches = [&](const TransitStop& stop, const Junction& junction) {
        return std::abs(stop.x-junction.x) <= eps && std::abs(stop.y-junction.y) <= eps;
    };
    struct Reach { const TransitLine* line{}; int start_index{-1}; int goal_index{-1}; };
    std::vector<Reach> lines;
    for (const auto& line : transit.lines) {
        if (!line.enabled) continue;
        Reach reach{&line,-1,-1};
        for (std::size_t i=0;i<line.stop_ids.size();++i) {
            const auto* stop = stops.at(line.stop_ids[i]);
            if (stop_matches(*stop,*start_junction)) reach.start_index = static_cast<int>(i);
            if (stop_matches(*stop,*goal_junction)) reach.goal_index = static_cast<int>(i);
        }
        lines.push_back(reach);
        if (reach.start_index >= 0 && reach.goal_index > reach.start_index) {
            const double cost = line.fare + static_cast<double>(reach.goal_index-reach.start_index)*5.0;
            JourneyPlan candidate{{JourneyLeg{TravelMode::transit,start,goal,line.id,cost}},cost};
            if (!best || candidate.total_generalized_cost < best->total_generalized_cost-eps) best = candidate;
        }
    }
