#include "civic/world/WorldFoundation.hpp"

#include <algorithm>
#include <exception>
#include <utility>

namespace civic::world {
namespace {
bool entity_order(const GeographyEntity* lhs, const GeographyEntity* rhs) {
  if (lhs->sort_key != rhs->sort_key) return lhs->sort_key < rhs->sort_key;
  return lhs->id < rhs->id;
}

bool bounds_contains(const civic::geometry::Bounds& bounds,
                     civic::geometry::Point point) noexcept {
  return point.x >= bounds.min_x && point.x <= bounds.max_x &&
         point.y >= bounds.min_y && point.y <= bounds.max_y;
}
}  // namespace

const GeographyEntity* GeographyHierarchy::find(std::string_view id) const noexcept {
  const auto found = std::find_if(entities.begin(), entities.end(), [&](const auto& entity) {
    return entity.id == id;
  });
  return found == entities.end() ? nullptr : &*found;
}

const GeographyEntity* GeographyHierarchy::parent_of(std::string_view id) const noexcept {
  const auto* entity = find(id);
  if (entity == nullptr || entity->parent_id.empty()) return nullptr;
  return find(entity->parent_id);
}

std::vector<const GeographyEntity*> GeographyHierarchy::children_of(std::string_view id) const {
  std::vector<const GeographyEntity*> children;
  for (const auto& entity : entities) {
    if (entity.parent_id == id) children.push_back(&entity);
  }
  std::sort(children.begin(), children.end(), entity_order);
  return children;
}

civic::core::Result<GeographySpatialIndex> GeographySpatialIndex::build(
    const GeographyHierarchy& hierarchy) noexcept {
  try {
    std::vector<GeographySpatialIndexEntry> entries;
    entries.reserve(hierarchy.entities.size());
    for (std::size_t index = 0; index < hierarchy.entities.size(); ++index) {
      const auto entity_bounds = civic::geometry::bounds(hierarchy.entities[index].boundary);
      if (!entity_bounds) {
        return std::unexpected(civic::core::error(
            civic::core::ErrorCode::invalid_argument,
            "geography entity has invalid boundary: " + hierarchy.entities[index].id));
      }
      entries.push_back({index, *entity_bounds});
    }
    std::sort(entries.begin(), entries.end(), [&](const auto& lhs, const auto& rhs) {
      if (lhs.bounds.min_x != rhs.bounds.min_x) return lhs.bounds.min_x < rhs.bounds.min_x;
      if (lhs.bounds.min_y != rhs.bounds.min_y) return lhs.bounds.min_y < rhs.bounds.min_y;
      return hierarchy.entities[lhs.entity_index].id < hierarchy.entities[rhs.entity_index].id;
    });
    return GeographySpatialIndex{std::move(entries)};
  } catch (const std::exception& exception) {
    return std::unexpected(civic::core::error(civic::core::ErrorCode::internal_error,
                                               exception.what()));
  } catch (...) {
    return std::unexpected(civic::core::error(civic::core::ErrorCode::internal_error,
                                               "failed to build geography spatial index"));
  }
}

const GeographyEntity* GeographySpatialIndex::entity_at(
    const GeographyHierarchy& hierarchy,
    civic::geometry::Point point,
    std::optional<GeographyKind> kind) const noexcept {
  const GeographyEntity* best = nullptr;
  for (const auto& entry : entries_) {
    if (entry.bounds.min_x > point.x) break;
    if (entry.entity_index >= hierarchy.entities.size() ||
        !bounds_contains(entry.bounds, point)) {
      continue;
    }
    const auto& candidate = hierarchy.entities[entry.entity_index];
    if (kind.has_value() && candidate.kind != *kind) continue;
    if (!civic::geometry::point_in_polygon(point, candidate.boundary)) continue;
    if (best == nullptr || static_cast<std::uint8_t>(candidate.kind) > static_cast<std::uint8_t>(best->kind) ||
        (candidate.kind == best->kind && candidate.id < best->id)) {
      best = &candidate;
    }
  }
  return best;
}
}  // namespace civic::world
