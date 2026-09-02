#include "civic/snapshot/UrbanFabricSnapshot.hpp"

#include <algorithm>
#include <bit>
#include <cmath>
#include <exception>
#include <set>
#include <type_traits>
#include <utility>

namespace civic::snapshot {
namespace {

using civic::core::BuildingId;
using civic::core::ErrorCode;
using civic::core::ParcelId;

class RevisionHasher final {
public:
  void u64(std::uint64_t value) noexcept {
    for (unsigned shift = 0; shift < 64U; shift += 8U) {
      byte(static_cast<std::uint8_t>((value >> shift) & 0xffU));
    }
  }

  void i64(std::int64_t value) noexcept {
    u64(static_cast<std::uint64_t>(value));
  }

  void boolean(bool value) noexcept { byte(value ? 1U : 0U); }

  void real(double value) noexcept {
    const double normalized = value == 0.0 ? 0.0 : value;
    u64(std::bit_cast<std::uint64_t>(normalized));
  }

  void text(std::string_view value) noexcept {
    u64(static_cast<std::uint64_t>(value.size()));
    for (const unsigned char character : value) byte(character);
  }

  template<class Enum>
  void enumeration(Enum value) noexcept {
    using Underlying = std::underlying_type_t<Enum>;
    u64(static_cast<std::uint64_t>(static_cast<Underlying>(value)));
  }

  template<class Tag, class Storage>
  void id(const civic::core::StrongId<Tag, Storage>& value) noexcept {
    u64(static_cast<std::uint64_t>(value.value()));
  }

  template<class T, class Mix>
  void optional(const std::optional<T>& value, Mix mix) noexcept {
    boolean(value.has_value());
    if (value) mix(*value);
  }

  [[nodiscard]] std::uint64_t finish() const noexcept { return value_; }

private:
  void byte(std::uint8_t value) noexcept {
    value_ ^= value;
    value_ *= 1099511628211ULL;
  }

