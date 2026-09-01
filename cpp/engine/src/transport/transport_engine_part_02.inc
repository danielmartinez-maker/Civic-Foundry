void validate_cohort(const PassengerCohort& c) { require_id(c.id,"passenger cohort"); positive(c.traveler_weight,"passenger weight"); require_id(c.trip_id,"trip"); require_id(c.line_id,"line"); require_id(c.boarding_stop_id,"boarding stop"); require_id(c.alighting_stop_id,"alighting stop"); }

std::uint64_t fnv1a(std::string_view text) { std::uint64_t h=1469598103934665603ull; for (char raw : text) { const auto c = static_cast<unsigned char>(raw); h ^= c; h *= 1099511628211ull; } return h; }
std::string canonical_text(const TransportationSnapshot& s) {
    std::ostringstream o;
    o.setf(std::ios::fixed);
    o.precision(9);
    const auto str = [&](std::string_view value) { o << value.size() << '#' << value; };
    const auto id = [&](const auto& value) { str(value.value); };
    const auto cohort = [&](const PassengerCohort& c) {
        o << "PC"; id(c.id); id(c.trip_id); o << ':' << c.traveler_weight; id(c.line_id); str(c.direction_key);
        id(c.boarding_stop_id); id(c.alighting_stop_id); o << ':' << c.enqueued_tick << ':' << c.transfer_legs.size();
        for (const auto& leg : c.transfer_legs) { o << "X"; id(leg.line_id); str(leg.direction_key); id(leg.boarding_stop_id); id(leg.alighting_stop_id); }
    };

    o << "N:" << s.network.topology_revision << ':' << s.network.cost_revision;
    for (const auto& j : s.network.junctions) { o << "J"; id(j.id); o << ':' << j.x << ':' << j.y; str(j.source_legacy_cell); }
    for (const auto& seg : s.network.segments) {
        o << "S"; id(seg.id); o << ':' << static_cast<int>(seg.road_class); str(seg.geometry_ref); id(seg.start_junction_id); id(seg.end_junction_id);
        o << ':' << seg.length_meters << ':' << seg.speed_limit_kph << ':' << seg.condition; str(seg.access_policy_id); str(seg.toll_policy_id);
        o << ':' << seg.carriageway_ids.size(); for (const auto& value : seg.carriageway_ids) id(value);
        o << ':' << seg.source_legacy_cells.size(); for (const auto& value : seg.source_legacy_cells) str(value);
    }
    for (const auto& c : s.network.carriageways) {
        o << "C"; id(c.id); id(c.segment_id); o << ':' << static_cast<int>(c.direction); id(c.from_junction_id); id(c.to_junction_id);
        o << ':' << static_cast<int>(c.operating_class) << ':' << c.lane_ids.size(); for (const auto& value : c.lane_ids) id(value);
    }
    for (const auto& l : s.network.lanes) {
        o << "L"; id(l.id); id(l.carriageway_id); o << ':' << l.ordinal << ':' << static_cast<int>(l.type) << ':' << l.permissions << ':' << l.open
            << ':' << l.base_capacity_per_minute << ':' << l.free_flow_speed_kph;
    }
    for (const auto& m : s.network.movements) {
        o << "M"; id(m.id); id(m.junction_id); id(m.from_carriageway_id); id(m.to_carriageway_id);
        o << ':' << m.from_lane_ids.size(); for (const auto& value : m.from_lane_ids) id(value);
        o << ':' << m.to_lane_ids.size(); for (const auto& value : m.to_lane_ids) id(value);
        o << ':' << static_cast<int>(m.type) << ':' << m.permissions << ':' << m.allowed << ':' << m.base_penalty_ticks;
    }

    o << "IC:" << s.controls.revision;
    for (const auto& control : s.controls.controls) {
        o << "K"; id(control.junction_id); o << ':' << static_cast<int>(control.type) << ':' << control.signal_plan.has_value();
        if (control.signal_plan) {
            id(control.signal_plan->id); o << ':' << control.signal_plan->offset_ticks << ':' << control.signal_plan->phase_duration_ticks << ':' << control.signal_plan->phases.size();
            for (const auto& phase : control.signal_plan->phases) { o << ':' << phase.size(); for (const auto& movement : phase) id(movement); }
        }
    }

    o << "PK:" << s.parking.next_reservation_id;
    for (const auto& p : s.parking.facilities) { o << "P"; id(p.id); id(p.access_junction_id); o << ':' << p.capacity << ':' << p.occupied << ':' << p.price << ':' << p.access_penalty_ticks; }
    for (const auto& r : s.parking.reservations) { o << "R"; id(r.id); id(r.facility_id); o << ':' << r.weight; }

    o << "IN:" << s.incidents.cost_revision;
    for (const auto& i : s.incidents.incidents) { o << "I"; id(i.id); id(i.carriageway_id); o << ':' << i.capacity_factor << ':' << i.speed_factor << ':' << static_cast<int>(i.state) << ':' << i.start_tick << ':' << i.clear_tick; }
    for (const auto& load : s.traffic.loads) { o << "F"; id(load.carriageway_id); o << ':' << load.weighted_vehicles; }

    o << "TN:" << s.transit.revision;
    for (const auto& st : s.transit.stops) { o << "T"; id(st.id); o << ':' << st.x << ':' << st.y << ':' << static_cast<int>(st.mode); }
    for (const auto& line : s.transit.lines) {
        o << "Q"; id(line.id); o << ':' << static_cast<int>(line.mode) << ':' << line.fare << ':' << line.headway_ticks << ':' << line.enabled << ':' << line.stop_ids.size();
        for (const auto& value : line.stop_ids) id(value);
    }

    o << "PQ:" << s.queues.next_split_id;
    for (const auto& q : s.queues.queues) {
        o << "W"; id(q.stop_id); id(q.line_id); str(q.direction_key); o << ':' << q.cohorts.size();
        for (const auto& c : q.cohorts) cohort(c);
    }

    o << "OP:" << s.operations.next_run_id;
    for (const auto& v : s.operations.vehicles) {
        o << "V"; id(v.vehicle.run_id); id(v.vehicle.line_id);
        o << ':' << v.vehicle.capacity << ':' << static_cast<int>(v.vehicle.state) << ':' << v.vehicle.stop_index << ':' << v.vehicle.dwell_remaining
