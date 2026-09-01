        if (!control.signal_plan) fail("signal control requires plan");
        checker.validate_signal_plan(network,*control.signal_plan);
        for (const auto& phase : control.signal_plan->phases) for (const auto& movement_id : phase) {
            const auto movement = std::find_if(network.movements.begin(),network.movements.end(),[&](const auto& value){ return value.id == movement_id; });
            if (movement == network.movements.end() || movement->junction_id != control.junction_id) fail("signal plan movement belongs to wrong junction");
        }
    } else if (control.signal_plan) fail("non-signal control must not contain signal plan");
    controls_[control.junction_id] = std::move(control);
    ++revision_;
}

double IntersectionControlStore::capacity_factor(const NetworkSnapshot& network, const JunctionId& junction, const MovementId& movement, std::uint64_t tick) const {
    const auto movement_it = std::find_if(network.movements.begin(),network.movements.end(),[&](const auto& value){ return value.id == movement; });
    if (movement_it == network.movements.end() || movement_it->junction_id != junction) fail("intersection control capacity requested for invalid movement");
    const auto it = controls_.find(junction);
    if (it == controls_.end()) return 1.0;
    IntersectionControl checker;
    return checker.capacity_factor(it->second.type,it->second.signal_plan ? &*it->second.signal_plan : nullptr,movement,tick);
}

IntersectionControlSnapshot IntersectionControlStore::snapshot() const {
    IntersectionControlSnapshot out;
    out.revision = revision_;
    for (const auto& [_,control] : controls_) out.controls.push_back(control);
    return out;
}

void IntersectionControlStore::restore(const NetworkSnapshot& network, const IntersectionControlSnapshot& snapshot) {
    std::map<JunctionId,JunctionControl> next;
    IntersectionControlStore validator;
    for (const auto& control : snapshot.controls) {
        if (next.contains(control.junction_id)) fail("duplicate intersection control junction");
        validator.upsert(network,control);
        next.emplace(control.junction_id,control);
    }
    controls_ = std::move(next);
    revision_ = snapshot.revision;
}


std::optional<RouteResult> RoutingEngine::find_route(const NetworkSnapshot& s,const JunctionId& start,const JunctionId& goal,VehiclePermissionMask required,const GeneralizedCostConfig& cfg){
