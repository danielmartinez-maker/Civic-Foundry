#include "civic/world/Terrain.hpp"
#include <algorithm>
#include <array>
#include <cmath>

namespace civic::world {
namespace { constexpr std::array<SoilProperties,8> props{{{4,600,.10,1.05},{35,300,.20,.90},{28,180,.45,1.00},{18,160,.35,1.00},{5,120,.25,1.18},{12,90,.55,1.28},{8,35,.30,1.70},{10,80,.50,1.35}}}; double clamp(double x,double a,double b){return std::max(a,std::min(b,x));} }
const SoilProperties& soil_properties(SoilClass soil) noexcept { return props[static_cast<std::size_t>(soil)]; }
civic::core::Result<const TerrainPhysicalSample*> TerrainField::at(std::uint32_t x,std::uint32_t y) const noexcept { if(x>=width||y>=height||samples.size()!=static_cast<std::size_t>(width)*height)return std::unexpected(civic::core::error(civic::core::ErrorCode::invalid_argument,"terrain coordinate out of bounds"));return &samples[static_cast<std::size_t>(y)*width+x]; }
civic::core::Result<double> land_preparation_multiplier(const LandPreparationInputs& i) noexcept {
  if(!std::isfinite(i.slope)||!std::isfinite(i.bedrock_depth_meters)||!std::isfinite(i.groundwater_depth_meters)||!std::isfinite(i.contamination_index)||!std::isfinite(i.flood_susceptibility)||i.slope<0||i.bedrock_depth_meters<0||i.groundwater_depth_meters<0)return std::unexpected(civic::core::error(civic::core::ErrorCode::invalid_argument,"invalid terrain preparation input"));
  const auto& s=soil_properties(i.soil_class); const double slope=1+clamp(i.slope,0,1.5)*.85; const double gw=1+clamp((2.5-i.groundwater_depth_meters)/2.5,0,1)*.35; const double cont=1+clamp(i.contamination_index,0,1)*.60; const double bed=1+clamp((i.bedrock_depth_meters-5)/15,0,1)*.18; const double flood=1+clamp(i.flood_susceptibility,0,1)*.40; return clamp(s.preparation_base*slope*gw*cont*bed*flood,.75,3.0);
}
}
