bool IntersectionControl::conflict(const NetworkSnapshot& s,const MovementId& a,const MovementId& b) const {if(a==b)return false;const TurnMovement *ma=nullptr,*mb=nullptr;for(const auto& m:s.movements){if(m.id==a)ma=&m;if(m.id==b)mb=&m;}if(!ma||!mb)fail("unknown movement");if(ma->junction_id!=mb->junction_id)return false;if(ma->from_carriageway_id==mb->from_carriageway_id||ma->to_carriageway_id==mb->to_carriageway_id)return true;if(ma->type==MovementType::right&&mb->type==MovementType::right)return false;return true;}
void IntersectionControl::validate_signal_plan(const NetworkSnapshot& s,const SignalPlan& p) const {
    require_id(p.id,"signal plan");
    if (p.phases.empty()) fail("signal plan requires at least one phase");
    if (p.phase_duration_ticks == 0) fail("signal phase duration must be positive");
    std::set<MovementId> known;
    for (const auto& m : s.movements) known.insert(m.id);
    for (const auto& phase : p.phases) {
        if (phase.empty()) fail("signal phase must not be empty");
        unique_refs(phase,"signal phase");
        for (const auto& id : phase) if (!known.contains(id)) fail("signal phase references unknown movement");
        for (std::size_t i=0;i<phase.size();++i) for (std::size_t j=i+1;j<phase.size();++j) if (conflict(s,phase[i],phase[j])) fail("signal phase contains conflicting movements");
    }
}
std::size_t IntersectionControl::active_phase(const SignalPlan& p, std::uint64_t tick) const {
    if (p.phases.empty() || p.phase_duration_ticks == 0) fail("invalid signal plan");
    const auto adjusted = tick >= p.offset_ticks ? tick - p.offset_ticks : 0;
    return static_cast<std::size_t>((adjusted / p.phase_duration_ticks) % p.phases.size());
}
bool IntersectionControl::movement_green(const SignalPlan& p, const MovementId& movement, std::uint64_t tick) const {
    const auto& phase = p.phases.at(active_phase(p,tick));
    return std::find(phase.begin(),phase.end(),movement) != phase.end();
}
double IntersectionControl::capacity_factor(ControlType type, const SignalPlan* plan, const MovementId& movement, std::uint64_t tick) const {
    switch (type) {
        case ControlType::uncontrolled: return 1.0;
        case ControlType::stop: return 0.65;
        case ControlType::yield: return 0.80;
        case ControlType::signal:
            if (!plan) fail("signal control requires a signal plan");
            return movement_green(*plan,movement,tick) ? 1.0 : 0.0;
    }
    return 0.0;
}

void IntersectionControlStore::upsert(const NetworkSnapshot& network, JunctionControl control) {
    require_id(control.junction_id,"control junction");
    const auto junction = std::find_if(network.junctions.begin(),network.junctions.end(),[&](const auto& value){ return value.id == control.junction_id; });
    if (junction == network.junctions.end()) fail("intersection control references missing junction");
    IntersectionControl checker;
    if (control.type == ControlType::signal) {
