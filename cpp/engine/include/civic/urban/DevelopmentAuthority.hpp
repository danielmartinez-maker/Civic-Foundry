#pragma once

#include "civic/cadastre/Cadastre.hpp"
#include "civic/core/Result.hpp"
#include "civic/core/StrongId.hpp"
#include "civic/urban/BuildingMassing.hpp"

#include <cstdint>
#include <functional>
#include <initializer_list>
#include <map>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace civic::urban {

enum class HighestBestUseStrategy : std::uint8_t {
  none,
  hold,
  renovate,
  convert,
  redevelop,
  assemble,
};

struct HighestBestUseAlternative final {
  HighestBestUseStrategy strategy{HighestBestUseStrategy::none};
  double net_value{};
  double expected_return{};
  double risk_score{};
  double risk_adjusted_return{};
  bool eligible{};
  bool operator==(const HighestBestUseAlternative&) const = default;
};

struct HighestBestUseInput final {
  std::vector<civic::core::ParcelId> parcel_ids{};
  double hold_value{};
  double building_condition{};
  double developer_hurdle_rate{};
  double renovation_net_value{};
  double renovation_expected_return{};
  double renovation_risk_score{};
  double conversion_net_value{};
  double conversion_expected_return{};
  double conversion_risk_score{};
  double redevelopment_net_value{};
  double redevelopment_expected_return{};
  double redevelopment_risk_score{};
  std::optional<double> assembly_net_value{};
  std::optional<double> assembly_expected_return{};
  std::optional<double> assembly_risk_score{};
};

struct HighestBestUseResult final {
  std::vector<civic::core::ParcelId> parcel_ids{};
  double building_condition{};
  HighestBestUseStrategy best_strategy{HighestBestUseStrategy::none};
  double best_value{};
  double hold_value{};
  double redevelopment_premium{};
  std::vector<HighestBestUseAlternative> alternatives{};
  bool operator==(const HighestBestUseResult&) const = default;
};

class HighestBestUseSystem final {
public:
  [[nodiscard]] civic::core::Result<HighestBestUseResult> evaluate(
      const HighestBestUseInput& input) const noexcept;
};

enum class PropertyTransactionPurpose : std::uint8_t {
  sale,
  redevelopment,
  assembly,
  renovation,
};

struct PropertyHolding final {
  std::string parcel_id{};
  std::string owner_id{};
  double reservation_value{};
  bool operator==(const PropertyHolding&) const = default;
};

struct PropertyTransactionInput final {
  std::uint64_t tick{};
  std::vector<std::string> parcel_ids{};
  std::string buyer_id{};
  std::string seller_id{};
  PropertyTransactionPurpose purpose{PropertyTransactionPurpose::sale};
  double price{};
  double land_value{};
  double improvement_value{};
};

struct PropertyTransaction final {
  std::string id{};
  std::uint64_t tick{};
  std::vector<std::string> parcel_ids{};
  std::string buyer_id{};
  std::string seller_id{};
  PropertyTransactionPurpose purpose{PropertyTransactionPurpose::sale};
  double price{};
  double land_value{};
  double improvement_value{};
  bool operator==(const PropertyTransaction&) const = default;
};

struct PropertyMarketSnapshot final {
  std::vector<PropertyHolding> holdings{};
  std::vector<PropertyTransaction> transactions{};
  std::uint64_t next_transaction_id{1};
  bool operator==(const PropertyMarketSnapshot&) const = default;
};

class PropertyMarketSystem final {
public:
  explicit PropertyMarketSystem(const civic::cadastre::CadastralGraph& cadastre) noexcept
      : cadastre_(&cadastre) {}

  void bind_cadastre(const civic::cadastre::CadastralGraph& cadastre) noexcept {
    cadastre_ = &cadastre;
  }

  [[nodiscard]] std::optional<std::string> owner_of(std::string_view parcel_id) const;
  [[nodiscard]] std::optional<double> reservation_value(std::string_view parcel_id) const;
  [[nodiscard]] civic::core::Result<PropertyTransaction> transact(
      const PropertyTransactionInput& input) noexcept;
  [[nodiscard]] PropertyMarketSnapshot snapshot() const;
  [[nodiscard]] civic::core::Result<void> restore(
      const PropertyMarketSnapshot& snapshot,
      std::initializer_list<std::string> historical_parcel_ids = {}) noexcept;
  [[nodiscard]] civic::core::Result<void> restore_with_cadastre_history(
      const PropertyMarketSnapshot& snapshot) noexcept;

private:
  const civic::cadastre::CadastralGraph* cadastre_{};
  std::map<std::string, PropertyHolding> holdings_{};
  std::vector<PropertyTransaction> transactions_{};
  std::uint64_t next_transaction_id_{1};
};

struct SiteAssemblyEnvelopeResolution final {
  double best_feasible_hbu_value{};
  double expected_return{};
  double developer_hurdle_rate{};
  double incremental_demolition_cost{};
  bool operator==(const SiteAssemblyEnvelopeResolution&) const = default;
};

using SiteAssemblyEnvelopeResolver = std::function<civic::core::Result<SiteAssemblyEnvelopeResolution>(
    std::span<const std::string> parcel_ids)>;

struct SiteAssemblyCandidate final {
  std::string seed_parcel_id{};
  std::vector<std::string> parcel_ids{};
  std::vector<std::string> added_parcel_ids{};
  double independent_hbu_value{};
  double assembled_hbu_value{};
  double incremental_development_value{};
  double acquisition_premiums{};
  double transaction_costs{};
  double carrying_cost{};
  double incremental_demolition_cost{};
  double incremental_assembly_cost{};
  double net_assembly_uplift{};
  double expected_return{};
  double developer_hurdle_rate{};
  bool operator==(const SiteAssemblyCandidate&) const = default;
};

class SiteAssemblySystem final {
public:
  [[nodiscard]] civic::core::Result<std::vector<SiteAssemblyCandidate>> candidates(
      std::string_view seed_parcel_id,
      const civic::cadastre::CadastralGraph& graph,
      const PropertyMarketSystem& property_market,
      const SiteAssemblyEnvelopeResolver& envelope_resolver) const noexcept;
};

struct DevelopmentAuthorityDecision final {
  HighestBestUseResult hbu{};
  bool eligible_for_developer_market{};
  std::vector<std::string> rejection_reasons{};
};

class DevelopmentAuthority final {
public:
  [[nodiscard]] civic::core::Result<DevelopmentAuthorityDecision> evaluate(
      const DevelopmentCandidate& candidate,
      const HighestBestUseInput& hbu_input) const noexcept;
};

}  // namespace civic::urban