  std::uint64_t value_{14695981039346656037ULL};
};

void hash_point(RevisionHasher& hash, const civic::geometry::Point& point) noexcept {
  hash.i64(point.x);
  hash.i64(point.y);
}

void hash_polygon(RevisionHasher& hash, const civic::geometry::Polygon& polygon) noexcept {
  hash.u64(static_cast<std::uint64_t>(polygon.vertices.size()));
  for (const auto& point : polygon.vertices) hash_point(hash, point);
}

void hash_string_vector(RevisionHasher& hash, std::vector<std::string> values) {
  std::sort(values.begin(), values.end());
  hash.u64(static_cast<std::uint64_t>(values.size()));
  for (const auto& value : values) hash.text(value);
}

void hash_id_vector(RevisionHasher& hash, std::vector<ParcelId> values) {
  std::sort(values.begin(), values.end());
  hash.u64(static_cast<std::uint64_t>(values.size()));
  for (const auto value : values) hash.id(value);
}

void hash_use_vector(RevisionHasher& hash, std::vector<civic::urban::UseType> values) {
  std::sort(values.begin(), values.end(), [](auto left, auto right) {
    return static_cast<std::uint8_t>(left) < static_cast<std::uint8_t>(right);
  });
  hash.u64(static_cast<std::uint64_t>(values.size()));
  for (const auto value : values) hash.enumeration(value);
}

std::uint64_t cadastre_revision(
    const std::vector<civic::cadastre::Parcel>& parcels,
    const std::vector<SnapshotParcelLine>& lines) {
  RevisionHasher hash;
  hash.u64(static_cast<std::uint64_t>(parcels.size()));
  for (const auto& parcel : parcels) {
    hash.id(parcel.id);
    hash.text(parcel.external_id);
    hash.text(parcel.block_id);
    hash_polygon(hash, parcel.boundary);
    hash.real(parcel.area_m2);
    hash_point(hash, parcel.centroid);
    hash_string_vector(hash, parcel.boundaries);
    hash_string_vector(hash, parcel.frontage_boundary_ids);
    hash_string_vector(hash, parcel.access_boundary_ids);
    hash.text(parcel.zoning_district_id);
    hash.optional<std::string>(parcel.owner_id, [&hash](const std::string& value) { hash.text(value); });
    hash_id_vector(hash, parcel.historical_parent_ids);
    hash.boolean(parcel.live);
  }

  hash.u64(static_cast<std::uint64_t>(lines.size()));
  for (const auto& line : lines) {
    hash.text(line.id);
    hash_point(hash, line.geometry.a);
    hash_point(hash, line.geometry.b);
    hash.optional<ParcelId>(line.left_parcel_id, [&hash](ParcelId value) { hash.id(value); });
    hash.optional<ParcelId>(line.right_parcel_id, [&hash](ParcelId value) { hash.id(value); });
    hash.text(line.kind);
    hash.optional<std::string>(line.road_ref, [&hash](const std::string& value) { hash.text(value); });
    hash_id_vector(hash, line.frontage_parcel_ids);
  }
  return hash.finish();
}

std::uint64_t zoning_revision(const std::vector<SnapshotZoningEntry>& zoning) {
  RevisionHasher hash;
  hash.u64(static_cast<std::uint64_t>(zoning.size()));
  for (const auto& entry : zoning) {
    hash.text(entry.parcel_external_id);
    hash.id(entry.assignment.parcel_id);
    hash.text(entry.assignment.district_id);
    hash_string_vector(hash, entry.assignment.overlay_ids);

    const auto& controls = entry.controls;
    hash.id(controls.parcel_id);
    hash.text(controls.district_id);
    hash_string_vector(hash, controls.overlay_ids);
    hash.real(controls.max_far);
    hash.real(controls.max_height_meters);
    hash.u64(controls.max_stories);
    hash.real(controls.max_coverage_ratio);
    hash.real(controls.front_setback_meters);
    hash.real(controls.rear_setback_meters);
    hash.real(controls.side_setback_meters);
    hash.real(controls.min_parcel_area_m2);
    hash.real(controls.min_frontage_meters);
    hash.optional<double>(controls.max_residential_units_per_hectare, [&hash](double value) { hash.real(value); });
    hash_use_vector(hash, controls.permitted_uses);
  }
  return hash.finish();
}

std::uint64_t envelope_revision(const std::vector<civic::urban::ParcelDevelopmentEnvelope>& envelopes) {
  RevisionHasher hash;
  hash.u64(static_cast<std::uint64_t>(envelopes.size()));
  for (const auto& envelope : envelopes) {
    hash.id(envelope.parcel_id);
    hash.text(envelope.district_id);
    hash_polygon(hash, envelope.buildable_footprint);
    hash.real(envelope.parcel_area_m2);
    hash.real(envelope.frontage_meters);
    hash.real(envelope.max_footprint_area_m2);
    hash.real(envelope.max_gross_floor_area_m2);
    hash.real(envelope.max_height_meters);
    hash.u64(envelope.max_stories);
    hash.real(envelope.allowed_far);
    hash.real(envelope.effective_far);
    hash.real(envelope.effective_coverage_ratio);
    hash_use_vector(hash, envelope.permitted_uses);
    hash.u64(static_cast<std::uint64_t>(envelope.limiting_constraints.size()));
    for (const auto& constraint : envelope.limiting_constraints) {
      hash.enumeration(constraint.code);
      hash.real(constraint.limit);
      hash.real(constraint.actual);
      hash.text(constraint.source_id);
    }
  }
  return hash.finish();
}

void hash_lifecycle(RevisionHasher& hash, const civic::urban::BuildingLifecycle& lifecycle) noexcept {
  hash.u64(lifecycle.age_ticks);
  hash.real(lifecycle.condition);
  hash.real(lifecycle.structural_condition);
  hash.real(lifecycle.systems_condition);
  hash.real(lifecycle.exterior_condition);
  hash.real(lifecycle.maintenance_backlog);
  hash.u64(lifecycle.deferred_maintenance_ticks);
  hash.optional<std::uint64_t>(lifecycle.last_major_renovation_tick, [&hash](std::uint64_t value) { hash.u64(value); });
  hash.real(lifecycle.effective_age);
  hash.real(lifecycle.vacancy_duration_ticks);
  hash.real(lifecycle.distress_score);
}

void hash_building(RevisionHasher& hash, const civic::urban::BuildingV2& building) {
  hash.id(building.id);
  hash.text(building.external_id);
  hash.id(building.parcel_id);
  hash_id_vector(hash, building.parcel_ids);
  hash.text(building.typology_id);
  hash_polygon(hash, building.footprint);
  hash.real(building.gross_floor_area_m2);
  hash.real(building.usable_floor_area_m2);
  hash.real(building.height_meters);
  hash.u64(building.stories);
  hash.real(building.realized_far);
  hash.real(building.coverage_ratio);
  hash.enumeration(building.status);
  hash.i64(building.year_built);
  hash.optional<std::string>(building.developer_id, [&hash](const std::string& value) { hash.text(value); });
  hash.optional<std::string>(building.owner_id, [&hash](const std::string& value) { hash.text(value); });
  hash.real(building.project_cost);

  hash.u64(building.entitlement.approval_tick);
  hash.text(building.entitlement.zoning_district_id);
  hash.real(building.entitlement.approved_far);
  hash.real(building.entitlement.approved_height_meters);
  hash_use_vector(hash, building.entitlement.approved_uses);
  hash.boolean(building.entitlement.legal_nonconforming);
  hash_lifecycle(hash, building.lifecycle);

  hash.u64(static_cast<std::uint64_t>(building.floors.size()));
  for (const auto& floor : building.floors) {
    hash.u64(floor.level);
    hash.real(floor.elevation_meters);
    hash.real(floor.gross_area_m2);
    hash.real(floor.usable_area_m2);
    hash.u64(static_cast<std::uint64_t>(floor.uses.size()));
    for (const auto& allocation : floor.uses) {
      hash.enumeration(allocation.use);
      hash.real(allocation.floor_area_m2);
      hash.u64(allocation.residential_units);
      hash.u64(allocation.jobs);
      hash.u64(allocation.hotel_rooms);
      hash.real(allocation.storage_capacity);
    }
  }

  hash.boolean(building.project.has_value());
  if (building.project) {
    const auto& project = *building.project;
    hash.enumeration(project.phase);
    hash.optional<std::uint64_t>(project.started_tick, [&hash](std::uint64_t value) { hash.u64(value); });
    hash.optional<std::uint64_t>(project.completion_tick, [&hash](std::uint64_t value) { hash.u64(value); });
    hash.real(project.progress);
    hash.optional<civic::urban::BuildingProjectKind>(project.kind, [&hash](auto value) { hash.enumeration(value); });
    hash.optional<civic::urban::BuildingRenovationScope>(project.renovation_scope, [&hash](auto value) { hash.enumeration(value); });
    hash.optional<double>(project.target_condition, [&hash](double value) { hash.real(value); });
    hash.optional<double>(project.target_structural_condition, [&hash](double value) { hash.real(value); });
    hash.optional<double>(project.target_systems_condition, [&hash](double value) { hash.real(value); });
    hash.optional<double>(project.target_exterior_condition, [&hash](double value) { hash.real(value); });
    hash.optional<double>(project.target_effective_age, [&hash](double value) { hash.real(value); });
    hash.optional<civic::urban::UseType>(project.destination_use, [&hash](auto value) { hash.enumeration(value); });
  }
}

std::uint64_t building_revision(const std::vector<civic::urban::BuildingV2>& buildings) {
  RevisionHasher hash;
  hash.u64(static_cast<std::uint64_t>(buildings.size()));
  for (const auto& building : buildings) hash_building(hash, building);
  return hash.finish();
}

std::uint64_t property_revision(civic::urban::PropertyMarketSnapshot property) {
  RevisionHasher hash;
  std::sort(property.holdings.begin(), property.holdings.end(), [](const auto& left, const auto& right) {
    return left.parcel_id < right.parcel_id;
  });
  hash.u64(static_cast<std::uint64_t>(property.holdings.size()));
  for (const auto& holding : property.holdings) {
    hash.text(holding.parcel_id);
    hash.text(holding.owner_id);
    hash.real(holding.reservation_value);
  }

  hash.u64(static_cast<std::uint64_t>(property.transactions.size()));
  for (const auto& transaction : property.transactions) {
    hash.text(transaction.id);
    hash.u64(transaction.tick);
    hash_string_vector(hash, transaction.parcel_ids);
    hash.text(transaction.buyer_id);
    hash.text(transaction.seller_id);
    hash.enumeration(transaction.purpose);
    hash.real(transaction.price);
    hash.real(transaction.land_value);
    hash.real(transaction.improvement_value);
  }
  hash.u64(property.next_transaction_id);
  return hash.finish();
}

std::uint64_t snapshot_revision(const SnapshotRevisions& revisions) noexcept {
  RevisionHasher hash;
  hash.u64(revisions.world);
  hash.u64(revisions.cadastre);
  hash.u64(revisions.zoning);
  hash.u64(revisions.envelopes);
  hash.u64(revisions.buildings);
  hash.u64(revisions.property);
  return hash.finish();
}

[[nodiscard]] civic::core::Result<void> validate_sources(
    const NativeUrbanFabricSnapshotSources& sources) noexcept {
  if (sources.world == nullptr || sources.cadastre == nullptr || sources.zoning == nullptr ||
      sources.buildable_envelopes == nullptr || sources.urban_fabric == nullptr ||
      sources.property_market == nullptr) {
    return std::unexpected(civic::core::error(
        ErrorCode::invalid_argument,
        "native urban fabric snapshot requires every authoritative source"));
  }
  return sources.urban_fabric->validate();
}

}  // namespace

NativeUrbanFabricSnapshot::NativeUrbanFabricSnapshot(
    civic::world::TerrainField terrain,
    civic::world::GeographyHierarchy geography,
    std::vector<civic::cadastre::Parcel> parcels,
    std::vector<SnapshotParcelLine> parcel_lines,
    std::vector<SnapshotZoningEntry> zoning,
    std::vector<civic::urban::ParcelDevelopmentEnvelope> buildable_envelopes,
    std::vector<civic::urban::BuildingV2> buildings,
    civic::urban::PropertyMarketSnapshot property_state,
    std::vector<SnapshotSelectionEntry> selection_lookup,
    SnapshotRevisions revisions) noexcept
    : terrain_(std::move(terrain)),
      geography_(std::move(geography)),
      parcels_(std::move(parcels)),
      parcel_lines_(std::move(parcel_lines)),
      zoning_(std::move(zoning)),
      buildable_envelopes_(std::move(buildable_envelopes)),
      buildings_(std::move(buildings)),
      property_state_(std::move(property_state)),
      selection_lookup_(std::move(selection_lookup)),
      revisions_(revisions) {}

const SnapshotSelectionEntry* NativeUrbanFabricSnapshot::find_selection(
    SnapshotSelectionKind kind,
    std::string_view external_id) const noexcept {
  const auto iterator = std::find_if(
      selection_lookup_.begin(),
      selection_lookup_.end(),
      [kind, external_id](const SnapshotSelectionEntry& entry) {
        return entry.kind == kind && entry.external_id == external_id;
      });
  return iterator == selection_lookup_.end() ? nullptr : &*iterator;
}

civic::core::Result<NativeUrbanFabricSnapshotPtr> NativeUrbanFabricSnapshotPublisher::publish(
    const NativeUrbanFabricSnapshotSources& sources) const noexcept {
  try {
    if (auto valid = validate_sources(sources); !valid) return std::unexpected(valid.error());

    std::vector<civic::cadastre::Parcel> parcels;
    for (const auto& [_, parcel] : sources.cadastre->parcels()) {
      if (parcel.live) parcels.push_back(parcel);
    }
    std::sort(parcels.begin(), parcels.end(), [](const auto& left, const auto& right) {
      return left.external_id < right.external_id;
    });

    std::vector<SnapshotParcelLine> parcel_lines;
    parcel_lines.reserve(sources.cadastre->boundaries().size());
    for (const auto& [id, boundary] : sources.cadastre->boundaries()) {
      SnapshotParcelLine line{
          .id = id,
          .geometry = boundary.geometry,
          .left_parcel_id = boundary.left_parcel_id,
          .right_parcel_id = boundary.right_parcel_id,
          .kind = boundary.kind,
          .road_ref = boundary.road_ref,
          .frontage_parcel_ids = {},
      };
      for (const auto& parcel : parcels) {
        if (std::find(parcel.frontage_boundary_ids.begin(), parcel.frontage_boundary_ids.end(), id) !=
            parcel.frontage_boundary_ids.end()) {
          line.frontage_parcel_ids.push_back(parcel.id);
        }
      }
      std::sort(line.frontage_parcel_ids.begin(), line.frontage_parcel_ids.end());
      parcel_lines.push_back(std::move(line));
    }

    std::vector<SnapshotZoningEntry> zoning;
    zoning.reserve(parcels.size());
    std::vector<civic::urban::ParcelDevelopmentEnvelope> envelopes;
    envelopes.reserve(parcels.size());
    for (const auto& parcel : parcels) {
      const auto* assignment = sources.zoning->find_assignment(parcel.id);
      if (assignment == nullptr) {
        return std::unexpected(civic::core::error(
            ErrorCode::invariant_failure,
            "snapshot live parcel is missing zoning assignment: " + parcel.external_id));
      }
      auto controls = sources.zoning->effective_controls(parcel.id);
      if (!controls) return std::unexpected(controls.error());
      zoning.push_back(SnapshotZoningEntry{
          .parcel_external_id = parcel.external_id,
          .assignment = *assignment,
          .controls = std::move(*controls),
      });

      const auto envelope = sources.buildable_envelopes->find(parcel.id);
      if (envelope == sources.buildable_envelopes->end() || envelope->second.parcel_id != parcel.id) {
        return std::unexpected(civic::core::error(
            ErrorCode::invariant_failure,
            "snapshot live parcel is missing matching buildable envelope: " + parcel.external_id));
      }
      envelopes.push_back(envelope->second);
    }
    if (envelopes.size() != sources.buildable_envelopes->size()) {
      return std::unexpected(civic::core::error(
          ErrorCode::invariant_failure,
          "snapshot buildable envelopes contain non-live or divergent parcel references"));
    }

    std::vector<civic::urban::BuildingV2> buildings;
    buildings.reserve(sources.urban_fabric->buildings().size());
    for (const auto& [_, building] : sources.urban_fabric->buildings()) buildings.push_back(building);
    std::sort(buildings.begin(), buildings.end(), [](const auto& left, const auto& right) {
      return left.external_id < right.external_id;
    });

    auto property = sources.property_market->snapshot();
    for (const auto& holding : property.holdings) {
      const auto* parcel = sources.cadastre->find_external(holding.parcel_id);
      if (parcel == nullptr || !parcel->live) {
        return std::unexpected(civic::core::error(
            ErrorCode::invariant_failure,
            "snapshot property holding references non-live parcel: " + holding.parcel_id));
      }
    }

    auto geography = sources.world->geography();
    std::sort(geography.entities.begin(), geography.entities.end(), [](const auto& left, const auto& right) {
      if (left.sort_key != right.sort_key) return left.sort_key < right.sort_key;
      return left.id < right.id;
    });

    std::vector<SnapshotSelectionEntry> selection;
    selection.reserve(geography.entities.size() + parcels.size() + buildings.size());
    for (const auto& entity : geography.entities) {
      selection.push_back(SnapshotSelectionEntry{
          .kind = SnapshotSelectionKind::geography,
          .external_id = entity.id,
          .geography_id = entity.id,
      });
    }
    for (const auto& parcel : parcels) {
      selection.push_back(SnapshotSelectionEntry{
          .kind = SnapshotSelectionKind::parcel,
          .external_id = parcel.external_id,
          .parcel_id = parcel.id,
      });
    }
    for (const auto& building : buildings) {
      selection.push_back(SnapshotSelectionEntry{
          .kind = SnapshotSelectionKind::building,
          .external_id = building.external_id,
          .building_id = building.id,
      });
    }
    std::sort(selection.begin(), selection.end(), [](const auto& left, const auto& right) {
      if (left.kind != right.kind) {
        return static_cast<std::uint8_t>(left.kind) < static_cast<std::uint8_t>(right.kind);
      }
      return left.external_id < right.external_id;
    });

    SnapshotRevisions revisions{
        .snapshot = 0,
        .world = sources.world->deterministic_hash(),
        .cadastre = cadastre_revision(parcels, parcel_lines),
        .zoning = zoning_revision(zoning),
        .envelopes = envelope_revision(envelopes),
        .buildings = building_revision(buildings),
        .property = property_revision(property),
    };
    revisions.snapshot = snapshot_revision(revisions);

    NativeUrbanFabricSnapshotPtr published{new NativeUrbanFabricSnapshot(
        sources.world->terrain(),
        std::move(geography),
        std::move(parcels),
        std::move(parcel_lines),
        std::move(zoning),
        std::move(envelopes),
        std::move(buildings),
        std::move(property),
        std::move(selection),
        revisions)};
    return published;
  } catch (const std::exception& exception) {
    return std::unexpected(civic::core::error(ErrorCode::internal_error, exception.what()));
  } catch (...) {
    return std::unexpected(civic::core::error(
        ErrorCode::internal_error,
        "native urban fabric snapshot publication failed"));
  }
}

}  // namespace civic::snapshot
