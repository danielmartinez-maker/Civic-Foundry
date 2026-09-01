#include "civic/geometry/Geometry.hpp"
#include <cstdlib>

namespace civic::geometry {
namespace {
std::int64_t cross(Point a, Point b, Point c) noexcept { return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x); }
bool between(Coordinate value, Coordinate a, Coordinate b) noexcept { return value >= std::min(a,b) && value <= std::max(a,b); }
}
std::int64_t signed_double_area(const Polygon& polygon) noexcept {
  if (polygon.vertices.size()<3) return 0;
  std::int64_t total=0;
  for(std::size_t i=0;i<polygon.vertices.size();++i){const auto a=polygon.vertices[i];const auto b=polygon.vertices[(i+1)%polygon.vertices.size()];total+=a.x*b.y-b.x*a.y;}
  return static_cast<std::int64_t>(total);
}
double area_square_meters(const Polygon& polygon) noexcept { return std::abs(static_cast<double>(signed_double_area(polygon)))/20000.0; }
civic::core::Result<Point> centroid(const Polygon& polygon) noexcept {
  if(polygon.vertices.size()<3)return std::unexpected(civic::core::error(civic::core::ErrorCode::invalid_argument,"polygon requires at least three vertices"));
  long double twice=0,cx=0,cy=0;
  for(std::size_t i=0;i<polygon.vertices.size();++i){const auto a=polygon.vertices[i];const auto b=polygon.vertices[(i+1)%polygon.vertices.size()];const long double c=static_cast<long double>(a.x)*b.y-static_cast<long double>(b.x)*a.y;twice+=c;cx+=(a.x+b.x)*c;cy+=(a.y+b.y)*c;}
  if(std::abs(twice)<0.5L)return std::unexpected(civic::core::error(civic::core::ErrorCode::invalid_argument,"zero-area polygon"));
  return Point{static_cast<Coordinate>(std::llround(cx/(3.0L*twice))),static_cast<Coordinate>(std::llround(cy/(3.0L*twice)))};
}
civic::core::Result<Bounds> bounds(const Polygon& polygon) noexcept {
  if(polygon.vertices.empty())return std::unexpected(civic::core::error(civic::core::ErrorCode::invalid_argument,"empty polygon"));
  Bounds b{polygon.vertices[0].x,polygon.vertices[0].y,polygon.vertices[0].x,polygon.vertices[0].y};
  for(auto p:polygon.vertices){b.min_x=std::min(b.min_x,p.x);b.min_y=std::min(b.min_y,p.y);b.max_x=std::max(b.max_x,p.x);b.max_y=std::max(b.max_y,p.y);} return b;
}
bool point_on_segment(Point p, Segment s) noexcept { return cross(s.a,s.b,p)==0 && between(p.x,s.a.x,s.b.x)&&between(p.y,s.a.y,s.b.y); }
bool point_in_polygon(Point p,const Polygon& polygon) noexcept {
  if(polygon.vertices.size()<3)return false;
  bool inside=false;
  for(std::size_t i=0,j=polygon.vertices.size()-1;i<polygon.vertices.size();j=i++){
    const auto a=polygon.vertices[j],b=polygon.vertices[i]; if(point_on_segment(p,{a,b}))return true;
    const bool straddle=(b.y>p.y)!=(a.y>p.y); if(!straddle)continue;
    const long double x=static_cast<long double>(a.x-b.x)*(p.y-b.y)/static_cast<long double>(a.y-b.y)+b.x; if(static_cast<long double>(p.x)<x)inside=!inside;
  } return inside;
}
bool segments_intersect(Segment lhs,Segment rhs) noexcept {
  const auto c1=cross(lhs.a,lhs.b,rhs.a),c2=cross(lhs.a,lhs.b,rhs.b),c3=cross(rhs.a,rhs.b,lhs.a),c4=cross(rhs.a,rhs.b,lhs.b);
  if(c1==0&&point_on_segment(rhs.a,lhs))return true;
  if(c2==0&&point_on_segment(rhs.b,lhs))return true;
  if(c3==0&&point_on_segment(lhs.a,rhs))return true;
  if(c4==0&&point_on_segment(lhs.b,rhs))return true;
  return ((c1>0)!=(c2>0))&&((c3>0)!=(c4>0));
}
civic::core::Result<Polygon> canonicalize(const Polygon& polygon) noexcept {
  std::vector<Point> v; v.reserve(polygon.vertices.size());
  for(auto p:polygon.vertices){if(v.empty()||v.back()!=p)v.push_back(p);} if(v.size()>1&&v.front()==v.back())v.pop_back();
  if(v.size()<3)return std::unexpected(civic::core::error(civic::core::ErrorCode::invalid_argument,"polygon collapses below three vertices"));
  Polygon result{v}; const auto area=signed_double_area(result); if(area==0)return std::unexpected(civic::core::error(civic::core::ErrorCode::invalid_argument,"zero-area polygon")); if(area<0)std::reverse(result.vertices.begin(),result.vertices.end());
  auto it=std::min_element(result.vertices.begin(),result.vertices.end(),[](Point a,Point b){return a.x<b.x||(a.x==b.x&&a.y<b.y);}); std::rotate(result.vertices.begin(),it,result.vertices.end()); return result;
}
std::uint64_t deterministic_hash(const Polygon& polygon) noexcept {
  auto canon=canonicalize(polygon); if(!canon)return 0; std::uint64_t h=1469598103934665603ULL; auto mix=[&](std::uint64_t x){for(int i=0;i<8;++i){h^=(x>>(i*8))&0xffU;h*=1099511628211ULL;}}; for(auto p:canon->vertices){mix(static_cast<std::uint64_t>(p.x));mix(static_cast<std::uint64_t>(p.y));} return h;
}
Polygon rectangle(Coordinate min_x,Coordinate min_y,Coordinate max_x,Coordinate max_y){return Polygon{{{min_x,min_y},{max_x,min_y},{max_x,max_y},{min_x,max_y}}};}
}
