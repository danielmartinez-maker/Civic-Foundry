#include "civic/urban/DevelopmentAuthority.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <set>
#include <utility>

namespace civic::urban {
namespace {
constexpr double kPriceTolerance = 0.01;

bool has_text_history(std::string_view value) noexcept {
  return !value.empty() && std::any_of(value.begin(), value.end(), [](char character) {
    return std::isspace(static_cast<unsigned char>(character)) == 0;
  });
}

bool non_negative_history(double value) noexcept {
  return std::isfinite(value) && value >= 0.0;
}

bool valid_purpose_history(PropertyTransactionPurpose purpose) noexcept {
  switch (purpose) {
    case PropertyTransactionPurpose::sale:
    case PropertyTransactionPurpose::redevelopment:
    case PropertyTransactionPurpose::assembly:
    case PropertyTransactionPurpose::renovation:
      return true;
  }
  return false;
}
}  // namespace

civic::core::Result<void> PropertyMarketSystem::restore_with_cadastre_history(
    const PropertyMarketSnapshot& snapshot) noexcept {
  try {
    if (cadastre_ == nullptr) {
      return std::unexpected(civic::core::error(
          civic::core::ErrorCode::invalid_state,
          "property market has no cadastre"));
    }

    std::map<std::string, PropertyHolding> staged_holdings;
    for (const auto& holding : snapshot.holdings) {
      if (!has_text_history(holding.parcel_id) || !has_text_history(holding.owner_id) ||
          !non_negative_history(holding.reservation_value)) {
        return std::unexpected(civic::core::error(
            civic::core::ErrorCode::invalid_argument,
            "invalid property holding"));
      }
      const auto* parcel = cadastre_->find_external(holding.parcel_id);
      if (parcel == nullptr || !parcel->live) {
        return std::unexpected(civic::core::error(
            civic::core::ErrorCode::not_found,
            "property holding references missing live parcel: " + holding.parcel_id));
      }
      if (!staged_holdings.emplace(holding.parcel_id, holding).second) {
        return std::unexpected(civic::core::error(
            civic::core::ErrorCode::conflict,
            "duplicate property holding: " + holding.parcel_id));
      }
    }

    std::vector<PropertyTransaction> staged_transactions;
    staged_transactions.reserve(snapshot.transactions.size());
    for (std::size_t index = 0; index < snapshot.transactions.size(); ++index) {
      auto transaction = snapshot.transactions[index];
      const auto expected_id = "property:tx:" + std::to_string(index + 1U);
      if (transaction.id != expected_id || !has_text_history(transaction.buyer_id) ||
          !has_text_history(transaction.seller_id) || transaction.buyer_id == transaction.seller_id ||
          !valid_purpose_history(transaction.purpose) || !non_negative_history(transaction.price) ||
          !non_negative_history(transaction.land_value) ||
          !non_negative_history(transaction.improvement_value) ||
          std::abs(transaction.price - (transaction.land_value + transaction.improvement_value)) >
              kPriceTolerance ||
          transaction.parcel_ids.empty()) {
        return std::unexpected(civic::core::error(
            civic::core::ErrorCode::invalid_argument,
            "invalid property transaction history"));
      }

      std::set<std::string> seen;
      for (const auto& parcel_id : transaction.parcel_ids) {
        if (!has_text_history(parcel_id) || !seen.insert(parcel_id).second) {
          return std::unexpected(civic::core::error(
              civic::core::ErrorCode::invalid_argument,
              "property transaction parcel ids must be unique and non-empty"));
        }
        if (staged_holdings.contains(parcel_id)) continue;
        const auto* historical = cadastre_->find_external(parcel_id);
        if (historical == nullptr || historical->live) {
          return std::unexpected(civic::core::error(
              civic::core::ErrorCode::not_found,
              "property transaction references unknown parcel history: " + parcel_id));
        }
      }
      std::sort(transaction.parcel_ids.begin(), transaction.parcel_ids.end());
      staged_transactions.push_back(std::move(transaction));
    }

    if (snapshot.next_transaction_id != staged_transactions.size() + 1U) {
      return std::unexpected(civic::core::error(
          civic::core::ErrorCode::invariant_failure,
          "property market next transaction id must follow transaction history"));
    }

    holdings_.swap(staged_holdings);
    transactions_.swap(staged_transactions);
    next_transaction_id_ = snapshot.next_transaction_id;
    return {};
  } catch (const std::exception& error) {
    return std::unexpected(civic::core::error(
        civic::core::ErrorCode::internal_error,
        error.what()));
  }
}

}  // namespace civic::urban
