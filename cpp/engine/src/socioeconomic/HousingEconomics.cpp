#include <civic/socioeconomic/HousingEconomics.hpp>

#include <algorithm>
#include <cmath>
#include <set>
#include <vector>

namespace civic::socioeconomic {
namespace {

constexpr double kLoanToValue = 0.80;
constexpr double kMortgageTermMonths = 360.0;
constexpr double kAnnualCarryingCostRate = 0.015;

[[nodiscard]] constexpr double clamp01(double value) noexcept {
    return std::clamp(value, 0.0, 1.0);
}

[[nodiscard]] Result<void> require_finite_non_negative(double value, const char* name) {
    if (!std::isfinite(value) || value < 0.0) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, std::string{name} + " must be finite and non-negative"));
    }
    return {};
}

[[nodiscard]] Result<void> require_finite(double value, const char* name) {
    if (!std::isfinite(value)) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, std::string{name} + " must be finite"));
    }
    return {};
}

[[nodiscard]] constexpr double owner_share(HousingIntensity intensity) noexcept {
    switch (intensity) {
        case HousingIntensity::low: return 0.60;
        case HousingIntensity::medium: return 0.40;
        case HousingIntensity::high: return 0.25;
    }
    return 0.0;
}

struct OwnerEconomics final {
    double implied_purchase_price{};
    double monthly_owner_cost{};
};

[[nodiscard]] OwnerEconomics owner_economics(double asking_rent, double market_interest_rate) noexcept {
    const double annual_market_rent = asking_rent * 12.0;
    const double capitalization_rate = std::clamp(0.045 + 0.40 * market_interest_rate, 0.05, 0.09);
    const double implied_purchase_price = annual_market_rent / capitalization_rate;
    const double principal = implied_purchase_price * kLoanToValue;
    const double monthly_rate = market_interest_rate / 12.0;

    double mortgage_payment{};
    if (monthly_rate == 0.0) {
        mortgage_payment = principal / kMortgageTermMonths;
    } else {
        const double compound = std::pow(1.0 + monthly_rate, kMortgageTermMonths);
        mortgage_payment = principal * monthly_rate * compound / (compound - 1.0);
    }

    const double monthly_carrying_cost = implied_purchase_price * kAnnualCarryingCostRate / 12.0;
    return {implied_purchase_price, mortgage_payment + monthly_carrying_cost};
}

} // namespace

HousingBandProfile housing_band_profile(HousingIncomeBand band) noexcept {
    switch (band) {
        case HousingIncomeBand::lower: return {0.45, 1500.0, 0.35};
        case HousingIncomeBand::middle: return {0.40, 2600.0, 0.32};
        case HousingIncomeBand::upper: return {0.15, 4500.0, 0.28};
    }
    return {};
}

Result<double> housing_burden(double monthly_cost, HousingIncomeBand band) {
    if (auto valid = require_finite_non_negative(monthly_cost, "monthly cost"); !valid) {
        return std::unexpected(valid.error());
    }
    return monthly_cost / housing_band_profile(band).monthly_income;
}

Result<double> housing_affordability_score(double monthly_cost, HousingIncomeBand band) {
    auto burden = housing_burden(monthly_cost, band);
    if (!burden) return std::unexpected(burden.error());
    const auto profile = housing_band_profile(band);
    return clamp01((2.0 * profile.max_housing_burden - *burden) / profile.max_housing_burden);
}

Result<double> housing_quality_score(const HousingQualityInputs& inputs) {
    if (auto valid = require_finite(inputs.person_accessibility, "person accessibility"); !valid) return std::unexpected(valid.error());
    if (auto valid = require_finite(inputs.service_quality, "service quality"); !valid) return std::unexpected(valid.error());
    if (auto valid = require_finite(inputs.neighborhood_quality, "neighborhood quality"); !valid) return std::unexpected(valid.error());
    if (auto valid = require_finite(inputs.utility_ratio, "utility ratio"); !valid) return std::unexpected(valid.error());

    return clamp01(
        0.30 * clamp01(inputs.neighborhood_quality)
        + 0.25 * clamp01(inputs.service_quality)
        + 0.25 * clamp01(inputs.person_accessibility)
        + 0.20 * clamp01(inputs.utility_ratio));
}

