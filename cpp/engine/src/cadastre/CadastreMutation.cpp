#include "civic/cadastre/CadastreMutation.hpp"
#include <algorithm>
#include <cmath>
#include <set>

namespace civic::cadastre {
namespace {
using civic::core::ErrorCode;
using civic::core::ParcelId;
using civic::geometry::Point;
using civic::geometry::Polygon;
using civic::geometry::Segment;
constexpr int kEasementSampleSteps = 8;

bool same(Point left, Point right) { return left == right; }

long double parameter(Point point, Point start, Point end) {
  const auto dx = end.x - start.x;
  const auto dy = end.y - start.y;
  const long double denominator = static_cast<long double>(dx) * dx +
                                  static_cast<long double>(dy) * dy;
  if (denominator == 0) return 0;
  return (static_cast<long double>(point.x - start.x) * dx +
          static_cast<long double>(point.y - start.y) * dy) / denominator;
}

bool chord_inside(const Polygon& polygon, Segment chord) {
  for (int step = 1; step < 32; ++step) {
    const long double t = static_cast<long double>(step) / 32.0L;
    Point point{
        static_cast<civic::geometry::Coordinate>(std::llround(
            static_cast<long double>(chord.a.x) +
            static_cast<long double>(chord.b.x - chord.a.x) * t)),
        static_cast<civic::geometry::Coordinate>(std::llround(
            static_cast<long double>(chord.a.y) +
            static_cast<long double>(chord.b.y - chord.a.y) * t)),
    };
    if (!civic::geometry::point_in_polygon(point, polygon)) return false;
  }
  return true;
}

civic::core::Result<std::pair<Polygon, Polygon>> split_by_chord(
    const Polygon& input,
    Segment chord) noexcept {
  try {
    auto canonical = civic::geometry::canonicalize(input);
    if (!canonical) return std::unexpected(canonical.error());
    if (same(chord.a, chord.b) || !chord_inside(*canonical, chord)) {
      return std::unexpected(civic::core::error(
          ErrorCode::invalid_argument, "split chord must cross parcel interior"));
    }

    std::vector<Point> expanded;
    expanded.reserve(canonical->vertices.size() + 2U);
    bool found_a = false;
    bool found_b = false;
    for (std::size_t index = 0; index < canonical->vertices.size(); ++index) {
      const auto start = canonical->vertices[index];
      const auto end = canonical->vertices[(index + 1U) % canonical->vertices.size()];
      expanded.push_back(start);
      std::vector<Point> insert;
      for (const auto point : {chord.a, chord.b}) {
        if (!civic::geometry::point_on_segment(point, {start, end})) continue;
        if (same(point, start)) {
          if (same(point, chord.a)) found_a = true;
          else found_b = true;
        } else if (!same(point, end)) {
          insert.push_back(point);
        }
      }
      std::sort(insert.begin(), insert.end(), [&](Point left, Point right) {
        return parameter(left, start, end) < parameter(right, start, end);
      });
      for (const auto point : insert) {
        if (expanded.back() != point) expanded.push_back(point);
        if (same(point, chord.a)) found_a = true;
        else if (same(point, chord.b)) found_b = true;
      }
    }
    for (const auto point : expanded) {
      if (same(point, chord.a)) found_a = true;
      if (same(point, chord.b)) found_b = true;
    }
    if (!found_a || !found_b) {
      return std::unexpected(civic::core::error(
          ErrorCode::invalid_argument, "split endpoints must lie on parcel boundary"));
    }

    const auto a = std::find(expanded.begin(), expanded.end(), chord.a);
    const auto b = std::find(expanded.begin(), expanded.end(), chord.b);
    if (a == expanded.end() || b == expanded.end()) {
      return std::unexpected(civic::core::error(
          ErrorCode::invalid_argument, "split endpoints were not inserted"));
    }
    const auto a_index = static_cast<std::size_t>(a - expanded.begin());
    const auto b_index = static_cast<std::size_t>(b - expanded.begin());
    auto collect = [&](std::size_t from, std::size_t to) {
      Polygon out;
      for (std::size_t index = from;; index = (index + 1U) % expanded.size()) {
        out.vertices.push_back(expanded[index]);
        if (index == to) break;
      }
      return civic::geometry::canonicalize(out);
    };
    auto left = collect(a_index, b_index);
    auto right = collect(b_index, a_index);
    if (!left) return std::unexpected(left.error());
    if (!right) return std::unexpected(right.error());
    if (civic::geometry::area_square_meters(*left) < 1.0 ||
        civic::geometry::area_square_meters(*right) < 1.0) {
      return std::unexpected(civic::core::error(
          ErrorCode::invalid_argument, "split produces sub-minimum parcel"));
    }
    return std::pair<Polygon, Polygon>{std::move(*left), std::move(*right)};
  } catch (const std::exception& exception) {
    return std::unexpected(civic::core::error(ErrorCode::internal_error, exception.what()));
  }
}

Parcel child_from(
    const Parcel& source,
    std::string external,
    Polygon boundary,
    std::vector<ParcelId> parents) {
  Parcel child = source;
  child.id = parcel_id_from_external(external);
  child.external_id = std::move(external);
  child.boundary = std::move(boundary);
  child.historical_parent_ids = canonical_ids(std::move(parents));
  child.boundaries.clear();
  child.frontage_boundary_ids.clear();
  child.access_boundary_ids.clear();
  child.live = true;
  return child;
}

std::vector<ParcelId> inherited_parents(std::span<const Parcel* const> parcels) {
  std::vector<ParcelId> ids;
  for (const auto* parcel : parcels) {
    ids.push_back(parcel->id);
    ids.insert(ids.end(), parcel->historical_parent_ids.begin(), parcel->historical_parent_ids.end());
  }
  return canonical_ids(std::move(ids));
}

std::string lineage_id(std::uint64_t tick, std::string_view kind) {
  return "lineage:" + std::to_string(tick) + ":" + std::string{kind};
}

bool point_in_any_parcel(Point point, std::span<const Polygon> polygons) {
  return std::any_of(polygons.begin(), polygons.end(), [&](const Polygon& polygon) {
    return civic::geometry::point_in_polygon(point, polygon);
  });
}

bool polyline_within_parcels(
    std::span<const Point> polyline,
    std::span<const Polygon> polygons) {
  if (polyline.size() < 2U || polygons.empty()) return false;
  for (std::size_t segment = 0; segment + 1U < polyline.size(); ++segment) {
    const auto start = polyline[segment];
    const auto end = polyline[segment + 1U];
    for (int step = 0; step <= kEasementSampleSteps; ++step) {
      const long double t = static_cast<long double>(step) /
                            static_cast<long double>(kEasementSampleSteps);
      const Point point{
          static_cast<civic::geometry::Coordinate>(std::llround(
              static_cast<long double>(start.x) +
              static_cast<long double>(end.x - start.x) * t)),
          static_cast<civic::geometry::Coordinate>(std::llround(
              static_cast<long double>(start.y) +
              static_cast<long double>(end.y - start.y) * t)),
      };
      if (!point_in_any_parcel(point, polygons)) return false;
    }
  }
  return true;
}

std::string next_easement_id(
    const CadastralGraph& graph,
    std::string_view kind,
    std::span<const ParcelId> parcel_ids) {
  std::vector<std::string> external_ids;
  external_ids.reserve(parcel_ids.size());
  for (const auto id : parcel_ids) {
    const auto* parcel = graph.find(id);
    if (parcel != nullptr) external_ids.push_back(parcel->external_id);
  }
  std::sort(external_ids.begin(), external_ids.end());
  external_ids.erase(std::unique(external_ids.begin(), external_ids.end()), external_ids.end());
  std::string base = "easement:" + std::string{kind} + ":";
  for (std::size_t index = 0; index < external_ids.size(); ++index) {
    if (index != 0U) base += "+";
    base += external_ids[index];
  }
  if (!graph.easements().contains(base)) return base;
  for (std::uint64_t suffix = 1;; ++suffix) {
    const auto candidate = base + ":" + std::to_string(suffix);
    if (!graph.easements().contains(candidate)) return candidate;
  }
}

bool has_easement(const CadastralGraph& graph, ParcelId parcel_id) {
  for (const auto& [_, easement] : graph.easements()) {
    if (std::find(easement.parcel_ids.begin(), easement.parcel_ids.end(), parcel_id) !=
        easement.parcel_ids.end()) return true;
  }
  return false;
}

civic::core::Result<void> invariant(bool failed, std::string message) {
  if (!failed) return {};
  return std::unexpected(civic::core::error(ErrorCode::invariant_failure, std::move(message)));
}
}  // namespace

std::string_view mutation_stage_name(MutationStage stage) noexcept {
  switch (stage) {
    case MutationStage::snapshot_owners: return "snapshot-owners";
    case MutationStage::clone_stage: return "clone-stage";
    case MutationStage::apply_mutation: return "apply-mutation";
    case MutationStage::rewrite_dependent_references: return "rewrite-dependent-references";
    case MutationStage::validate_topology: return "validate-topology";
    case MutationStage::validate_ownership_zoning_access: return "validate-ownership-zoning-access";
    case MutationStage::validate_buildings_property_references: return "validate-buildings-property-references";
    case MutationStage::validate_compatibility_projection: return "validate-compatibility-projection";
    case MutationStage::atomic_commit: return "atomic-commit";
  }
  return "unknown";
}

std::uint64_t CadastralMutationService::next_sequence() const noexcept {
  return graph_.lineage().size() + 1U;
}

std::uint64_t CadastralMutationService::next_lineage_tick() const noexcept {
  std::uint64_t tick = 0;
  for (const auto& event : graph_.lineage()) tick = std::max(tick, event.tick);
  return tick + 1U;
}

civic::core::Result<void> CadastralMutationService::run_stage(
    MutationStage stage,
    const CadastralGraph& graph) const noexcept {
  if (!stage_validator_) return {};
  try {
    return stage_validator_(stage, graph);
  } catch (const std::exception& exception) {
    return std::unexpected(civic::core::error(ErrorCode::internal_error, exception.what()));
  } catch (...) {
    return std::unexpected(civic::core::error(
        ErrorCode::internal_error,
        std::string{"mutation stage validator failed at "} + std::string{mutation_stage_name(stage)}));
  }
}

civic::core::Result<void> CadastralMutationService::validate_dependents(
    const CadastralGraph& staged) const noexcept {
  try {
    for (const auto& validator : validators_) {
      auto result = validator(staged);
      if (!result) return result;
    }
    return {};
  } catch (const std::exception& exception) {
    return std::unexpected(civic::core::error(ErrorCode::internal_error, exception.what()));
  } catch (...) {
    return std::unexpected(civic::core::error(
        ErrorCode::internal_error, "dependent cadastral validation failed"));
  }
}

civic::core::Result<void> CadastralMutationService::validate_ownership_zoning_access(
    const CadastralGraph& staged) const noexcept {
  try {
    for (const auto* parcel : staged.live_parcels()) {
      if (auto result = invariant(parcel->block_id.empty(), "live parcel missing block identity"); !result) {
        return result;
      }
      if (auto result = invariant(parcel->zoning_district_id.empty(), "live parcel missing zoning identity"); !result) {
        return result;
      }
      if (auto result = invariant(parcel->owner_id.has_value() && parcel->owner_id->empty(),
                                  "live parcel has empty owner identity"); !result) {
        return result;
      }
      auto validates_boundary_reference = [&](const std::string& boundary_id) {
        const auto* boundary = staged.find_boundary(boundary_id);
        return boundary != nullptr &&
               (boundary->left_parcel_id == parcel->id || boundary->right_parcel_id == parcel->id);
      };
      for (const auto& boundary_id : parcel->frontage_boundary_ids) {
        if (!validates_boundary_reference(boundary_id)) {
          return std::unexpected(civic::core::error(
              ErrorCode::invariant_failure, "parcel frontage references foreign boundary"));
        }
      }
      for (const auto& boundary_id : parcel->access_boundary_ids) {
        if (!validates_boundary_reference(boundary_id)) {
          return std::unexpected(civic::core::error(
              ErrorCode::invariant_failure, "parcel access references foreign boundary"));
        }
      }
    }
    return {};
  } catch (const std::exception& exception) {
    return std::unexpected(civic::core::error(ErrorCode::internal_error, exception.what()));
  }
}

civic::core::Result<void> CadastralMutationService::validate_compatibility_projection(
    const CadastralGraph& staged) const noexcept {
  try {
    const auto projection = staged.legacy_lot_projection();
    std::set<ParcelId> projected;
    for (const auto& lot : projection.lots) {
      const auto* parcel = staged.find(lot.parcel_id);
      if (parcel == nullptr || !parcel->live) {
        return std::unexpected(civic::core::error(
            ErrorCode::invariant_failure, "legacy projection references non-live parcel"));
      }
      if (!projected.insert(lot.parcel_id).second) {
        return std::unexpected(civic::core::error(
            ErrorCode::invariant_failure, "legacy projection duplicates canonical parcel"));
      }
      if (!lot.faithful) {
        const bool diagnosed = std::any_of(
            projection.diagnostics.begin(), projection.diagnostics.end(),
            [&](const std::string& diagnostic) {
              return diagnostic.find(parcel->external_id) != std::string::npos;
            });
        if (!diagnosed) {
          return std::unexpected(civic::core::error(
              ErrorCode::invariant_failure, "unfaithful legacy projection lacks diagnostic"));
        }
      }
    }
    if (projected.size() != staged.live_parcels().size()) {
      return std::unexpected(civic::core::error(
          ErrorCode::invariant_failure, "legacy projection omitted live canonical parcel"));
    }
    return {};
  } catch (const std::exception& exception) {
    return std::unexpected(civic::core::error(ErrorCode::internal_error, exception.what()));
  }
}

civic::core::Result<void> CadastralMutationService::finalize_transaction(
    CadastreTransaction& transaction) const noexcept {
  auto& staged = transaction.staged();

  if (auto result = run_stage(MutationStage::rewrite_dependent_references, staged); !result) return result;

  if (auto result = staged.validate(); !result) return result;
  if (auto result = run_stage(MutationStage::validate_topology, staged); !result) return result;

  if (auto result = validate_ownership_zoning_access(staged); !result) return result;
  if (auto result = run_stage(MutationStage::validate_ownership_zoning_access, staged); !result) return result;

  if (auto result = validate_dependents(staged); !result) return result;
  if (auto result = run_stage(MutationStage::validate_buildings_property_references, staged); !result) return result;

  if (auto result = validate_compatibility_projection(staged); !result) return result;
  if (auto result = run_stage(MutationStage::validate_compatibility_projection, staged); !result) return result;

  if (auto result = run_stage(MutationStage::atomic_commit, staged); !result) return result;
  return transaction.commit();
}

civic::core::Result<MutationResult> CadastralMutationService::split(
    const ParcelSplitCommand& command) noexcept {
  const auto* source = graph_.find(command.parcel_id);
  if (source == nullptr || !source->live) {
    return std::unexpected(civic::core::error(ErrorCode::not_found, "live source parcel not found"));
  }
  auto pieces = split_by_chord(source->boundary, command.cut);
  if (!pieces) return std::unexpected(pieces.error());
  if (has_easement(graph_, source->id)) {
    return std::unexpected(civic::core::error(
        ErrorCode::conflict, "split parcel has easement; explicit easement rewrite required"));
  }
  if (auto result = run_stage(MutationStage::snapshot_owners, graph_); !result) {
    return std::unexpected(result.error());
  }

  CadastreTransaction transaction{graph_};
  auto& staged = transaction.staged();
  if (auto result = run_stage(MutationStage::clone_stage, staged); !result) {
    return std::unexpected(result.error());
  }

  const auto sequence = next_sequence();
  const auto left_external = "parcel:" + source->external_id + ":split:" +
                             std::to_string(sequence) + ":0";
  const auto right_external = "parcel:" + source->external_id + ":split:" +
                              std::to_string(sequence) + ":1";
  std::vector<const Parcel*> parents{source};
  const auto historical = inherited_parents(parents);
  auto left = child_from(*source, left_external, std::move(pieces->first), historical);
  auto right = child_from(*source, right_external, std::move(pieces->second), historical);
  const auto source_id = source->id;
  const auto left_id = left.id;
  const auto right_id = right.id;
  if (auto result = staged.retire(source_id); !result) return std::unexpected(result.error());
  if (auto result = staged.insert(std::move(left)); !result) return std::unexpected(result.error());
  if (auto result = staged.insert(std::move(right)); !result) return std::unexpected(result.error());
  const auto tick = next_lineage_tick();
  if (auto result = staged.append_lineage({
          lineage_id(tick, "split"), tick, "split", {source_id}, {left_id, right_id}}); !result) {
    return std::unexpected(result.error());
  }
  if (auto result = run_stage(MutationStage::apply_mutation, staged); !result) {
    return std::unexpected(result.error());
  }
  if (auto result = finalize_transaction(transaction); !result) return std::unexpected(result.error());
  return MutationResult{{source_id}, {left_id, right_id}, graph_.revision()};
}

civic::core::Result<MutationResult> CadastralMutationService::assemble(
    const ParcelAssemblyCommand& command) noexcept {
  auto ids = canonical_ids(command.parcel_ids);
  if (ids.size() < 2U) {
    return std::unexpected(civic::core::error(
        ErrorCode::invalid_argument, "assembly requires at least two parcels"));
  }
  std::vector<const Parcel*> sources;
  std::vector<Polygon> polygons;
  for (const auto id : ids) {
    const auto* parcel = graph_.find(id);
    if (parcel == nullptr || !parcel->live) {
      return std::unexpected(civic::core::error(
          ErrorCode::not_found, "assembly source parcel not found"));
    }
    sources.push_back(parcel);
    polygons.push_back(parcel->boundary);
  }
  const auto* first = sources.front();
  for (const auto* parcel : sources) {
    if (parcel->block_id != first->block_id ||
        parcel->zoning_district_id != first->zoning_district_id ||
        parcel->owner_id != first->owner_id) {
      return std::unexpected(civic::core::error(
          ErrorCode::conflict, "assembly parcels must share block zoning and owner"));
    }
    if (has_easement(graph_, parcel->id)) {
      return std::unexpected(civic::core::error(ErrorCode::conflict, "assembly parcel has easement"));
    }
  }
  auto united = civic::geometry::polygon_union(polygons);
  if (!united) return std::unexpected(united.error());
  if (united->size() != 1U) {
    return std::unexpected(civic::core::error(
        ErrorCode::invalid_argument, "assembly parcels are disconnected"));
  }
  if (auto result = run_stage(MutationStage::snapshot_owners, graph_); !result) {
    return std::unexpected(result.error());
  }

  std::string external = "parcel:assembly:" + std::to_string(next_sequence());
  std::vector<std::string> source_external_ids;
  source_external_ids.reserve(sources.size());
  for (const auto* parcel : sources) source_external_ids.push_back(parcel->external_id);
  std::sort(source_external_ids.begin(), source_external_ids.end());
  for (const auto& id : source_external_ids) external += ":" + id;
  auto assembled = child_from(*first, external, std::move(united->front()), inherited_parents(sources));

  CadastreTransaction transaction{graph_};
  auto& staged = transaction.staged();
  if (auto result = run_stage(MutationStage::clone_stage, staged); !result) {
    return std::unexpected(result.error());
  }
  for (const auto id : ids) {
    if (auto result = staged.retire(id); !result) return std::unexpected(result.error());
  }
  const auto result_id = assembled.id;
  if (auto result = staged.insert(std::move(assembled)); !result) return std::unexpected(result.error());
  const auto tick = next_lineage_tick();
  if (auto result = staged.append_lineage({
          lineage_id(tick, "assembly"), tick, "assembly", ids, {result_id}}); !result) {
    return std::unexpected(result.error());
  }
  if (auto result = run_stage(MutationStage::apply_mutation, staged); !result) {
    return std::unexpected(result.error());
  }
  if (auto result = finalize_transaction(transaction); !result) return std::unexpected(result.error());
  return MutationResult{ids, {result_id}, graph_.revision()};
}

civic::core::Result<void> CadastralMutationService::create_easement(
    const EasementCreateCommand& command) noexcept {
  auto target_ids = canonical_ids(command.parcel_ids);
  if (target_ids.empty() || command.geometry.size() < 2U) {
    return std::unexpected(civic::core::error(ErrorCode::invalid_argument, "invalid easement command"));
  }
  if (std::set<Point>{command.geometry.begin(), command.geometry.end()}.size() < 2U) {
    return std::unexpected(civic::core::error(ErrorCode::invalid_argument, "easement geometry collapses"));
  }
  std::vector<Polygon> polygons;
  polygons.reserve(target_ids.size());
  for (const auto id : target_ids) {
    const auto* parcel = graph_.find(id);
    if (parcel == nullptr || !parcel->live) {
      return std::unexpected(civic::core::error(ErrorCode::not_found, "easement parcel not found"));
    }
    polygons.push_back(parcel->boundary);
  }
  if (!polyline_within_parcels(command.geometry, polygons)) {
    return std::unexpected(civic::core::error(
        ErrorCode::invalid_argument, "easement geometry must remain inside referenced parcel union"));
  }
  if (auto result = run_stage(MutationStage::snapshot_owners, graph_); !result) return result;

  CadastreTransaction transaction{graph_};
  auto& staged = transaction.staged();
  if (auto result = run_stage(MutationStage::clone_stage, staged); !result) return result;
  const auto id = command.id.empty()
      ? next_easement_id(staged, command.kind, target_ids)
      : command.id;
  if (auto result = staged.add_easement({id, target_ids, command.kind, command.geometry}); !result) {
    return std::unexpected(result.error());
  }
  if (auto result = run_stage(MutationStage::apply_mutation, staged); !result) return result;
  return finalize_transaction(transaction);
}

civic::core::Result<void> CadastralMutationService::remove_easement(std::string_view id) noexcept {
  if (!graph_.easements().contains(std::string{id})) {
    return std::unexpected(civic::core::error(ErrorCode::not_found, "easement not found"));
  }
  if (auto result = run_stage(MutationStage::snapshot_owners, graph_); !result) return result;
  CadastreTransaction transaction{graph_};
  auto& staged = transaction.staged();
  if (auto result = run_stage(MutationStage::clone_stage, staged); !result) return result;
  if (auto result = staged.remove_easement(id); !result) return result;
  if (auto result = run_stage(MutationStage::apply_mutation, staged); !result) return result;
  return finalize_transaction(transaction);
}

civic::core::Result<MutationResult> CadastralMutationService::dedicate_right_of_way(
    const RightOfWayCommand& command) noexcept {
  const auto* source = graph_.find(command.parcel_id);
  if (source == nullptr || !source->live) {
    return std::unexpected(civic::core::error(ErrorCode::not_found, "ROW source parcel not found"));
  }
  if (has_easement(graph_, source->id)) {
    return std::unexpected(civic::core::error(ErrorCode::conflict, "ROW source parcel has easement"));
  }
  for (const auto point : command.dedicated_area.vertices) {
    if (!civic::geometry::point_in_polygon(point, source->boundary)) {
      return std::unexpected(civic::core::error(
          ErrorCode::invalid_argument, "ROW dedication must be contained by parcel"));
    }
  }
  auto residual = civic::geometry::polygon_difference(source->boundary, command.dedicated_area);
  if (!residual) return std::unexpected(residual.error());
  if (residual->size() != 1U || civic::geometry::area_square_meters(residual->front()) < 1.0) {
    return std::unexpected(civic::core::error(
        ErrorCode::invalid_argument, "ROW dedication must leave one viable residual parcel"));
  }
  if (auto stage = run_stage(MutationStage::snapshot_owners, graph_); !stage) {
    return std::unexpected(stage.error());
  }

  const auto external = "parcel:" + source->external_id + ":row:" + std::to_string(next_sequence());
  std::vector<const Parcel*> source_span{source};
  auto result = child_from(*source, external, std::move(residual->front()), inherited_parents(source_span));

  CadastreTransaction transaction{graph_};
  auto& staged = transaction.staged();
  if (auto stage = run_stage(MutationStage::clone_stage, staged); !stage) {
    return std::unexpected(stage.error());
  }
  const auto old_id = source->id;
  const auto new_id = result.id;
  if (auto retired = staged.retire(old_id); !retired) return std::unexpected(retired.error());
  if (auto inserted = staged.insert(std::move(result)); !inserted) return std::unexpected(inserted.error());
  const auto tick = next_lineage_tick();
  if (auto lineage = staged.append_lineage({
          lineage_id(tick, "right-of-way"), tick, "right-of-way", {old_id}, {new_id}}); !lineage) {
    return std::unexpected(lineage.error());
  }
  if (auto stage = run_stage(MutationStage::apply_mutation, staged); !stage) {
    return std::unexpected(stage.error());
  }
  if (auto committed = finalize_transaction(transaction); !committed) {
    return std::unexpected(committed.error());
  }
  return MutationResult{{old_id}, {new_id}, graph_.revision()};
}

}  // namespace civic::cadastre
