void IncidentSystem::clear(const IncidentId& id){auto it=incidents_.find(id);if(it!=incidents_.end()&&it->second.state!=IncidentState::cleared){it->second.state=IncidentState::cleared;++cost_revision_;}}
void IncidentSystem::step(std::uint64_t tick){for(auto& [_,i]:incidents_)if(i.state==IncidentState::active&&i.clear_tick>0&&tick>=i.clear_tick){i.state=IncidentState::cleared;++cost_revision_;}}
double IncidentSystem::capacity_factor(const CarriagewayId& id)const{double f=1;for(const auto& [_,i]:incidents_)if(i.carriageway_id==id&&i.state==IncidentState::active)f*=i.capacity_factor;return std::clamp(f,0.0,1.0);}
double IncidentSystem::speed_factor(const CarriagewayId& id)const{double f=1;for(const auto& [_,i]:incidents_)if(i.carriageway_id==id&&i.state==IncidentState::active)f*=i.speed_factor;return std::clamp(f,0.0,1.0);}
double IncidentSystem::route_penalty(const CarriagewayId& id)const{auto c=capacity_factor(id),s=speed_factor(id);if(c<=eps||s<=eps)return 1e9;return (1.0/c-1.0)*20.0+(1.0/s-1.0)*10.0;}
IncidentSnapshot IncidentSystem::snapshot()const{IncidentSnapshot s;s.cost_revision=cost_revision_;for(auto [_,v]:incidents_)s.incidents.push_back(v);return s;}
void IncidentSystem::restore(const IncidentSnapshot& s){incidents_.clear();for(auto i:s.incidents){if(incidents_.contains(i.id))fail("duplicate incident");require_id(i.id,"incident");if(!std::isfinite(i.capacity_factor)||!std::isfinite(i.speed_factor))fail("non-finite incident");incidents_.emplace(i.id,std::move(i));}cost_revision_=s.cost_revision;}

void TrafficFlowState::set_load(const CarriagewayId& id,double w){require_id(id,"traffic carriageway");nonnegative(w,"traffic load");loads_[id]=w;}
void TrafficFlowState::add_load(const CarriagewayId& id,double w){nonnegative(w,"traffic load");set_load(id,(loads_.contains(id)?loads_.at(id):0)+w);}
