#include "civic/cadastre/ParcelGeneration.hpp"
#include "civic/geometry/BooleanOps.hpp"
#include <algorithm>
#include <array>
#include <map>
#include <queue>
#include <set>

namespace civic::cadastre {
namespace {
constexpr civic::geometry::Coordinate kCellCm = 3000;
struct Cell { std::int32_t x{}; std::int32_t y{}; std::string zone{}; };
using Key = std::pair<std::int32_t,std::int32_t>;
constexpr std::array<Key,4> kDirections{{{0,-1},{1,0},{0,1},{-1,0}}};
constexpr std::array<std::string_view,4> kSides{{"north","east","south","west"}};

bool less_cell(const Cell& a,const Cell& b){return a.y<b.y||(a.y==b.y&&(a.x<b.x||(a.x==b.x&&a.zone<b.zone)));}
Key key(std::int32_t x,std::int32_t y){return {x,y};}
std::string key_string(Key k){return std::to_string(k.first)+","+std::to_string(k.second);}

civic::geometry::Polygon cell_polygon(const Cell& c){
  const auto x=static_cast<civic::geometry::Coordinate>(c.x)*kCellCm;
  const auto y=static_cast<civic::geometry::Coordinate>(c.y)*kCellCm;
  return civic::geometry::rectangle(x,y,x+kCellCm,y+kCellCm);
}

civic::core::Result<civic::geometry::Polygon> union_cells(std::span<const Cell> cells) noexcept {
  if(cells.empty()) return std::unexpected(civic::core::error(civic::core::ErrorCode::invalid_argument,"cannot union empty legacy cell set"));
  try {
    std::vector<civic::geometry::Polygon> polygons; polygons.reserve(cells.size());
    for(const auto& c:cells) polygons.push_back(cell_polygon(c));
    auto united=civic::geometry::polygon_union(polygons); if(!united) return std::unexpected(united.error());
    if(united->size()!=1U) return std::unexpected(civic::core::error(civic::core::ErrorCode::invariant_failure,"connected cells did not produce one polygon"));
    return united->front();
  } catch(const std::exception& e){return std::unexpected(civic::core::error(civic::core::ErrorCode::internal_error,e.what()));}
}

civic::core::Result<civic::geometry::Polygon> subdivide_grid_edges(const civic::geometry::Polygon& input) noexcept {
  auto canonical=civic::geometry::canonicalize(input); if(!canonical)return std::unexpected(canonical.error());
  civic::geometry::Polygon out;
  for(std::size_t i=0;i<canonical->vertices.size();++i){
    const auto start=canonical->vertices[i],end=canonical->vertices[(i+1U)%canonical->vertices.size()]; out.vertices.push_back(start);
    const auto dx=end.x-start.x,dy=end.y-start.y;
    if(dx!=0&&dy!=0)return std::unexpected(civic::core::error(civic::core::ErrorCode::invariant_failure,"legacy parcel boundary is not axis aligned"));
    const auto length=std::max(std::llabs(dx),std::llabs(dy));
    if(length%kCellCm!=0)return std::unexpected(civic::core::error(civic::core::ErrorCode::invariant_failure,"legacy parcel boundary left cell grid"));
    const auto steps=length/kCellCm;
    for(civic::geometry::Coordinate step=1;step<steps;++step){out.vertices.push_back({start.x+(dx/steps)*step,start.y+(dy/steps)*step});}
  }
  return civic::geometry::canonicalize(out);
}

std::set<std::string> frontage_sides(const Cell& c,const std::map<Key,LegacyRoadCell>& roads){
  std::set<std::string> result;
  for(std::size_t i=0;i<kDirections.size();++i){if(roads.contains(key(c.x+kDirections[i].first,c.y+kDirections[i].second)))result.emplace(kSides[i]);}
  return result;
}
bool compatible_frontage(const std::set<std::string>& a,const std::set<std::string>& b){if(a.empty()&&b.empty())return true;for(const auto& v:a)if(b.contains(v))return true;return false;}

std::vector<std::vector<Cell>> connected_components(const std::vector<Cell>& cells){
  std::map<Key,Cell> by_key; for(const auto& c:cells)by_key.emplace(key(c.x,c.y),c);
  std::set<Key> unseen; for(const auto& [k,_]:by_key)unseen.insert(k);
  std::vector<std::vector<Cell>> components;
  for(const auto& start:cells){const auto sk=key(start.x,start.y);if(!unseen.erase(sk))continue;std::queue<Cell> q;q.push(start);std::vector<Cell> component;
    while(!q.empty()){const auto current=q.front();q.pop();component.push_back(current);for(const auto& [dx,dy]:kDirections){const auto nk=key(current.x+dx,current.y+dy);const auto found=by_key.find(nk);if(found!=by_key.end()&&unseen.erase(nk))q.push(found->second);}}
    std::sort(component.begin(),component.end(),less_cell);components.push_back(std::move(component));}
  std::sort(components.begin(),components.end(),[](const auto&a,const auto&b){return less_cell(a.front(),b.front());});return components;
}

std::vector<std::vector<Cell>> group_parcel_cells(const std::vector<Cell>& component,const std::map<Key,LegacyRoadCell>& roads){
  std::map<Key,Cell> by_key;for(const auto& c:component)by_key.emplace(key(c.x,c.y),c);std::set<Key> assigned;std::vector<std::vector<Cell>> groups;
  for(const auto& start:component){const auto sk=key(start.x,start.y);if(assigned.contains(sk))continue;assigned.insert(sk);std::queue<Cell> q;q.push(start);std::vector<Cell> group;
    while(!q.empty()){const auto current=q.front();q.pop();group.push_back(current);const auto frontage=frontage_sides(current,roads);for(const auto& [dx,dy]:kDirections){const auto nk=key(current.x+dx,current.y+dy);const auto found=by_key.find(nk);if(found==by_key.end()||assigned.contains(nk)||found->second.zone!=current.zone)continue;if(!compatible_frontage(frontage,frontage_sides(found->second,roads)))continue;assigned.insert(nk);q.push(found->second);}}
    std::sort(group.begin(),group.end(),less_cell);groups.push_back(std::move(group));}
  std::sort(groups.begin(),groups.end(),[](const auto&a,const auto&b){return less_cell(a.front(),b.front());});return groups;
}

std::string boundary_id(civic::geometry::Point a,civic::geometry::Point b){if(b<a)std::swap(a,b);return "boundary:"+std::to_string(a.x)+","+std::to_string(a.y)+"|"+std::to_string(b.x)+","+std::to_string(b.y);}
std::optional<std::string> road_ref_for_segment(civic::geometry::Point start,civic::geometry::Point end,const std::map<Key,LegacyRoadCell>& roads){
  std::vector<Key> candidates;const auto mx=(start.x+end.x)/2,my=(start.y+end.y)/2;
  if(start.y==end.y){const auto x=static_cast<std::int32_t>(mx/kCellCm),gy=static_cast<std::int32_t>(start.y/kCellCm);candidates={{x,gy-1},{x,gy}};}
  else if(start.x==end.x){const auto y=static_cast<std::int32_t>(my/kCellCm),gx=static_cast<std::int32_t>(start.x/kCellCm);candidates={{gx-1,y},{gx,y}};}
  std::vector<std::string> refs;for(const auto& k:candidates)if(const auto it=roads.find(k);it!=roads.end())refs.push_back(it->second.road_ref.empty()?key_string(k):it->second.road_ref);
  if(refs.empty()) return std::nullopt;
  std::sort(refs.begin(),refs.end());
  return refs.front();
}
} // namespace

civic::core::Result<ParcelGenerationSnapshot> ParcelGenerationSystem::rebuild(std::span<const LegacyTerrainCell> terrain,std::span<const LegacyRoadCell> roads_input,std::span<const LegacyZoningCell> zoning) const noexcept {
  try {
    std::map<Key,bool> buildable;for(const auto& c:terrain)buildable[key(c.x,c.y)]=c.buildable;
    std::map<Key,LegacyRoadCell> roads;for(const auto& road:roads_input){const auto k=key(road.x,road.y);if(!roads.emplace(k,road).second)return std::unexpected(civic::core::error(civic::core::ErrorCode::conflict,"duplicate legacy road cell"));}
    std::vector<Cell> cells;cells.reserve(zoning.size());for(const auto& z:zoning){if(z.zoning_district_id.empty())return std::unexpected(civic::core::error(civic::core::ErrorCode::invalid_argument,"zoning district id required"));const auto k=key(z.x,z.y);if(const auto land=buildable.find(k);land!=buildable.end()&&land->second&&!roads.contains(k))cells.push_back({z.x,z.y,z.zoning_district_id});}
    std::sort(cells.begin(),cells.end(),less_cell);for(std::size_t i=1;i<cells.size();++i)if(key(cells[i-1].x,cells[i-1].y)==key(cells[i].x,cells[i].y))return std::unexpected(civic::core::error(civic::core::ErrorCode::conflict,"duplicate legacy zoning cell"));
    ParcelGenerationSnapshot snapshot;if(cells.empty())return snapshot;
    struct Draft{Parcel parcel;civic::geometry::Polygon ring;};std::vector<Draft> drafts;
    for(const auto& component:connected_components(cells)){
      const auto anchor=component.front();GeneratedUrbanBlock block;block.external_id="block:"+key_string(key(anchor.x,anchor.y));auto block_boundary=union_cells(component);if(!block_boundary)return std::unexpected(block_boundary.error());block.boundary=*block_boundary;
      for(const auto& group:group_parcel_cells(component,roads)){const auto pa=group.front();auto united=union_cells(group);if(!united)return std::unexpected(united.error());auto ring=subdivide_grid_edges(*united);if(!ring)return std::unexpected(ring.error());Parcel parcel;parcel.external_id="parcel:"+key_string(key(pa.x,pa.y));parcel.id=parcel_id_from_external(parcel.external_id);parcel.block_id=block.external_id;parcel.zoning_district_id=pa.zone;parcel.boundary=*ring;block.parcel_ids.push_back(parcel.id);drafts.push_back({std::move(parcel),*ring});}
      std::sort(block.parcel_ids.begin(),block.parcel_ids.end());snapshot.blocks.push_back(std::move(block));
    }
    std::sort(drafts.begin(),drafts.end(),[](const Draft&a,const Draft&b){return a.parcel.external_id<b.parcel.external_id;});for(auto& draft:drafts){if(auto inserted=snapshot.graph.insert(std::move(draft.parcel));!inserted)return std::unexpected(inserted.error());}
    for(const auto* parcel:snapshot.graph.live_parcels())for(std::size_t i=0;i<parcel->boundary.vertices.size();++i){const auto a=parcel->boundary.vertices[i],b=parcel->boundary.vertices[(i+1U)%parcel->boundary.vertices.size()];const auto ref=road_ref_for_segment(a,b,roads);if(!ref)continue;const auto id=boundary_id(a,b);const auto* boundary=snapshot.graph.find_boundary(id);if(!boundary||boundary->right_parcel_id)continue;if(auto set=snapshot.graph.set_boundary_semantics(id,"street-frontage",ref,true,true);!set)return std::unexpected(set.error());}
    for(auto& block:snapshot.blocks){for(const auto parcel_id:block.parcel_ids){const auto* parcel=snapshot.graph.find(parcel_id);if(!parcel)continue;block.road_boundary_ids.insert(block.road_boundary_ids.end(),parcel->frontage_boundary_ids.begin(),parcel->frontage_boundary_ids.end());}std::sort(block.road_boundary_ids.begin(),block.road_boundary_ids.end());block.road_boundary_ids.erase(std::unique(block.road_boundary_ids.begin(),block.road_boundary_ids.end()),block.road_boundary_ids.end());}
    if(auto valid=snapshot.graph.validate();!valid) return std::unexpected(valid.error());
    return snapshot;
  } catch(const std::exception& e){return std::unexpected(civic::core::error(civic::core::ErrorCode::internal_error,e.what()));}
}

} // namespace civic::cadastre
