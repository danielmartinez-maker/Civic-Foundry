#include "civic/urban/DevelopmentAuthority.hpp"

#include <algorithm>
#include <cctype>
#include <string>
#include <utility>

namespace civic::urban {
namespace {

using civic::core::ErrorCode;

[[nodiscard]] bool has_text(std::string_view value) noexcept {
  if (value.empty()) return false;
  return std::any_of(value.begin(), value.end(), [](char character) {
    return std::isspace(static_cast<unsigned char>(character)) == 0;
  });
}

}  // namespace

civic::core::Result<DevelopmentAuthorityDecision> DevelopmentAuthority::evaluate(
    const DevelopmentCandidate& candidate,
    const HighestBestUseInput& hbu_input) const noexcept {
  try {
    if (!has_text(candidate.id) || candidate.parcel_ids.empty()) {
      return std::unexpected(civic::core::error(
          ErrorCode::invalid_argument,
          "development candidate identity and parcels are required"));
    }

    auto candidate_parcels = candidate.parcel_ids;
    std::sort(candidate_parcels.begin(), candidate_parcels.end());
    if (std::adjacent_find(candidate_parcels.begin(), candidate_parcels.end()) != candidate_parcels.end()) {
      return std::unexpected(civic::core::error(
          ErrorCode::invalid_argument,
          "development candidate contains duplicate parcel ids"));
    }

    auto hbu_parcels = hbu_input.parcel_ids;
    std::sort(hbu_parcels.begin(), hbu_parcels.end());
    if (candidate_parcels != hbu_parcels) {
      return std::unexpected(civic::core::error(
          ErrorCode::invalid_argument,
          "development candidate and HBU parcel identities must match"));
    }

    auto hbu = HighestBestUseSystem{}.evaluate(hbu_input);
    if (!hbu) return std::unexpected(hbu.error());

    std::vector<std::string> rejection_reasons;
    if (!candidate.zoning_legal) rejection_reasons.push_back("zoning-compliance");
    if (hbu->best_strategy != HighestBestUseStrategy::redevelop) {
      rejection_reasons.push_back("highest-best-use");
    }

    return DevelopmentAuthorityDecision{
        .hbu = std::move(*hbu),
        .eligible_for_developer_market = rejection_reasons.empty(),
        .rejection_reasons = std::move(rejection_reasons),
    };
  } catch (const std::exception& exception) {
    return std::unexpected(civic::core::error(ErrorCode::internal_error, exception.what()));
  }
}

}  // namespace civic::urban
