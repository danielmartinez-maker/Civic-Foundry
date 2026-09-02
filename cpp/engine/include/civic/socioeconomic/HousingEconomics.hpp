#pragma once

#include <cstdint>
#include <span>
#include <vector>

#include <civic/core/Error.hpp>
#include <civic/core/StrongId.hpp>
#include <civic/socioeconomic/SocioeconomicRuntime.hpp>

namespace civic::socioeconomic {

enum class HousingIncomeBand : std::uint32_t { lower, middle, upper };
enum class HousingTenure : std::uint32_t { renter, owner };
enum class HousingIntensity : std::uint32_t { low, medium, high };

struct HousingBandProfile final {
    double share{};
    double monthly_income{};
    double max_housing_burden{};
};

struct HousingQualityInputs final {
    double person_accessibility{};
    double service_quality{};
    double neighborhood_quality{};
    double utility_ratio{};
};

[[nodiscard]] HousingBandProfile housing_band_profile(HousingIncomeBand band) noexcept;
[[nodiscard]] Result<double> housing_burden(double monthly_cost, HousingIncomeBand band);
[[nodiscard]] Result<double> housing_affordability_score(double monthly_cost, HousingIncomeBand band);
[[nodiscard]] Result<double> housing_quality_score(const HousingQualityInputs& inputs);
[[nodiscard]] double housing_tenure_preference_score(HousingIncomeBand band, HousingTenure preferred, HousingTenure option) noexcept;
[[nodiscard]] Result<double> housing_candidate_score(
    double monthly_cost,
    HousingIncomeBand band,
    HousingTenure preferred,
    HousingTenure option,
    const HousingQualityInputs& quality);

struct HousingTenureBuildingInput final {
    BuildingId building{0};
    HousingIntensity intensity{HousingIntensity::low};
    double capacity{};
    double asking_rent{};
    double person_accessibility{};
    double service_quality{};
    double neighborhood_quality{};
    double utility_ratio{};
};

struct BuildingTenureEconomics final {
    BuildingId building{0};
    double total_capacity{};
    double rental_capacity{};
    double ownership_capacity{};
    double asking_rent{};
    double implied_purchase_price{};
    double monthly_owner_cost{};
};

struct HousingTenureOption final {
    BuildingId building{0};
    HousingTenure tenure{HousingTenure::renter};
    double capacity{};
    double monthly_cost{};
    double monthly_rent{};
    double implied_purchase_price{};
    double person_accessibility{};
    double service_quality{};
    double neighborhood_quality{};
    double utility_ratio{};
};

struct HousingTenureSnapshot final {
    double market_interest_rate{};
    std::vector<BuildingTenureEconomics> buildings;
    std::vector<HousingTenureOption> options;
};

class HousingTenureSystem final {
public:
    [[nodiscard]] Result<HousingTenureSnapshot> evaluate(
        double market_interest_rate,
        std::span<const HousingTenureBuildingInput> inputs);
    [[nodiscard]] const HousingTenureSnapshot& snapshot() const noexcept { return latest_; }
private:
    HousingTenureSnapshot latest_;
};

class HousingRelocationService final {
public:
    [[nodiscard]] Result<void> redevelopment_relocate(
        HousingMarket& market,
        HouseholdId household,
        double member_weight,
        HousingUnitId destination) const;
};

} // namespace civic::socioeconomic
