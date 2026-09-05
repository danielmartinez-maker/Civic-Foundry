#pragma once

#include "civic/cadastre/Cadastre.hpp"
#include "civic/core/Result.hpp"
#include "civic/core/StrongId.hpp"
#include "civic/urban/BuildableEnvelope.hpp"
#include "civic/urban/DevelopmentAuthority.hpp"
#include "civic/urban/UrbanFabric.hpp"
#include "civic/urban/Zoning.hpp"
#include "civic/world/WorldFoundation.hpp"

#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace civic::snapshot {

enum class SnapshotSelectionKind : std::uint8_t {
  geography,
  parcel,
  building,
};

struct SnapshotParcelLine final {
  std::string id{};
  civic::geometry::Segment geometry{};
  std::optional<civic::core::ParcelId> left_parcel_id{};
  std::optional<civic::core::ParcelId> right_parcel_id{};
  std::string kind{};
  std::optional<std::string> road_ref{};
  std::vector<civic::core::ParcelId> frontage_parcel_ids{};
};

struct SnapshotZoningEntry final {
  std::string parcel_external_id{};
  civic::urban::ParcelZoningAssignment assignment{};
  civic::urban::EffectiveZoningControls controls{};
};

struct SnapshotSelectionEntry final {
  SnapshotSelectionKind kind{SnapshotSelectionKind::parcel};
  std::string external_id{};
  std::optional<std::string> geography_id{};
  std::optional<civic::core::ParcelId> parcel_id{};
  std::optional<civic::core::BuildingId> building_id{};
};

struct SnapshotRevisions final {
  std::uint64_t snapshot{};
  std::uint64_t world{};
  std::uint64_t cadastre{};
  std::uint64_t zoning{};
  std::uint64_t envelopes{};
  std::uint64_t buildings{};
  std::uint64_t property{};

  bool operator==(const SnapshotRevisions&) const = default;
};

struct NativeUrbanFabricSnapshotSources final {
  const civic::world::WorldFoundation* world{};
  const civic::cadastre::CadastralGraph* cadastre{};
  const civic::urban::ZoningStore* zoning{};
  const std::map<civic::core::ParcelId, civic::urban::ParcelDevelopmentEnvelope>* buildable_envelopes{};
  const civic::urban::UrbanFabricStore* urban_fabric{};
  const civic::urban::PropertyMarketSystem* property_market{};
};

class NativeUrbanFabricSnapshotPublisher;

class NativeUrbanFabricSnapshot final {
public:
  [[nodiscard]] const civic::world::TerrainField& terrain() const noexcept { return terrain_; }
  [[nodiscard]] const civic::world::GeographyHierarchy& geography() const noexcept { return geography_; }
  [[nodiscard]] const std::vector<civic::cadastre::Parcel>& parcels() const noexcept { return parcels_; }
  [[nodiscard]] const std::vector<SnapshotParcelLine>& parcel_lines() const noexcept { return parcel_lines_; }
  [[nodiscard]] const std::vector<SnapshotZoningEntry>& zoning() const noexcept { return zoning_; }
  [[nodiscard]] const std::vector<civic::urban::ParcelDevelopmentEnvelope>& buildable_envelopes() const noexcept {
    return buildable_envelopes_;
  }
  [[nodiscard]] const std::vector<civic::urban::BuildingV2>& buildings() const noexcept { return buildings_; }
  [[nodiscard]] const civic::urban::PropertyMarketSnapshot& property_state() const noexcept { return property_state_; }
  [[nodiscard]] const std::vector<SnapshotSelectionEntry>& selection_lookup() const noexcept { return selection_lookup_; }
  [[nodiscard]] const SnapshotRevisions& revisions() const noexcept { return revisions_; }

  [[nodiscard]] const SnapshotSelectionEntry* find_selection(
      SnapshotSelectionKind kind,
      std::string_view external_id) const noexcept;

private:
  friend class NativeUrbanFabricSnapshotPublisher;

  NativeUrbanFabricSnapshot(
      civic::world::TerrainField terrain,
      civic::world::GeographyHierarchy geography,
      std::vector<civic::cadastre::Parcel> parcels,
      std::vector<SnapshotParcelLine> parcel_lines,
      std::vector<SnapshotZoningEntry> zoning,
      std::vector<civic::urban::ParcelDevelopmentEnvelope> buildable_envelopes,
      std::vector<civic::urban::BuildingV2> buildings,
      civic::urban::PropertyMarketSnapshot property_state,
      std::vector<SnapshotSelectionEntry> selection_lookup,
      SnapshotRevisions revisions) noexcept;

  civic::world::TerrainField terrain_{};
  civic::world::GeographyHierarchy geography_{};
  std::vector<civic::cadastre::Parcel> parcels_{};
  std::vector<SnapshotParcelLine> parcel_lines_{};
  std::vector<SnapshotZoningEntry> zoning_{};
  std::vector<civic::urban::ParcelDevelopmentEnvelope> buildable_envelopes_{};
  std::vector<civic::urban::BuildingV2> buildings_{};
  civic::urban::PropertyMarketSnapshot property_state_{};
  std::vector<SnapshotSelectionEntry> selection_lookup_{};
  SnapshotRevisions revisions_{};
};

using NativeUrbanFabricSnapshotPtr = std::shared_ptr<const NativeUrbanFabricSnapshot>;

class NativeUrbanFabricSnapshotPublisher final {
public:
  [[nodiscard]] civic::core::Result<NativeUrbanFabricSnapshotPtr> publish(
      const NativeUrbanFabricSnapshotSources& sources) const noexcept;
};

}  // namespace civic::snapshot
