#include "civic/urban/DevelopmentAuthority.hpp"

#include <algorithm>
#include <cmath>
#include <cctype>
#include <cstddef>
#include <optional>
#include <set>
#include <string>
#include <utility>

namespace civic::urban {
namespace {

using civic::core::ErrorCode;
using civic::core::ParcelId;

constexpr std::size_t kMaxAssemblyParcels = 4;
constexpr double kTransactionCostRate = 0.02;
constexpr double kCarryingCostRate = 0.01;

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

[[nodiscard]] std::vector<std::string> canonical_external_ids(std::vector<std::string> parcel_ids) {
  std::sort(parcel_ids.begin(), parcel_ids.end());
  parcel_ids.erase(std::unique(parcel_ids.begin(), parcel_ids.end()), parcel_ids.end());
  return parcel_ids;
}

[[nodiscard]] std::vector<std::string> adjacent_external_ids(
    std::string_view parcel_external_id,
    const civic::cadastre::CadastralGraph& graph) {
  const auto* parcel = graph.find_external(parcel_external_id);
  if (parcel == nullptr || !parcel->live) return {};

  std::vector<std::string> result;
  for (const auto& [_, boundary] : graph.boundaries()) {
    if (!boundary.left_parcel_id || !boundary.right_parcel_id) continue;
    std::optional<ParcelId> adjacent;
    if (*boundary.left_parcel_id == parcel->id) adjacent = boundary.right_parcel_id;
    else if (*boundary.right_parcel_id == parcel->id) adjacent = boundary.left_parcel_id;
    if (!adjacent) continue;
    const auto* neighbor = graph.find(*adjacent);
    if (neighbor != nullptr && neighbor->live) result.push_back(neighbor->external_id);
  }
  return canonical_external_ids(std::move(result));
}

void enumerate_connected_sets(
    std::string_view seed_parcel_id,
    const civic::cadastre::CadastralGraph& graph,
    std::vector<std::vector<std::string>>& output) {
  std::set<std::string> seen;
  const auto visit = [&](auto&& self, std::vector<std::string> current) -> void {
    current = canonical_external_ids(std::move(current));
    std::string key;
    for (const auto& id : current) {
      if (!key.empty()) key += '|';
      key += id;
    }
    if (!seen.insert(key).second) return;
    if (current.size() >= 2U) output.push_back(current);
    if (current.size() >= kMaxAssemblyParcels) return;

    std::vector<std::string> neighbors;
    for (const auto& id : current) {
      auto adjacent = adjacent_external_ids(id, graph);
      neighbors.insert(neighbors.end(), adjacent.begin(), adjacent.end());
    }
    neighbors = canonical_external_ids(std::move(neighbors));
    for (const auto& neighbor : neighbors) {
      if (std::find(current.begin(), current.end(), neighbor) != current.end()) continue;
      auto expanded = current;
      expanded.push_back(neighbor);
      self(self, std::move(expanded));
    }
  };

  visit(visit, {std::string{seed_parcel_id}});
  std::sort(output.begin(), output.end(), [](const auto& left, const auto& right) {
    if (left.size() != right.size()) return left.size() < right.size();
    return left < right;
  });
}

[[nodiscard]] civic::core::Result<void> validate_resolution(
    const SiteAssemblyEnvelopeResolution& resolution,
    std::string_view label) {
  if (auto result = require_non_negative(
          std::string{label} + " best feasible HBU value",
          resolution.best_feasible_hbu_value);
      !result) {
    return result;
  }
  if (auto result = require_non_negative(
          std::string{label} + " expected return",
          resolution.expected_return);
      !result) {
    return result;
  }
  if (auto result = require_non_negative(
          std::string{label} + " developer hurdle rate",
          resolution.developer_hurdle_rate);
      !result) {
    return result;
  }
  return require_non_negative(
      std::string{label} + " incremental demolition cost",
      resolution.incremental_demolition_cost);
}

}  // namespace

civic::core::Result<std::vector<SiteAssemblyCandidate>> SiteAssemblySystem::candidates(
    std::string_view seed_parcel_id,
    const civic::cadastre::CadastralGraph& graph,
    const PropertyMarketSystem& property_market,
    const SiteAssemblyEnvelopeResolver& envelope_resolver) const noexcept {
  try {
    if (!has_text(seed_parcel_id)) {
      return std::unexpected(civic::core::error(
          ErrorCode::invalid_argument,
          "assembly seed parcel id must be non-empty"));
    }
    const auto* seed = graph.find_external(seed_parcel_id);
    if (seed == nullptr || !seed->live) {
      return std::unexpected(civic::core::error(
          ErrorCode::not_found,
          "unknown assembly seed parcel"));
    }
    const auto seed_owner = property_market.owner_of(seed_parcel_id);
    if (!seed_owner) {
      return std::unexpected(civic::core::error(
          ErrorCode::not_found,
          "assembly seed parcel has no property owner"));
    }
    if (!envelope_resolver) {
      return std::unexpected(civic::core::error(
          ErrorCode::invalid_argument,
          "site assembly envelope resolver is required"));
    }

    std::vector<std::vector<std::string>> connected_sets;
    enumerate_connected_sets(seed_parcel_id, graph, connected_sets);
    std::vector<SiteAssemblyCandidate> result;

    for (const auto& parcel_ids : connected_sets) {
      bool compatible = true;
      for (const auto& parcel_id : parcel_ids) {
        const auto* parcel = graph.find_external(parcel_id);
        if (parcel == nullptr || !parcel->live || parcel->block_id != seed->block_id ||
            parcel->zoning_district_id != seed->zoning_district_id) {
          compatible = false;
          break;
        }
      }
      if (!compatible) continue;

      std::vector<SiteAssemblyEnvelopeResolution> independent;
      independent.reserve(parcel_ids.size());
      for (const auto& parcel_id : parcel_ids) {
        const std::vector<std::string> singleton{parcel_id};
        auto resolution = envelope_resolver(singleton);
        if (!resolution) return std::unexpected(resolution.error());
        if (auto validation = validate_resolution(*resolution, "independent parcel"); !validation) {
          return std::unexpected(validation.error());
        }
        independent.push_back(*resolution);
      }

      auto assembled = envelope_resolver(parcel_ids);
      if (!assembled) return std::unexpected(assembled.error());
      if (auto validation = validate_resolution(*assembled, "assembled parcels"); !validation) {
        return std::unexpected(validation.error());
      }

      double independent_hbu_value = 0.0;
      for (const auto& resolution : independent) {
        independent_hbu_value += resolution.best_feasible_hbu_value;
      }
      const double assembled_hbu_value = assembled->best_feasible_hbu_value;
      const double incremental_development_value = assembled_hbu_value - independent_hbu_value;

      std::vector<std::string> added_parcel_ids;
      for (const auto& parcel_id : parcel_ids) {
        if (parcel_id != seed_parcel_id) added_parcel_ids.push_back(parcel_id);
      }

      double acquisition_premiums = 0.0;
      double transaction_costs = 0.0;
      double carrying_cost = 0.0;
      bool missing_holding = false;
      for (const auto& added_id : added_parcel_ids) {
        const auto owner = property_market.owner_of(added_id);
        const auto reservation = property_market.reservation_value(added_id);
        if (!owner || !reservation) {
          missing_holding = true;
          break;
        }
        if (*owner == *seed_owner) continue;

        const auto position = std::find(parcel_ids.begin(), parcel_ids.end(), added_id);
        if (position == parcel_ids.end()) {
          return std::unexpected(civic::core::error(
              ErrorCode::internal_error,
              "assembly parcel indexing failed"));
        }
        const auto index = static_cast<std::size_t>(std::distance(parcel_ids.begin(), position));
        const double independent_value = independent[index].best_feasible_hbu_value;
        acquisition_premiums += std::max(0.0, *reservation - independent_value);
        transaction_costs += *reservation * kTransactionCostRate;
        carrying_cost += *reservation * kCarryingCostRate;
      }
      if (missing_holding) continue;

      const double incremental_assembly_cost = acquisition_premiums + transaction_costs + carrying_cost +
          assembled->incremental_demolition_cost;
      if (incremental_development_value <= incremental_assembly_cost) continue;
      if (assembled->expected_return < assembled->developer_hurdle_rate) continue;

      result.push_back(SiteAssemblyCandidate{
          .seed_parcel_id = std::string{seed_parcel_id},
          .parcel_ids = parcel_ids,
          .added_parcel_ids = std::move(added_parcel_ids),
          .independent_hbu_value = independent_hbu_value,
          .assembled_hbu_value = assembled_hbu_value,
          .incremental_development_value = incremental_development_value,
          .acquisition_premiums = acquisition_premiums,
          .transaction_costs = transaction_costs,
          .carrying_cost = carrying_cost,
          .incremental_demolition_cost = assembled->incremental_demolition_cost,
          .incremental_assembly_cost = incremental_assembly_cost,
          .net_assembly_uplift = incremental_development_value - incremental_assembly_cost,
          .expected_return = assembled->expected_return,
          .developer_hurdle_rate = assembled->developer_hurdle_rate,
      });
    }

    std::sort(result.begin(), result.end(), [](const SiteAssemblyCandidate& left, const SiteAssemblyCandidate& right) {
      if (left.net_assembly_uplift != right.net_assembly_uplift) {
        return left.net_assembly_uplift > right.net_assembly_uplift;
      }
      if (left.parcel_ids.size() != right.parcel_ids.size()) {
        return left.parcel_ids.size() < right.parcel_ids.size();
      }
      return left.parcel_ids < right.parcel_ids;
    });
    return result;
  } catch (const std::exception& exception) {
    return std::unexpected(civic::core::error(ErrorCode::internal_error, exception.what()));
  }
}

}  // namespace civic::urban
