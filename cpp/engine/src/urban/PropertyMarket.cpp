#include "civic/urban/DevelopmentAuthority.hpp"

#include <algorithm>
#include <cmath>
#include <cctype>
#include <set>
#include <string>
#include <utility>

namespace civic::urban {
namespace {

using civic::core::ErrorCode;
constexpr double kPriceTolerance = 0.01;

[[nodiscard]] bool has_text(std::string_view value) noexcept {
  if (value.empty()) return false;
  return std::any_of(value.begin(), value.end(), [](char character) {
    return std::isspace(static_cast<unsigned char>(character)) == 0;
  });
}

[[nodiscard]] civic::core::Result<void> require_non_negative(std::string_view name, double value) {
  if (!std::isfinite(value) || value < 0.0) {
    return std::unexpected(civic::core::error(
        ErrorCode::invalid_argument,
        std::string{name} + " must be finite and non-negative"));
  }
  return {};
}

[[nodiscard]] bool valid_purpose(PropertyTransactionPurpose purpose) noexcept {
  switch (purpose) {
    case PropertyTransactionPurpose::sale:
    case PropertyTransactionPurpose::redevelopment:
    case PropertyTransactionPurpose::assembly:
    case PropertyTransactionPurpose::renovation:
      return true;
  }
  return false;
}

[[nodiscard]] civic::core::Result<void> validate_transaction_values(
    std::string_view buyer_id,
    std::string_view seller_id,
    PropertyTransactionPurpose purpose,
    double price,
    double land_value,
    double improvement_value) {
  if (!has_text(buyer_id) || !has_text(seller_id)) {
    return std::unexpected(civic::core::error(
        ErrorCode::invalid_argument,
        "buyer and seller ids must be non-empty"));
  }
  if (buyer_id == seller_id) {
    return std::unexpected(civic::core::error(
        ErrorCode::invalid_argument,
        "buyer and seller must be different"));
  }
  if (!valid_purpose(purpose)) {
    return std::unexpected(civic::core::error(
        ErrorCode::invalid_argument,
        "invalid property transaction purpose"));
  }
  if (auto result = require_non_negative("price", price); !result) return result;
  if (auto result = require_non_negative("land value", land_value); !result) return result;
  if (auto result = require_non_negative("improvement value", improvement_value); !result) return result;
  if (std::abs(price - (land_value + improvement_value)) > kPriceTolerance) {
    return std::unexpected(civic::core::error(
        ErrorCode::invalid_argument,
        "transaction price must equal land value plus improvement value"));
  }
  return {};
}

}  // namespace

std::optional<std::string> PropertyMarketSystem::owner_of(std::string_view parcel_id) const {
  if (!has_text(parcel_id)) return std::nullopt;
  const auto it = holdings_.find(std::string{parcel_id});
  if (it == holdings_.end()) return std::nullopt;
  return it->second.owner_id;
}

std::optional<double> PropertyMarketSystem::reservation_value(std::string_view parcel_id) const {
  if (!has_text(parcel_id)) return std::nullopt;
  const auto it = holdings_.find(std::string{parcel_id});
  if (it == holdings_.end()) return std::nullopt;
  return it->second.reservation_value;
}

civic::core::Result<PropertyTransaction> PropertyMarketSystem::transact(
    const PropertyTransactionInput& input) noexcept {
  try {
    if (cadastre_ == nullptr) {
      return std::unexpected(civic::core::error(
          ErrorCode::invalid_state,
          "property market has no cadastre"));
    }
    if (auto result = validate_transaction_values(
            input.buyer_id,
            input.seller_id,
            input.purpose,
            input.price,
            input.land_value,
            input.improvement_value);
        !result) {
      return std::unexpected(result.error());
    }
    if (input.parcel_ids.empty()) {
      return std::unexpected(civic::core::error(
          ErrorCode::invalid_argument,
          "property transaction requires at least one parcel"));
    }

    std::set<std::string> seen;
    auto parcel_ids = input.parcel_ids;
    for (const auto& parcel_id : parcel_ids) {
      if (!has_text(parcel_id) || !seen.insert(parcel_id).second) {
        return std::unexpected(civic::core::error(
            ErrorCode::invalid_argument,
            "property transaction parcel ids must be unique and non-empty"));
      }
      const auto holding = holdings_.find(parcel_id);
      if (holding == holdings_.end()) {
        return std::unexpected(civic::core::error(
            ErrorCode::not_found,
            "property parcel has no owner record: " + parcel_id));
      }
      if (holding->second.owner_id != input.seller_id) {
        return std::unexpected(civic::core::error(
            ErrorCode::conflict,
            "property seller does not own parcel " + parcel_id));
      }
      const auto* parcel = cadastre_->find_external(parcel_id);
      if (parcel == nullptr || !parcel->live) {
        return std::unexpected(civic::core::error(
            ErrorCode::not_found,
            "property transaction references non-live parcel: " + parcel_id));
      }
    }
    std::sort(parcel_ids.begin(), parcel_ids.end());

    auto staged_holdings = holdings_;
    for (const auto& parcel_id : parcel_ids) staged_holdings.at(parcel_id).owner_id = input.buyer_id;

    PropertyTransaction transaction{
        .id = "property:tx:" + std::to_string(next_transaction_id_),
        .tick = input.tick,
        .parcel_ids = std::move(parcel_ids),
        .buyer_id = input.buyer_id,
        .seller_id = input.seller_id,
        .purpose = input.purpose,
        .price = input.price,
        .land_value = input.land_value,
        .improvement_value = input.improvement_value,
    };
    auto staged_transactions = transactions_;
    staged_transactions.push_back(transaction);

    holdings_.swap(staged_holdings);
    transactions_.swap(staged_transactions);
    ++next_transaction_id_;
    return transaction;
  } catch (const std::exception& exception) {
    return std::unexpected(civic::core::error(ErrorCode::internal_error, exception.what()));
  }
}

PropertyMarketSnapshot PropertyMarketSystem::snapshot() const {
  PropertyMarketSnapshot result;
  result.holdings.reserve(holdings_.size());
  for (const auto& [_, holding] : holdings_) result.holdings.push_back(holding);
  result.transactions = transactions_;
  result.next_transaction_id = next_transaction_id_;
  return result;
}

civic::core::Result<void> PropertyMarketSystem::restore(
    const PropertyMarketSnapshot& snapshot,
    std::initializer_list<std::string> historical_parcel_ids) noexcept {
  try {
    if (cadastre_ == nullptr) {
      return std::unexpected(civic::core::error(
          ErrorCode::invalid_state,
          "property market has no cadastre"));
    }

    const std::set<std::string> historical(
        historical_parcel_ids.begin(),
        historical_parcel_ids.end());
    std::map<std::string, PropertyHolding> staged_holdings;
    for (const auto& holding : snapshot.holdings) {
      if (!has_text(holding.parcel_id) || !has_text(holding.owner_id)) {
        return std::unexpected(civic::core::error(
            ErrorCode::invalid_argument,
            "property holding ids must be non-empty"));
      }
      if (auto result = require_non_negative("reservation value", holding.reservation_value); !result) {
        return std::unexpected(result.error());
      }
      const auto* parcel = cadastre_->find_external(holding.parcel_id);
      if (parcel == nullptr || !parcel->live) {
        return std::unexpected(civic::core::error(
            ErrorCode::not_found,
            "property holding references missing live parcel: " + holding.parcel_id));
      }
      if (!staged_holdings.emplace(holding.parcel_id, holding).second) {
        return std::unexpected(civic::core::error(
            ErrorCode::conflict,
            "duplicate property holding: " + holding.parcel_id));
      }
    }

    std::vector<PropertyTransaction> staged_transactions;
    staged_transactions.reserve(snapshot.transactions.size());
    for (std::size_t index = 0; index < snapshot.transactions.size(); ++index) {
      auto transaction = snapshot.transactions[index];
      const auto expected_id = "property:tx:" + std::to_string(index + 1U);
      if (transaction.id != expected_id) {
        return std::unexpected(civic::core::error(
            ErrorCode::invalid_argument,
            "invalid property transaction id: " + transaction.id));
      }
      if (auto result = validate_transaction_values(
              transaction.buyer_id,
              transaction.seller_id,
              transaction.purpose,
              transaction.price,
              transaction.land_value,
              transaction.improvement_value);
          !result) {
        return std::unexpected(result.error());
      }
      if (transaction.parcel_ids.empty()) {
        return std::unexpected(civic::core::error(
            ErrorCode::invalid_argument,
            "property transaction requires at least one parcel"));
      }

      std::set<std::string> seen;
      for (const auto& parcel_id : transaction.parcel_ids) {
        if (!has_text(parcel_id) || !seen.insert(parcel_id).second) {
          return std::unexpected(civic::core::error(
              ErrorCode::invalid_argument,
              "property transaction parcel ids must be unique and non-empty"));
        }
        if (!staged_holdings.contains(parcel_id) && !historical.contains(parcel_id)) {
          return std::unexpected(civic::core::error(
              ErrorCode::not_found,
              "property transaction references missing holding or historical parcel: " + parcel_id));
        }
      }
      std::sort(transaction.parcel_ids.begin(), transaction.parcel_ids.end());
      staged_transactions.push_back(std::move(transaction));
    }

    if (snapshot.next_transaction_id != staged_transactions.size() + 1U) {
      return std::unexpected(civic::core::error(
          ErrorCode::invariant_failure,
          "property market next transaction id must follow transaction history"));
    }

    holdings_.swap(staged_holdings);
    transactions_.swap(staged_transactions);
    next_transaction_id_ = snapshot.next_transaction_id;
    return {};
  } catch (const std::exception& exception) {
    return std::unexpected(civic::core::error(ErrorCode::internal_error, exception.what()));
  }
}

}  // namespace civic::urban
