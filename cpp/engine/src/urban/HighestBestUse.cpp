#include "civic/urban/DevelopmentAuthority.hpp"

#include <algorithm>
#include <cmath>
#include <set>
#include <string>
#include <utility>

namespace civic::urban {
namespace {

using civic::core::ErrorCode;
using civic::core::ParcelId;

[[nodiscard]] civic::core::Result<void> require_non_negative(std::string_view name, double value) {
  if (!std::isfinite(value) || value < 0.0) {
    return std::unexpected(civic::core::error(
        ErrorCode::invalid_argument,
        std::string{name} + " must be finite and non-negative"));
  }
  return {};
}

[[nodiscard]] civic::core::Result<void> require_range(
    std::string_view name,
    double value,
    double minimum,
    double maximum) {
  if (!std::isfinite(value) || value < minimum || value > maximum) {
    return std::unexpected(civic::core::error(
        ErrorCode::invalid_argument,
        std::string{name} + " must be within accepted range"));
  }
  return {};
}

[[nodiscard]] civic::core::Result<void> validate_alternative(
    std::string_view label,
    double net_value,
    double expected_return,
    double risk_score) {
  if (auto result = require_non_negative(std::string{label} + " net value", net_value); !result) return result;
  if (auto result = require_range(std::string{label} + " expected return", expected_return, 0.0, 1.0); !result) return result;
  return require_range(std::string{label} + " risk score", risk_score, 0.0, 1.0);
}

[[nodiscard]] HighestBestUseAlternative hold_alternative(double hold_value) {
  return HighestBestUseAlternative{
      .strategy = HighestBestUseStrategy::hold,
      .net_value = hold_value,
      .expected_return = 0.0,
      .risk_score = 0.0,
      .risk_adjusted_return = 0.0,
      .eligible = hold_value > 0.0,
  };
}

[[nodiscard]] HighestBestUseAlternative alternative(
    HighestBestUseStrategy strategy,
    double net_value,
    double expected_return,
    double risk_score,
    double hurdle_rate) {
  const double risk_adjusted_return = expected_return * (1.0 - risk_score);
  return HighestBestUseAlternative{
      .strategy = strategy,
      .net_value = net_value,
      .expected_return = expected_return,
      .risk_score = risk_score,
      .risk_adjusted_return = risk_adjusted_return,
      .eligible = net_value > 0.0 && risk_adjusted_return >= hurdle_rate,
  };
}

}  // namespace

civic::core::Result<HighestBestUseResult> HighestBestUseSystem::evaluate(
    const HighestBestUseInput& input) const noexcept {
  try {
    if (input.parcel_ids.empty()) {
      return std::unexpected(civic::core::error(
          ErrorCode::invalid_argument,
          "highest-and-best-use requires at least one parcel"));
    }

    std::set<ParcelId> unique_parcels;
    for (const auto parcel_id : input.parcel_ids) {
      if (parcel_id.value() == 0 || !unique_parcels.insert(parcel_id).second) {
        return std::unexpected(civic::core::error(
            ErrorCode::invalid_argument,
            "highest-and-best-use parcel ids must be unique and non-zero"));
      }
    }

    if (auto result = require_non_negative("hold value", input.hold_value); !result) return std::unexpected(result.error());
    if (auto result = require_range("building condition", input.building_condition, 0.0, 100.0); !result) return std::unexpected(result.error());
    if (auto result = require_range("developer hurdle rate", input.developer_hurdle_rate, 0.0, 1.0); !result) return std::unexpected(result.error());
    if (auto result = validate_alternative("renovation", input.renovation_net_value, input.renovation_expected_return, input.renovation_risk_score); !result) {
      return std::unexpected(result.error());
    }
    if (auto result = validate_alternative("conversion", input.conversion_net_value, input.conversion_expected_return, input.conversion_risk_score); !result) {
      return std::unexpected(result.error());
    }
    if (auto result = validate_alternative("redevelopment", input.redevelopment_net_value, input.redevelopment_expected_return, input.redevelopment_risk_score); !result) {
      return std::unexpected(result.error());
    }

    if (input.assembly_net_value) {
      const double expected_return = input.assembly_expected_return.value_or(0.0);
      const double risk_score = input.assembly_risk_score.value_or(0.0);
      if (auto result = validate_alternative("assembly", *input.assembly_net_value, expected_return, risk_score); !result) {
        return std::unexpected(result.error());
      }
    } else if (input.assembly_expected_return || input.assembly_risk_score) {
      return std::unexpected(civic::core::error(
          ErrorCode::invalid_argument,
          "assembly return or risk requires assembly net value"));
    }

    std::vector<HighestBestUseAlternative> alternatives;
    alternatives.reserve(input.assembly_net_value ? 5U : 4U);
    alternatives.push_back(hold_alternative(input.hold_value));
    alternatives.push_back(alternative(
        HighestBestUseStrategy::renovate,
        input.renovation_net_value,
        input.renovation_expected_return,
        input.renovation_risk_score,
        input.developer_hurdle_rate));
    alternatives.push_back(alternative(
        HighestBestUseStrategy::convert,
        input.conversion_net_value,
        input.conversion_expected_return,
        input.conversion_risk_score,
        input.developer_hurdle_rate));
    alternatives.push_back(alternative(
        HighestBestUseStrategy::redevelop,
        input.redevelopment_net_value,
        input.redevelopment_expected_return,
        input.redevelopment_risk_score,
        input.developer_hurdle_rate));
    if (input.assembly_net_value) {
      alternatives.push_back(alternative(
          HighestBestUseStrategy::assemble,
          *input.assembly_net_value,
          input.assembly_expected_return.value_or(0.0),
          input.assembly_risk_score.value_or(0.0),
          input.developer_hurdle_rate));
    }

    const HighestBestUseAlternative* best = nullptr;
    for (const auto& item : alternatives) {
      if (!item.eligible) continue;
      if (best == nullptr || item.net_value > best->net_value) best = &item;
    }

    auto parcel_ids = input.parcel_ids;
    std::sort(parcel_ids.begin(), parcel_ids.end());
    return HighestBestUseResult{
        .parcel_ids = std::move(parcel_ids),
        .building_condition = input.building_condition,
        .best_strategy = best == nullptr ? HighestBestUseStrategy::none : best->strategy,
        .best_value = best == nullptr ? 0.0 : best->net_value,
        .hold_value = input.hold_value,
        .redevelopment_premium = input.redevelopment_net_value - input.hold_value,
        .alternatives = std::move(alternatives),
    };
  } catch (const std::exception& exception) {
    return std::unexpected(civic::core::error(ErrorCode::internal_error, exception.what()));
  }
}

}  // namespace civic::urban
