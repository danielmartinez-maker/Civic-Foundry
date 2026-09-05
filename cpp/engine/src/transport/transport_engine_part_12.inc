    network_=std::move(n); controls_=std::move(c); parking_=std::move(p); incidents_=std::move(i); traffic_=std::move(f); transit_=std::move(t); queues_=std::move(q); operations_=std::move(o);
}
std::uint64_t TransportationAuthority::domain_hash()const{return fnv1a(canonical_text(snapshot()));}

} // namespace civic::transport
