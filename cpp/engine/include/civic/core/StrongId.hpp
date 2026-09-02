#pragma once

#include <cmath>
#include <compare>
#include <cstdint>
#include <type_traits>

#include <civic/core/Error.hpp>

namespace civic {

template<class Tag, class Storage = std::uint64_t>
class StrongId final {
    static_assert(std::is_integral_v<Storage> && std::is_unsigned_v<Storage>);
public:
    constexpr StrongId() noexcept = default;
    constexpr explicit StrongId(Storage value) noexcept : value_(value) {}
    [[nodiscard]] constexpr Storage value() const noexcept { return value_; }
    auto operator<=>(const StrongId&) const = default;
private:
    Storage value_{};
};

struct EntityTag;
struct ParcelTag;
struct BuildingTag;
struct FirmTag;
struct HouseholdTag;
struct VehicleTag;
struct NetworkNodeTag;
struct NetworkEdgeTag;

using EntityId = StrongId<EntityTag>;
using ParcelId = StrongId<ParcelTag>;
using BuildingId = StrongId<BuildingTag>;
using FirmId = StrongId<FirmTag>;
using HouseholdId = StrongId<HouseholdTag>;
using VehicleId = StrongId<VehicleTag>;
using NetworkNodeId = StrongId<NetworkNodeTag>;
using NetworkEdgeId = StrongId<NetworkEdgeTag>;

class Money final {
public:
    constexpr explicit Money(std::int64_t minor_units = 0) noexcept : minor_units_(minor_units) {}
    [[nodiscard]] constexpr std::int64_t minor_units() const noexcept { return minor_units_; }
    auto operator<=>(const Money&) const = default;
private:
    std::int64_t minor_units_{};
};

class WeightedCount final {
public:
    [[nodiscard]] static Result<WeightedCount> create(double value) {
        if (!std::isfinite(value) || value < 0.0) {
            return std::unexpected(make_error(ErrorCode::invalid_argument, "weighted count must be finite and non-negative"));
        }
        return WeightedCount(value);
    }
    [[nodiscard]] double value() const noexcept { return value_; }
    auto operator<=>(const WeightedCount&) const = default;
private:
    explicit WeightedCount(double value) noexcept : value_(value) {}
    double value_{};
};

using GeometryCentimeter = std::int64_t;

} // namespace civic
