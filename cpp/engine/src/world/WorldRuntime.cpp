#include "civic/world/WorldFoundation.hpp"

namespace civic::world {

civic::core::Result<WorldFoundation> WorldFoundation::restore_with_flood(
    WorldSnapshot snapshot,
    std::optional<FloodResult> last_flood_result) noexcept {
  auto restored = restore(std::move(snapshot));
  if (!restored) return std::unexpected(restored.error());
  restored->last_flood_result_ = std::move(last_flood_result);
  return restored;
}

civic::core::Result<FloodResult> WorldFoundation::run_design_storm(
    const DesignStormEvent& event,
    const std::vector<double>* impervious_fraction) noexcept {
  auto result = civic::world::run_design_storm(event, terrain(), hydrology(), impervious_fraction);
  if (!result) return std::unexpected(result.error());
  last_flood_result_ = *result;
  return *result;
}

} // namespace civic::world
