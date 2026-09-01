#pragma once
#include "civic/core/Result.hpp"
#include "civic/core/StrongId.hpp"
#include "civic/geometry/Geometry.hpp"
#include <algorithm>
#include <cstdint>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <vector>

namespace civic::cadastre {
struct Parcel final { civic::core::ParcelId id{};std::string external_id{};std::string block_id{};civic::geometry::Polygon boundary{};double area_m2{};civic::geometry::Point centroid{};std::string zoning_district_id{};std::optional<std::string> owner_id{};std::vector<civic::core::ParcelId> historical_parent_ids{};bool live{true}; };
struct Easement final { std::string id;std::vector<civic::core::ParcelId> parcel_ids;std::string kind;std::vector<civic::geometry::Point> geometry; };
struct LineageEvent final { std::string id;std::uint64_t tick{};std::string kind;std::vector<civic::core::ParcelId> source_parcel_ids;std::vector<civic::core::ParcelId> resulting_parcel_ids; };
class CadastralGraph final {
public:
  [[nodiscard]] std::uint64_t revision() const noexcept{return revision_;}
  [[nodiscard]] const std::map<civic::core::ParcelId,Parcel>& parcels() const noexcept{return parcels_;}
  [[nodiscard]] civic::core::Result<void> insert(Parcel parcel) noexcept;
  [[nodiscard]] bool contains_live(civic::core::ParcelId id) const noexcept { auto it=parcels_.find(id);return it!=parcels_.end()&&it->second.live; }
  [[nodiscard]] civic::core::Result<void> validate() const noexcept;
private:
  friend class CadastreTransaction;
  std::map<civic::core::ParcelId,Parcel> parcels_{};std::map<std::string,Easement> easements_{};std::vector<LineageEvent> lineage_{};std::uint64_t revision_{};
};
class CadastreTransaction final {
public:
  explicit CadastreTransaction(CadastralGraph& target):target_(target),staged_(target){}
  ~CadastreTransaction()=default;
  CadastreTransaction(const CadastreTransaction&)=delete;CadastreTransaction& operator=(const CadastreTransaction&)=delete;
  [[nodiscard]] CadastralGraph& staged() noexcept{return staged_;}
  void stage_revision_for_test() noexcept{++staged_.revision_;}
  [[nodiscard]] civic::core::Result<void> commit() noexcept;
private:CadastralGraph& target_;CadastralGraph staged_;bool committed_{};
};
[[nodiscard]] std::uint64_t stable_id_from_key(std::string_view key) noexcept;
}
