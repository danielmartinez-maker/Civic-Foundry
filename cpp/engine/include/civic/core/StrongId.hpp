#pragma once
#include <compare>
#include <cstdint>
#include <functional>
#include <string>
#include <type_traits>
#include <utility>

namespace civic::core {
template<class Tag, class Storage = std::uint64_t>
class StrongId final {
public:
  using storage_type = Storage;
  constexpr StrongId() = default;
  constexpr explicit StrongId(Storage value) noexcept : value_(std::move(value)) {}
  [[nodiscard]] constexpr const Storage& value() const noexcept { return value_; }
  auto operator<=>(const StrongId&) const = default;
private:
  Storage value_{};
};
struct EntityTag; struct ParcelTag; struct BuildingTag; struct FirmTag; struct HouseholdTag; struct VehicleTag; struct NetworkNodeTag; struct NetworkEdgeTag;
using EntityId = StrongId<EntityTag>;
using ParcelId = StrongId<ParcelTag>;
using BuildingId = StrongId<BuildingTag>;
using FirmId = StrongId<FirmTag>;
using HouseholdId = StrongId<HouseholdTag>;
using VehicleId = StrongId<VehicleTag>;
using NetworkNodeId = StrongId<NetworkNodeTag>;
using NetworkEdgeId = StrongId<NetworkEdgeTag>;
using MoneyMinor = std::int64_t;
using LegalCoordinateCm = std::int64_t;
}
namespace std {
template<class Tag, class Storage> struct hash<civic::core::StrongId<Tag,Storage>> {
  size_t operator()(const civic::core::StrongId<Tag,Storage>& id) const noexcept { return hash<Storage>{}(id.value()); }
};
}
