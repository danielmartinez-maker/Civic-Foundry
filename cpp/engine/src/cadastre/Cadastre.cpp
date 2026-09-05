#include "civic/cadastre/Cadastre.hpp"
#include <algorithm>
#include <array>
#include <cmath>
#include <functional>
#include <set>

namespace civic::cadastre {
namespace {
using civic::core::ErrorCode;
using civic::core::ParcelId;
using civic::geometry::Point;
using civic::geometry::Segment;

constexpr civic::geometry::Coordinate kLegacyCellCm = 2000;
constexpr double kOverlapToleranceM2 = 0.01;
constexpr std::array<std::string_view, 4> kEasementKinds{
    "access", "utility", "drainage", "pedestrian"};
constexpr std::array<std::string_view, 5> kLineageKinds{
    "split", "assembly", "boundary-adjustment", "right-of-way", "easement"};

bool contains_kind(std::string_view value, auto const& accepted) {
  return std::find(accepted.begin(), accepted.end(), value) != accepted.end();
}

std::string point_key(Point point) {
  return std::to_string(point.x) + "," + std::to_string(point.y);
}

std::string boundary_key(Segment segment) {
  if (segment.b < segment.a) std::swap(segment.a, segment.b);
  return "boundary:" + point_key(segment.a) + "|" + point_key(segment.b);
}

bool has_string(const std::vector<std::string>& values, std::string_view value) {
  return std::find(values.begin(), values.end(), value) != values.end();
}

std::int32_t cell_index(civic::geometry::Coordinate value) {
  return static_cast<std::int32_t>(std::floor(
      static_cast<double>(value) / static_cast<double>(kLegacyCellCm)));
}

bool is_legacy_cell(const Parcel& parcel, const civic::geometry::Bounds& bounds) {
  if (parcel.boundary.vertices.size() != 4U ||
      bounds.max_x - bounds.min_x != kLegacyCellCm ||
      bounds.max_y - bounds.min_y != kLegacyCellCm) {
    return false;
  }
  if (bounds.min_x % kLegacyCellCm != 0 || bounds.min_y % kLegacyCellCm != 0) {
    return false;
  }
  const std::set<Point> expected{
      {bounds.min_x, bounds.min_y},
      {bounds.max_x, bounds.min_y},
      {bounds.max_x, bounds.max_y},
      {bounds.min_x, bounds.max_y},
  };
  return std::set<Point>{parcel.boundary.vertices.begin(), parcel.boundary.vertices.end()} == expected;
}

bool lineage_cycle(const std::vector<LineageEvent>& lineage) {
  std::map<ParcelId, std::set<ParcelId>> graph;
  for (const auto& event : lineage) {
    for (const auto source : event.source_parcel_ids) {
      auto& targets = graph[source];
      targets.insert(event.resulting_parcel_ids.begin(), event.resulting_parcel_ids.end());
    }
  }
  std::set<ParcelId> visiting;
  std::set<ParcelId> visited;
  std::function<bool(ParcelId)> visit = [&](ParcelId id) {
    if (visiting.contains(id)) return true;
    if (visited.contains(id)) return false;
    visiting.insert(id);
    if (const auto it = graph.find(id); it != graph.end()) {
      for (const auto next : it->second) {
        if (visit(next)) return true;
      }
    }
    visiting.erase(id);
    visited.insert(id);
    return false;
  };
  for (const auto& [id, _] : graph) {
    if (visit(id)) return true;
  }
  return false;
}

civic::core::Result<void> fail_if(bool condition, std::string message) {
  if (condition) {
    return std::unexpected(civic::core::error(ErrorCode::invariant_failure, std::move(message)));
  }
  return {};
}
}  // namespace

std::uint64_t stable_id_from_key(std::string_view key) noexcept {
  std::uint64_t hash = 1469598103934665603ULL;
  for (const unsigned char byte : key) {
    hash ^= byte;
    hash *= 1099511628211ULL;
  }
  return hash == 0 ? 1 : hash;
}

ParcelId parcel_id_from_external(std::string_view external_id) noexcept {
  return ParcelId{stable_id_from_key(external_id)};
}

std::vector<ParcelId> canonical_ids(std::vector<ParcelId> ids) {
  std::sort(ids.begin(), ids.end());
  ids.erase(std::unique(ids.begin(), ids.end()), ids.end());
  return ids;
}

const Parcel* CadastralGraph::find(ParcelId id) const noexcept {
  const auto it = parcels_.find(id);
  return it == parcels_.end() ? nullptr : &it->second;
}

Parcel* CadastralGraph::find(ParcelId id) noexcept {
  const auto it = parcels_.find(id);
  return it == parcels_.end() ? nullptr : &it->second;
}

const Parcel* CadastralGraph::find_external(std::string_view external_id) const noexcept {
  for (const auto& [_, parcel] : parcels_) {
    if (parcel.external_id == external_id) return &parcel;
  }
  return nullptr;
}

const ParcelBoundary* CadastralGraph::find_boundary(std::string_view id) const noexcept {
  const auto it = boundaries_.find(std::string{id});
  return it == boundaries_.end() ? nullptr : &it->second;
}

std::vector<const Parcel*> CadastralGraph::live_parcels() const {
  std::vector<const Parcel*> result;
  result.reserve(parcels_.size());
  for (const auto& [_, parcel] : parcels_) {
    if (parcel.live) result.push_back(&parcel);
  }
  return result;
}

civic::core::Result<void> CadastralGraph::insert(Parcel parcel) noexcept {
  try {
    if (parcel.external_id.empty() || parcel.id.value() == 0) {
      return std::unexpected(civic::core::error(ErrorCode::invalid_argument, "parcel identity required"));
    }
    if (parcel.id != parcel_id_from_external(parcel.external_id)) {
      return std::unexpected(civic::core::error(ErrorCode::invalid_argument, "parcel id must derive from external id"));
    }
    if (parcels_.contains(parcel.id) || find_external(parcel.external_id) != nullptr) {
      return std::unexpected(civic::core::error(ErrorCode::conflict, "duplicate parcel identity"));
    }
    auto canonical = civic::geometry::canonicalize(parcel.boundary);
    if (!canonical) return std::unexpected(canonical.error());
    parcel.boundary = std::move(*canonical);
    parcel.area_m2 = civic::geometry::area_square_meters(parcel.boundary);
    auto center = civic::geometry::centroid(parcel.boundary);
    if (!center) return std::unexpected(center.error());
    parcel.centroid = *center;
    parcel.historical_parent_ids = canonical_ids(std::move(parcel.historical_parent_ids));
    const auto id = parcel.id;
    parcels_.emplace(id, std::move(parcel));
    auto topology = rebuild_topology();
    if (!topology) {
      parcels_.erase(id);
      (void)rebuild_topology();
      return topology;
    }
    ++revision_;
    return {};
  } catch (const std::exception& exception) {
    return std::unexpected(civic::core::error(ErrorCode::internal_error, exception.what()));
  }
}

civic::core::Result<void> CadastralGraph::retire(ParcelId id) noexcept {
  auto* parcel = find(id);
  if (parcel == nullptr) {
    return std::unexpected(civic::core::error(ErrorCode::not_found, "parcel not found"));
  }
  if (!parcel->live) {
    return std::unexpected(civic::core::error(ErrorCode::conflict, "parcel already retired"));
  }
  parcel->live = false;
  auto topology = rebuild_topology();
  if (!topology) {
    parcel->live = true;
    (void)rebuild_topology();
    return topology;
  }
  ++revision_;
  return {};
}

civic::core::Result<void> CadastralGraph::add_easement(Easement easement) noexcept {
  try {
    if (easement.id.empty() || !contains_kind(easement.kind, kEasementKinds) ||
        easement.parcel_ids.empty() || easement.geometry.size() < 2U) {
      return std::unexpected(civic::core::error(ErrorCode::invalid_argument, "invalid easement"));
    }
    if (easements_.contains(easement.id)) {
      return std::unexpected(civic::core::error(ErrorCode::conflict, "duplicate easement id"));
    }
    easement.parcel_ids = canonical_ids(std::move(easement.parcel_ids));
    for (const auto id : easement.parcel_ids) {
      if (!parcels_.contains(id)) {
        return std::unexpected(civic::core::error(ErrorCode::not_found, "easement parcel missing"));
      }
    }
    easements_.emplace(easement.id, std::move(easement));
    ++revision_;
    return {};
  } catch (const std::exception& exception) {
    return std::unexpected(civic::core::error(ErrorCode::internal_error, exception.what()));
  }
}

civic::core::Result<void> CadastralGraph::remove_easement(std::string_view id) noexcept {
  if (easements_.erase(std::string{id}) == 0U) {
    return std::unexpected(civic::core::error(ErrorCode::not_found, "easement not found"));
  }
  ++revision_;
  return {};
}

civic::core::Result<void> CadastralGraph::append_lineage(LineageEvent event) noexcept {
  try {
    if (event.id.empty() || !contains_kind(event.kind, kLineageKinds) || event.tick == 0 ||
        event.source_parcel_ids.empty() || event.resulting_parcel_ids.empty()) {
      return std::unexpected(civic::core::error(ErrorCode::invalid_argument, "invalid lineage event"));
    }
    if (std::any_of(lineage_.begin(), lineage_.end(), [&](const LineageEvent& existing) {
          return existing.id == event.id;
        })) {
      return std::unexpected(civic::core::error(ErrorCode::conflict, "duplicate lineage id"));
    }
    event.source_parcel_ids = canonical_ids(std::move(event.source_parcel_ids));
    event.resulting_parcel_ids = canonical_ids(std::move(event.resulting_parcel_ids));
    for (const auto id : event.source_parcel_ids) {
      if (!parcels_.contains(id)) {
        return std::unexpected(civic::core::error(ErrorCode::not_found, "lineage source missing"));
      }
    }
    for (const auto id : event.resulting_parcel_ids) {
      if (!parcels_.contains(id)) {
        return std::unexpected(civic::core::error(ErrorCode::not_found, "lineage result missing"));
      }
    }
    const auto inserted = event.id;
    lineage_.push_back(std::move(event));
    std::sort(lineage_.begin(), lineage_.end(), [](const LineageEvent& left, const LineageEvent& right) {
      return left.tick < right.tick || (left.tick == right.tick && left.id < right.id);
    });
    if (lineage_cycle(lineage_)) {
      lineage_.erase(std::remove_if(lineage_.begin(), lineage_.end(), [&](const LineageEvent& current) {
        return current.id == inserted;
      }), lineage_.end());
      return std::unexpected(civic::core::error(ErrorCode::invariant_failure, "parcel lineage contains cycle"));
    }
    ++revision_;
    return {};
  } catch (const std::exception& exception) {
    return std::unexpected(civic::core::error(ErrorCode::internal_error, exception.what()));
  }
}

civic::core::Result<void> CadastralGraph::set_boundary_semantics(
    std::string_view boundary_id,
    std::string kind,
    std::optional<std::string> road_ref,
    bool frontage,
    bool access) noexcept {
  auto it = boundaries_.find(std::string{boundary_id});
  if (it == boundaries_.end()) {
    return std::unexpected(civic::core::error(ErrorCode::not_found, "boundary not found"));
  }
  if (kind.empty()) {
    return std::unexpected(civic::core::error(ErrorCode::invalid_argument, "boundary kind required"));
  }
  if (kind == "street-frontage" && !road_ref) {
    return std::unexpected(civic::core::error(ErrorCode::invalid_argument, "street frontage requires road ref"));
  }
  it->second.kind = std::move(kind);
  it->second.road_ref = std::move(road_ref);
  auto apply = [&](std::optional<ParcelId> id) {
    if (!id) return;
    auto* parcel = find(*id);
    if (parcel == nullptr || !parcel->live) return;
    auto update = [&](std::vector<std::string>& values, bool enabled) {
      values.erase(std::remove(values.begin(), values.end(), it->first), values.end());
      if (enabled) values.push_back(it->first);
      std::sort(values.begin(), values.end());
      values.erase(std::unique(values.begin(), values.end()), values.end());
    };
    update(parcel->frontage_boundary_ids, frontage);
    update(parcel->access_boundary_ids, access);
  };
  apply(it->second.left_parcel_id);
  apply(it->second.right_parcel_id);
  ++revision_;
  return {};
}

civic::core::Result<void> CadastralGraph::rebuild_topology() noexcept {
  try {
    const auto previous = boundaries_;
    boundaries_.clear();
    for (auto& [parcel_id, parcel] : parcels_) {
      if (!parcel.live) {
        parcel.boundaries.clear();
        parcel.frontage_boundary_ids.clear();
        parcel.access_boundary_ids.clear();
        continue;
      }
      std::vector<std::string> ids;
      ids.reserve(parcel.boundary.vertices.size());
      for (std::size_t index = 0; index < parcel.boundary.vertices.size(); ++index) {
        Segment segment{
            parcel.boundary.vertices[index],
            parcel.boundary.vertices[(index + 1U) % parcel.boundary.vertices.size()]};
        const auto id = boundary_key(segment);
        auto [entry, inserted] = boundaries_.try_emplace(
            id, ParcelBoundary{id, segment, parcel_id, std::nullopt, "property-boundary", std::nullopt});
        if (!inserted) {
          if (entry->second.left_parcel_id == parcel_id || entry->second.right_parcel_id == parcel_id) {
            return std::unexpected(civic::core::error(ErrorCode::invariant_failure, "parcel repeats boundary"));
          }
          if (entry->second.right_parcel_id) {
            return std::unexpected(civic::core::error(ErrorCode::invariant_failure, "boundary has >2 parcels"));
          }
          entry->second.right_parcel_id = parcel_id;
        }
        if (const auto old = previous.find(id); old != previous.end()) {
          entry->second.kind = old->second.kind;
          entry->second.road_ref = old->second.road_ref;
        }
        ids.push_back(id);
      }
      parcel.boundaries = std::move(ids);
      auto retain = [&](std::vector<std::string>& values) {
        values.erase(std::remove_if(values.begin(), values.end(), [&](const std::string& id) {
          return !has_string(parcel.boundaries, id);
        }), values.end());
        std::sort(values.begin(), values.end());
        values.erase(std::unique(values.begin(), values.end()), values.end());
      };
      retain(parcel.frontage_boundary_ids);
      retain(parcel.access_boundary_ids);
    }
    return {};
  } catch (const std::exception& exception) {
    return std::unexpected(civic::core::error(ErrorCode::internal_error, exception.what()));
  }
}

civic::core::Result<void> CadastralGraph::validate() const noexcept {
  try {
    std::set<std::string> external;
    for (const auto& [id, parcel] : parcels_) {
      if (auto result = fail_if(id.value() == 0 || parcel.external_id.empty(), "invalid parcel identity"); !result) return result;
      if (auto result = fail_if(id != parcel_id_from_external(parcel.external_id), "parcel id derivation mismatch"); !result) return result;
      if (auto result = fail_if(!external.insert(parcel.external_id).second, "duplicate parcel external id"); !result) return result;
      if (!parcel.live) continue;
      auto canonical = civic::geometry::canonicalize(parcel.boundary);
      if (!canonical) return std::unexpected(civic::core::error(ErrorCode::invariant_failure, "invalid live parcel geometry"));
      if (auto result = fail_if(std::abs(civic::geometry::area_square_meters(*canonical) - parcel.area_m2) > 1e-9, "parcel area cache mismatch"); !result) return result;
      for (const auto parent : parcel.historical_parent_ids) {
        if (auto result = fail_if(parent == id || !parcels_.contains(parent), "invalid historical parent"); !result) return result;
      }
      for (const auto& boundary_id : parcel.boundaries) {
        const auto boundary = boundaries_.find(boundary_id);
        if (auto result = fail_if(boundary == boundaries_.end(), "missing shared boundary"); !result) return result;
        if (auto result = fail_if(boundary->second.left_parcel_id != id && boundary->second.right_parcel_id != id, "boundary ownership mismatch"); !result) return result;
      }
      for (const auto& frontage : parcel.frontage_boundary_ids) {
        if (auto result = fail_if(!has_string(parcel.boundaries, frontage), "frontage not on boundary"); !result) return result;
      }
      for (const auto& access : parcel.access_boundary_ids) {
        if (auto result = fail_if(!has_string(parcel.boundaries, access), "access not on boundary"); !result) return result;
      }
    }

    for (const auto& [_, boundary] : boundaries_) {
      if (auto result = fail_if(boundary.geometry.a == boundary.geometry.b || !boundary.left_parcel_id, "invalid shared boundary"); !result) return result;
      if (boundary.left_parcel_id && boundary.right_parcel_id) {
        if (auto result = fail_if(*boundary.left_parcel_id == *boundary.right_parcel_id, "same parcel on both sides"); !result) return result;
      }
      for (const auto id : {boundary.left_parcel_id, boundary.right_parcel_id}) {
        if (!id) continue;
        const auto* parcel = find(*id);
        if (auto result = fail_if(parcel == nullptr || !parcel->live, "boundary references non-live parcel"); !result) return result;
      }
      if (boundary.kind == "street-frontage") {
        if (auto result = fail_if(!boundary.road_ref, "street frontage missing road ref"); !result) return result;
      }
    }

    const auto live = live_parcels();
    for (std::size_t left = 0; left < live.size(); ++left) {
      for (std::size_t right = left + 1U; right < live.size(); ++right) {
        auto overlap = civic::geometry::polygon_intersection(live[left]->boundary, live[right]->boundary);
        if (!overlap) return std::unexpected(overlap.error());
        if (civic::geometry::total_area_square_meters(*overlap) > kOverlapToleranceM2) {
          return std::unexpected(civic::core::error(ErrorCode::invariant_failure, "live parcels overlap"));
        }
      }
    }

    for (const auto& [_, easement] : easements_) {
      if (auto result = fail_if(!contains_kind(easement.kind, kEasementKinds), "invalid easement kind"); !result) return result;
      for (const auto id : easement.parcel_ids) {
        if (auto result = fail_if(!parcels_.contains(id), "easement parcel missing"); !result) return result;
      }
    }

    std::uint64_t prior_tick = 0;
    std::set<std::string> lineage_ids;
    for (const auto& event : lineage_) {
      if (auto result = fail_if(event.tick == 0 || event.tick < prior_tick || !lineage_ids.insert(event.id).second, "invalid lineage order/id"); !result) return result;
      if (auto result = fail_if(!contains_kind(event.kind, kLineageKinds), "invalid lineage kind"); !result) return result;
      prior_tick = event.tick;
      for (const auto id : event.source_parcel_ids) {
        if (auto result = fail_if(!parcels_.contains(id), "lineage source missing"); !result) return result;
      }
      for (const auto id : event.resulting_parcel_ids) {
        if (auto result = fail_if(!parcels_.contains(id), "lineage result missing"); !result) return result;
      }
    }
    if (lineage_cycle(lineage_)) {
      return std::unexpected(civic::core::error(ErrorCode::invariant_failure, "lineage cycle"));
    }
    return {};
  } catch (const std::exception& exception) {
    return std::unexpected(civic::core::error(ErrorCode::internal_error, exception.what()));
  }
}

LegacyLotProjection CadastralGraph::legacy_lot_projection() const {
  LegacyLotProjection result;
  for (const auto* parcel : live_parcels()) {
    auto parcel_bounds = civic::geometry::bounds(parcel->boundary);
    if (!parcel_bounds) {
      result.diagnostics.push_back("parcel " + parcel->external_id + " has invalid bounds");
      continue;
    }
    const bool faithful = is_legacy_cell(*parcel, *parcel_bounds);
    result.lots.push_back({
        parcel->id,
        parcel->external_id,
        cell_index(parcel_bounds->min_x),
        cell_index(parcel_bounds->min_y),
        faithful,
    });
    if (!faithful) {
      result.diagnostics.push_back(
          "parcel " + parcel->external_id + " cannot be faithfully represented by one 20m legacy lot cell");
    }
  }

  std::sort(result.lots.begin(), result.lots.end(),
            [](const LegacyLotProjectionEntry& left, const LegacyLotProjectionEntry& right) {
              if (left.y != right.y) return left.y < right.y;
              if (left.x != right.x) return left.x < right.x;
              if (left.parcel_external_id != right.parcel_external_id) {
                return left.parcel_external_id < right.parcel_external_id;
              }
              return left.parcel_id.value() < right.parcel_id.value();
            });

  for (std::size_t first = 0; first < result.lots.size();) {
    std::size_t last = first + 1U;
    while (last < result.lots.size() &&
           result.lots[last].x == result.lots[first].x &&
           result.lots[last].y == result.lots[first].y) {
      ++last;
    }
    if (last - first > 1U) {
      std::string diagnostic =
          "legacy cell " + std::to_string(result.lots[first].x) + "," +
          std::to_string(result.lots[first].y) +
          " represents multiple live canonical parcels: ";
      for (std::size_t index = first; index < last; ++index) {
        if (index != first) diagnostic += ", ";
        diagnostic += result.lots[index].parcel_external_id;
      }
      diagnostic += "; compatibility consumers must not collapse identities";
      result.diagnostics.push_back(std::move(diagnostic));
    }
    first = last;
  }

  std::sort(result.diagnostics.begin(), result.diagnostics.end());
  return result;
}

civic::core::Result<void> CadastreTransaction::commit() noexcept {
  auto validation = staged_.validate();
  if (!validation) return validation;
  target_ = std::move(staged_);
  ++target_.revision_;
  return {};
}

}  // namespace civic::cadastre