#pragma once
#include "Cadastre.hpp"
#include <cstdint>
#include <functional>
#include <span>
#include <string_view>

namespace civic::cadastre {

enum class MutationStage : std::uint8_t {
  snapshot_owners,
  clone_stage,
  apply_mutation,
  rewrite_dependent_references,
  validate_topology,
  validate_ownership_zoning_access,
  validate_buildings_property_references,
  validate_compatibility_projection,
  atomic_commit,
};

[[nodiscard]] std::string_view mutation_stage_name(MutationStage stage) noexcept;

struct ParcelSplitCommand final { civic::core::ParcelId parcel_id{}; civic::geometry::Segment cut{}; };
struct ParcelAssemblyCommand final { std::vector<civic::core::ParcelId> parcel_ids{}; };
struct EasementCreateCommand final { std::string id{}; std::vector<civic::core::ParcelId> parcel_ids{}; std::string kind{}; std::vector<civic::geometry::Point> geometry{}; };
struct RightOfWayCommand final { civic::core::ParcelId parcel_id{}; civic::geometry::Polygon dedicated_area{}; };
struct MutationResult final { std::vector<civic::core::ParcelId> retired_parcel_ids{}; std::vector<civic::core::ParcelId> resulting_parcel_ids{}; std::uint64_t committed_revision{}; };

class CadastralMutationService final {
public:
  using CommitValidator = std::function<civic::core::Result<void>(const CadastralGraph&)>;
  using StageValidator = std::function<civic::core::Result<void>(MutationStage, const CadastralGraph&)>;

  explicit CadastralMutationService(CadastralGraph& graph) : graph_(graph) {}
  void add_commit_validator(CommitValidator validator) { validators_.push_back(std::move(validator)); }
  void set_stage_validator(StageValidator validator) { stage_validator_ = std::move(validator); }

  [[nodiscard]] civic::core::Result<MutationResult> split(const ParcelSplitCommand&) noexcept;
  [[nodiscard]] civic::core::Result<MutationResult> assemble(const ParcelAssemblyCommand&) noexcept;
  [[nodiscard]] civic::core::Result<void> create_easement(const EasementCreateCommand&) noexcept;
  [[nodiscard]] civic::core::Result<void> remove_easement(std::string_view id) noexcept;
  [[nodiscard]] civic::core::Result<MutationResult> dedicate_right_of_way(const RightOfWayCommand&) noexcept;

private:
  [[nodiscard]] std::uint64_t next_sequence() const noexcept;
  [[nodiscard]] std::uint64_t next_lineage_tick() const noexcept;
  [[nodiscard]] civic::core::Result<void> run_stage(MutationStage, const CadastralGraph&) const noexcept;
  [[nodiscard]] civic::core::Result<void> validate_dependents(const CadastralGraph&) const noexcept;
  [[nodiscard]] civic::core::Result<void> validate_ownership_zoning_access(const CadastralGraph&) const noexcept;
  [[nodiscard]] civic::core::Result<void> validate_compatibility_projection(const CadastralGraph&) const noexcept;
  [[nodiscard]] civic::core::Result<void> finalize_transaction(CadastreTransaction&) const noexcept;

  CadastralGraph& graph_;
  std::vector<CommitValidator> validators_{};
  StageValidator stage_validator_{};
};

}  // namespace civic::cadastre