double housing_tenure_preference_score(HousingIncomeBand band, HousingTenure preferred, HousingTenure option) noexcept {
    if (preferred == option) return 1.0;
    switch (band) {
        case HousingIncomeBand::lower: return option == HousingTenure::renter ? 0.80 : 0.20;
        case HousingIncomeBand::middle: return 0.50;
        case HousingIncomeBand::upper: return option == HousingTenure::renter ? 0.30 : 0.70;
    }
    return 0.0;
}

Result<double> housing_candidate_score(
    double monthly_cost,
    HousingIncomeBand band,
    HousingTenure preferred,
    HousingTenure option,
    const HousingQualityInputs& quality) {
    auto affordability = housing_affordability_score(monthly_cost, band);
    if (!affordability) return std::unexpected(affordability.error());
    auto quality_score = housing_quality_score(quality);
    if (!quality_score) return std::unexpected(quality_score.error());
    return clamp01(
        0.55 * *affordability
        + 0.30 * *quality_score
        + 0.15 * housing_tenure_preference_score(band, preferred, option));
}

Result<HousingTenureSnapshot> HousingTenureSystem::evaluate(
    double market_interest_rate,
    std::span<const HousingTenureBuildingInput> inputs) {
    if (auto valid = require_finite_non_negative(market_interest_rate, "market interest rate"); !valid) {
        return std::unexpected(valid.error());
    }

    std::vector<HousingTenureBuildingInput> sorted(inputs.begin(), inputs.end());
    std::ranges::sort(sorted, {}, &HousingTenureBuildingInput::building);
    std::set<BuildingId> seen;
    HousingTenureSnapshot next{};
    next.market_interest_rate = market_interest_rate;
    next.buildings.reserve(sorted.size());
    next.options.reserve(sorted.size() * 2U);

    for (const auto& input : sorted) {
        if (input.building.value() == 0 || !seen.insert(input.building).second) {
            return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid or duplicate housing building"));
        }
        if (auto valid = require_finite_non_negative(input.capacity, "housing capacity"); !valid) return std::unexpected(valid.error());
        if (auto valid = require_finite_non_negative(input.asking_rent, "asking rent"); !valid) return std::unexpected(valid.error());
        if (auto valid = require_finite(input.person_accessibility, "person accessibility"); !valid) return std::unexpected(valid.error());
        if (auto valid = require_finite(input.service_quality, "service quality"); !valid) return std::unexpected(valid.error());
        if (auto valid = require_finite(input.neighborhood_quality, "neighborhood quality"); !valid) return std::unexpected(valid.error());
        if (auto valid = require_finite(input.utility_ratio, "utility ratio"); !valid) return std::unexpected(valid.error());

        const double ownership_capacity = input.capacity * owner_share(input.intensity);
        const double rental_capacity = input.capacity - ownership_capacity;
        const auto economics = owner_economics(input.asking_rent, market_interest_rate);

        next.buildings.push_back({
            input.building,
            input.capacity,
            rental_capacity,
            ownership_capacity,
            input.asking_rent,
            economics.implied_purchase_price,
            economics.monthly_owner_cost,
        });

        next.options.push_back({
            input.building,
            HousingTenure::renter,
            rental_capacity,
            input.asking_rent,
            input.asking_rent,
            0.0,
            input.person_accessibility,
            input.service_quality,
            input.neighborhood_quality,
            input.utility_ratio,
        });
        next.options.push_back({
            input.building,
            HousingTenure::owner,
            ownership_capacity,
            economics.monthly_owner_cost,
            0.0,
            economics.implied_purchase_price,
            input.person_accessibility,
            input.service_quality,
            input.neighborhood_quality,
            input.utility_ratio,
        });
    }

    latest_ = std::move(next);
    return latest_;
}

Result<void> HousingRelocationService::redevelopment_relocate(
    HousingMarket& market,
    HouseholdId household,
    double member_weight,
    HousingUnitId destination) const {
    return market.relocate(household, member_weight, destination);
}

} // namespace civic::socioeconomic
