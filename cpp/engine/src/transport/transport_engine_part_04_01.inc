    std::map<std::pair<int,int>,LegacyRoadCell> bypos;for(const auto& c:cells){if(road_rank(c.road_class)>2)fail("legacy adapter only accepts local/collector/arterial");if(!bypos.emplace(std::pair{c.x,c.y},c).second)fail("duplicate legacy road cell");}
    NetworkSnapshot s; s.topology_revision=revision;
    for(const auto& [pos,c]:bypos)s.junctions.push_back(Junction{legacy_junction(c.x,c.y),static_cast<double>(c.x),static_cast<double>(c.y),cell_key(c.x,c.y)});
    const std::pair<int,int> offsets[]{{1,0},{0,1}};
    for(const auto& [pos,a]:bypos)for(const auto& [dx,dy]:offsets){auto it=bypos.find({a.x+dx,a.y+dy});if(it==bypos.end())continue;const auto& b=it->second;auto ak=cell_key(a.x,a.y),bk=cell_key(b.x,b.y);auto ja=legacy_junction(a.x,a.y),jb=legacy_junction(b.x,b.y);auto sid=legacy_segment(ak,bk);
        RoadSegment seg{sid,road_rank(a.road_class)>=road_rank(b.road_class)?a.road_class:b.road_class,"legacy:"+ak+">"+bk,ja,jb,legacy_cell_meters,std::max(legacy_speed_kph(a.road_class),legacy_speed_kph(b.road_class)),1,"legacy:all",{}, {}, {ak,bk}};
        auto add_cw=[&](const LegacyRoadCell& source,JunctionId from,JunctionId to,Direction dir){auto cid=legacy_carriageway(sid,from,to);std::vector<LaneId> lids;const int count=legacy_lane_count(source.road_class);for(int n=0;n<count;++n){auto lid=legacy_lane(cid,n);lids.push_back(lid);s.lanes.push_back(Lane{lid,cid,static_cast<std::uint32_t>(n),LaneType::through,all_vehicle_permissions,true,legacy_capacity(source.road_class)/count,legacy_speed_kph(source.road_class)});}s.carriageways.push_back(Carriageway{cid,sid,dir,from,to,source.road_class,lids});seg.carriageway_ids.push_back(cid);};
        if(!a.one_way||a.one_way_direction==Direction::forward)add_cw(a,ja,jb,Direction::forward);
        if(!b.one_way||b.one_way_direction==Direction::backward)add_cw(b,jb,ja,Direction::backward);
        if(!seg.carriageway_ids.empty())s.segments.push_back(std::move(seg));
    }
    s=canonical(std::move(s));s.movements=build_turn_movements(s);s=canonical(std::move(s));validate_network(s);return s;
}
