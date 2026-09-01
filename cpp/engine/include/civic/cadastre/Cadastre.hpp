#pragma once
#include "civic/core/Result.hpp"
#include "civic/core/StrongId.hpp"
#include "civic/geometry/BooleanOps.hpp"
#include <cstdint>
#include <map>
#include <optional>
#include <set>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace civic::cadastre {

struct ParcelBoundary final {
  std::string id{};
  civic::geometry::Segment geometry{};
  std::optional<civic::core::ParcelId> left_parcel_id{};
  std::optional<civic::core::ParcelId> right_parcel_id{};
  std::string kind{"property-boundary"};
  std::optional<std::string> road_ref{};
};

struct Parcel final {
  civic::core::ParcelId id{};
  std::string external_id{};
  std::string block_id{};
  civic::geometry::Polygon boundary{};
  double area_m2{};
  civic::geometry::Point centroid{};
  std::vector<std::string> boundaries{};
  std::vector<std::string> frontage_boundary_ids{};
  std::vector<std::string> access_boundary_ids{};
  std::string zoning_district_id{};
  std::optional<std::string> owner_id{};
  std::vector<civic::core::ParcelId> historical_parent_ids{};
  bool live{true};
};

struct Easement final {
  std::string id{};
  std::vector<civic::core::ParcelId> parcel_ids{};
  std::string kind{};
  std::vector<civic::geometry::Point> geometry{};
};

struct LineageEvent final {
  std::string id{};
  std::uint64_t tick{};
  std::string kind{};
  std::vector<civic::core::ParcelId> source_parcel_ids{};
  std::vector<civic::core::ParcelId> resulting_parcel_ids{};
};

struct LegacyLotProjectionEntry final {
  civic::core::ParcelId parcel_id{};
  std::string parcel_external_id{};
  std::int32_t x{};
  std::int32_t y{};
  bool faithful{};
};

struct LegacyLotProjection final {
  std::vector<LegacyLotProjectionEntry> lots{};
  std::vector<std::string> diagnostics{};
};

[[nodiscard]] std::uint64_t stable_id_from_key(std::string_view key) noexcept;
[[nodiscard]] civic::core::ParcelId parcel_id_from_external(std::string_view external_id) noexcept;
[[nodiscard]] std::vector<civic::core::ParcelId> canonical_ids(std::vector<civic::core::ParcelId> ids);

class CadastralGraph final {
public:
  [[nodiscard]] std::uint64_t revision() const noexcept { return revision_; }
  [[nodiscard]] const std::map<civic::core::ParcelId, Parcel>& parcels() const noexcept { return parcels_; }
  [[nodiscard]] const std::map<std::string, ParcelBoundary>& boundaries() const noexcept { return boundaries_; }
  [[nodiscard]] const std::map<std::string, Easement>& easements() const noexcept { return easements_; }
  [[nodiscard]] const std::vector<LineageEvent>& lineage() const noexcept { return lineage_; }

  [[nodiscard]] const Parcel* find(civic::core::ParcelId id) const noexcept;
  [[nodiscard]] Parcel* find(civic::core::ParcelId id) noexcept;
  [[nodiscard]] const Parcel* find_external(std::string_view external_id) const noexcept;
  [[nodiscard]] const ParcelBoundary* find_boundary(std::string_view id) const noexcept;
  [[nodiscard]] std::vector<const Parcel*> live_parcels() const;
  [[nodiscard]] bool contains_live(civic::core::ParcelId id) const noexcept {
    const auto* parcel = find(id);
    return parcel != nullptr && parcel->live;
  }

  [[nodiscard]] civic::core::Result<void> insert(Parcel parcel) noexcept;
  [[nodiscard]] civic::core::Result<void> retire(civic::core::ParcelId id) noexcept;
  [[nodiscard]] civic::core::Result<void> add_easement(Easement easement) noexcept;
  [[nodiscard]] civic::core::Result<void> remove_easement(std::string_view id) noexcept;
  [[nodiscard]] civic::core::Result<void> append_lineage(LineageEvent event) noexcept;
  [[nodiscard]] civic::core::Result<void> set_boundary_semantics(
      std::string_view boundary_id,
      std::string kind,
      std::optional<std::string> road_ref,
      bool frontage,
      bool access) noexcept;

  [[nodiscard]] civic::core::Result<void> validate() const noexcept;
  [[nodiscard]] LegacyLotProjection legacy_lot_projection() const;

private:
  friend class CadastreTransaction;
  [[nodiscard]] civic::core::Result<void> rebuild_topology() noexcept;

  std::map<civic::core::ParcelId, Parcel> parcels_{};
  std::map<std::string, ParcelBoundary> boundaries_{};
  std::map<std::string, Easement> easements_{};
  std::vector<LineageEvent> lineage_{};
  std::uint64_t revision_{};
};

class CadastreTransaction final {
public:
  explicit CadastreTransaction(CadastralGraph& target) : target_(target), staged_(target) {}
  ~CadastreTransaction() = default;
  CadastreTransaction(const CadastreTransaction&) = delete;
  CadastreTransaction& operator=(const CadastreTransaction&) = delete;

  [[nodiscard]] CadastralGraph& staged() noexcept { return staged_; }
  void stage_revision_for_test() noexcept { ++staged_.revision_; }
  [[nodiscard]] civic::core::Result<void> commit() noexcept;

private:
  CadastralGraph& target_;
  CadastralGraph staged_;
};

}  // namespace civic::cadastre
