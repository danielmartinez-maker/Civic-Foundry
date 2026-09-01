    std::set<TransitStopId> stops; for (const auto& stop : s.transit.stops) stops.insert(stop.id);
    std::set<TransitLineId> lines; for (const auto& line : s.transit.lines) lines.insert(line.id);
    for (const auto& facility : s.parking.facilities) if (!junctions.contains(facility.access_junction_id)) fail("parking facility references missing access junction");
    for (const auto& incident : s.incidents.incidents) if (!carriageways.contains(incident.carriageway_id)) fail("incident references missing carriageway");
    for (const auto& load : s.traffic.loads) if (!carriageways.contains(load.carriageway_id)) fail("traffic load references missing carriageway");
    auto validate_passenger_refs = [&](const PassengerCohort& cohort) {
        if (!lines.contains(cohort.line_id) || !stops.contains(cohort.boarding_stop_id) || !stops.contains(cohort.alighting_stop_id)) fail("passenger cohort references missing transit asset");
        for (const auto& leg : cohort.transfer_legs) if (!lines.contains(leg.line_id) || !stops.contains(leg.boarding_stop_id) || !stops.contains(leg.alighting_stop_id)) fail("passenger transfer references missing transit asset");
    };
    for (const auto& queue : s.queues.queues) {
        if (!stops.contains(queue.stop_id) || !lines.contains(queue.line_id)) fail("passenger queue references missing transit asset");
        for (const auto& cohort : queue.cohorts) validate_passenger_refs(cohort);
    }
    for (const auto& record : s.operations.vehicles) {
        if (!lines.contains(record.vehicle.line_id)) fail("transit vehicle references missing line");
        const auto line = std::find_if(s.transit.lines.begin(),s.transit.lines.end(),[&](const auto& item){return item.id==record.vehicle.line_id;});
        if (line != s.transit.lines.end() && !line->stop_ids.empty() && record.vehicle.stop_index >= line->stop_ids.size()) fail("transit vehicle stop index invalid");
        for (const auto& cohort : record.onboard) validate_passenger_refs(cohort);
    }

    NetworkStore n; n.restore(s.network);
    IntersectionControlStore c; c.restore(s.network,s.controls);
    ParkingSystem p; p.restore(s.parking);
    IncidentSystem i; i.restore(s.incidents);
    TrafficFlowState f; f.restore(s.traffic);
    TransitNetwork t; t.restore(s.transit);
    PassengerQueues q; q.restore(s.queues);
    TransitOperations o; o.restore(s.operations);
