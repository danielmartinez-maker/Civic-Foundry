#pragma once

#include <cstdint>
#include <map>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <tuple>
#include <utility>
#include <vector>

#include <civic/core/Error.hpp>
#include <civic/core/RandomStreamRegistry.hpp>
#include <civic/core/StrongId.hpp>

namespace civic::socioeconomic {

struct ProductRuntimeTag;
struct SectorRuntimeTag;
struct RecipeRuntimeTag;
struct AccountTag;
struct InventoryTag;
struct WorkerTag;
struct JobOpeningTag;
struct FreightOrderTag;
struct FreightVehicleTag;
struct HousingUnitTag;
struct PersonTag;
struct CohortTag;

using ProductRuntimeId = StrongId<ProductRuntimeTag, std::uint32_t>;
using SectorRuntimeId = StrongId<SectorRuntimeTag, std::uint32_t>;
using RecipeRuntimeId = StrongId<RecipeRuntimeTag, std::uint32_t>;
using AccountId = StrongId<AccountTag>;
using InventoryId = StrongId<InventoryTag>;
using WorkerId = StrongId<WorkerTag>;
using JobOpeningId = StrongId<JobOpeningTag>;
using FreightOrderId = StrongId<FreightOrderTag>;
using FreightVehicleId = StrongId<FreightVehicleTag>;
using HousingUnitId = StrongId<HousingUnitTag>;
using PersonId = StrongId<PersonTag>;
using CohortId = StrongId<CohortTag>;

struct ProductDefinitionInput final {
    std::string id;
    std::int64_t unit_scale{1};
};
struct SectorDefinitionInput final { std::string id; };
struct RecipeItemInput final {
    std::string product;
    std::int64_t quantity{};
};
struct RecipeDefinitionInput final {
    std::string id;
    std::string sector;
    std::vector<RecipeItemInput> inputs;
    std::vector<RecipeItemInput> outputs;
    double labor_requirement{};
};
struct ProductDefinition final {
    std::string id;
    ProductRuntimeId runtime_id{0};
    std::int64_t unit_scale{1};
};
struct SectorDefinition final {
    std::string id;
    SectorRuntimeId runtime_id{0};
};
struct RecipeItem final {
    ProductRuntimeId product{0};
    std::int64_t quantity{};
};
struct RecipeDefinition final {
    std::string id;
    RecipeRuntimeId runtime_id{0};
    SectorRuntimeId sector{0};
    std::vector<RecipeItem> inputs;
    std::vector<RecipeItem> outputs;
    double labor_requirement{};
};

class EconomicDefinitions final {
public:
    [[nodiscard]] Result<void> load(std::span<const ProductDefinitionInput>, std::span<const SectorDefinitionInput>, std::span<const RecipeDefinitionInput>);
    [[nodiscard]] std::optional<ProductDefinition> product(std::string_view id) const;
    [[nodiscard]] std::optional<SectorDefinition> sector(std::string_view id) const;
    [[nodiscard]] std::optional<RecipeDefinition> recipe(std::string_view id) const;
    [[nodiscard]] const std::vector<ProductDefinition>& products() const noexcept { return products_; }
    [[nodiscard]] const std::vector<SectorDefinition>& sectors() const noexcept { return sectors_; }
    [[nodiscard]] const std::vector<RecipeDefinition>& recipes() const noexcept { return recipes_; }
private:
    std::vector<ProductDefinition> products_;
    std::vector<SectorDefinition> sectors_;
    std::vector<RecipeDefinition> recipes_;
};

enum class LedgerReason : std::uint32_t { sale, payroll, logistics, tax, rent, utilities, interest, capital, transfer };
struct LedgerEntry final {
    std::uint64_t sequence{};
    AccountId debit{0};
    AccountId credit{0};
    Money amount{};
    std::uint64_t tick{};
    LedgerReason reason{LedgerReason::transfer};
    EntityId source{0};
};
struct LedgerReconciliation final { Money debits{}; Money credits{}; std::size_t entry_count{}; };

class EconomicLedger final {
public:
    [[nodiscard]] Result<void> transfer(AccountId debit, AccountId credit, Money amount, std::uint64_t tick, LedgerReason reason, EntityId source);
    [[nodiscard]] Result<LedgerReconciliation> reconcile() const;
    [[nodiscard]] const std::vector<LedgerEntry>& entries() const noexcept { return entries_; }
    void clear() noexcept;
private:
    std::uint64_t next_sequence_{1};
    std::vector<LedgerEntry> entries_;
};

enum class FirmLifecycleState : std::uint32_t { forming, operating, expanding, contracting, distressed, closing, closed };
struct Firm final {
    FirmId id{0};
    SectorRuntimeId sector{0};
    BuildingId location{0};
    double employment{};
    Money cash{};
    Money debt{};
    std::vector<InventoryId> inventories;
    FirmLifecycleState lifecycle{FirmLifecycleState::operating};
};

class FirmStore final {
public:
    [[nodiscard]] Result<void> insert(const Firm& firm);
    [[nodiscard]] Result<void> restore(std::span<const Firm> firms, FirmId requested_next_id);
    [[nodiscard]] std::optional<Firm> get(FirmId id) const;
    [[nodiscard]] Result<void> update(const Firm& firm);
    [[nodiscard]] FirmId next_id() const noexcept { return FirmId{next_id_}; }
    [[nodiscard]] std::vector<Firm> snapshot() const;
private:
    std::map<FirmId, Firm> firms_;
    std::uint64_t next_id_{1};
};

struct InventoryReceipt final { std::int64_t accepted{}; std::int64_t rejected{}; };
struct InventoryRecord final {
    InventoryId id{0};
    ProductRuntimeId product{0};
    std::int64_t quantity{};
    std::int64_t capacity{};
};

class InventoryStore final {
public:
    [[nodiscard]] Result<void> create(InventoryId id, ProductRuntimeId product, std::int64_t quantity, std::int64_t capacity);
    [[nodiscard]] Result<InventoryReceipt> receive(InventoryId id, std::int64_t quantity);
    [[nodiscard]] Result<InventoryReceipt> transfer(InventoryId source, InventoryId destination, std::int64_t quantity);
    [[nodiscard]] Result<void> consume(InventoryId id, std::int64_t quantity);
    [[nodiscard]] Result<void> restore(std::span<const InventoryRecord> records);
    [[nodiscard]] std::int64_t quantity(InventoryId id) const noexcept;
    [[nodiscard]] std::optional<InventoryRecord> get(InventoryId id) const;
    [[nodiscard]] std::vector<InventoryRecord> snapshot() const;
private:
    std::map<InventoryId, InventoryRecord> records_;
};

struct RuntimeRecipeItem final { InventoryId inventory{0}; std::int64_t quantity{}; };
struct RuntimeRecipe final {
    std::vector<RuntimeRecipeItem> inputs;
    std::vector<RuntimeRecipeItem> outputs;
    double labor_per_batch{};
};
struct ProductionResult final { std::int64_t batches{}; double labor_consumed{}; };
class ProductionSystem final {
public:
    [[nodiscard]] Result<ProductionResult> run(const RuntimeRecipe& recipe, std::int64_t batches, double labor_available, InventoryStore& inventories) const;
};

struct Worker final { WorkerId id{0}; std::uint32_t skill{}; double accessibility_cost{}; bool available{true}; };
struct JobOpening final { JobOpeningId id{0}; FirmId firm{0}; std::uint32_t required_skill{}; Money wage{}; double accessibility_cost{}; bool open{true}; };
struct LaborAllocation final { WorkerId worker{0}; JobOpeningId opening{0}; FirmId firm{0}; Money wage{}; };
class LaborMarket final {
public:
    [[nodiscard]] Result<void> add_worker(const Worker& worker);
    [[nodiscard]] Result<void> add_opening(const JobOpening& opening);
    [[nodiscard]] Result<std::vector<LaborAllocation>> clear();
    void reset() noexcept;
private:
    std::map<WorkerId, Worker> workers_;
    std::map<JobOpeningId, JobOpening> openings_;
};

struct SupplierCandidate final {
    FirmId supplier{0};
    std::int64_t production_price{};
    std::int64_t transport_cost{};
    std::int64_t congestion_reliability_cost{};
    std::int64_t inventory_risk_cost{};
};
class TradeSystem final {
public:
    [[nodiscard]] static std::optional<SupplierCandidate> choose_supplier(std::span<const SupplierCandidate> candidates);
};

enum class FreightOrderState : std::uint32_t { created, matched, assigned, in_transit, returning, delivered, cancelled, lost };
struct FreightOrderInput final {
    InventoryId source{0};
    InventoryId destination{0};
    ProductRuntimeId product{0};
    std::int64_t quantity{};
};
struct FreightOrder final {
    FreightOrderId id{0};
    InventoryId source{0};
    InventoryId destination{0};
    ProductRuntimeId product{0};
    std::int64_t created{};
    std::int64_t delivered{};
    std::int64_t returned{};
    std::int64_t active{};
    std::int64_t lost{};
    FreightOrderState state{FreightOrderState::created};
    bool delivery_attempted{};
};
struct FreightMutation final { std::int64_t delivered{}; std::int64_t returned{}; std::int64_t still_active{}; };
struct FreightConservation final {
    std::int64_t created{};
    std::int64_t delivered{};
    std::int64_t returned{};
    std::int64_t active{};
    std::int64_t lost{};
    bool balanced{};
};
class FreightOrderStore final {
public:
    [[nodiscard]] Result<FreightOrderId> create(const FreightOrderInput& input);
    [[nodiscard]] Result<FreightMutation> deliver(FreightOrderId id, std::int64_t offered_quantity, InventoryStore& inventories);
    [[nodiscard]] Result<FreightMutation> cancel(FreightOrderId id, InventoryStore& inventories);
    [[nodiscard]] Result<void> record_modeled_loss(FreightOrderId id, std::int64_t quantity);
    [[nodiscard]] Result<FreightConservation> conservation(FreightOrderId id) const;
    [[nodiscard]] std::optional<FreightOrder> get(FreightOrderId id) const;
    [[nodiscard]] std::vector<FreightOrder> snapshot() const;
private:
    std::map<FreightOrderId, FreightOrder> orders_;
    std::uint64_t next_id_{1};
};

struct FreightVehicle final {
    FreightVehicleId id{0};
    FreightOrderId order{0};
    std::int64_t cargo{};
    double travel_time{};
    double progress{};
    bool route_valid{true};
};
class FreightVehicleStore final {
public:
    [[nodiscard]] Result<void> assign(const FreightVehicle& vehicle);
    [[nodiscard]] Result<void> reroute_failure(FreightVehicleId id);
    [[nodiscard]] Result<void> restore(std::span<const FreightVehicle> vehicles);
    [[nodiscard]] std::optional<FreightVehicle> get(FreightVehicleId id) const;
private:
    std::map<FreightVehicleId, FreightVehicle> vehicles_;
};

enum class BusinessLifecycleState : std::uint32_t { forming, operating, expanding, contracting, distressed, closing, closed };
struct BusinessLifecycleInput final { FirmId firm{0}; Money cash{}; Money debt{}; bool live_contracts{}; };
class BusinessLifecycle final {
public:
    [[nodiscard]] BusinessLifecycleState evaluate(const BusinessLifecycleInput& input) const noexcept;
    [[nodiscard]] bool can_close(FirmId firm, std::span<const FirmId> active_freight_firms) const noexcept;
};

struct Household final {
    HouseholdId id{0};
    double member_weight{};
    Money income{};
    Money cash{};
    std::uint32_t vehicle_count{};
    std::optional<HousingUnitId> home;
    std::uint32_t dependents{};
    Money debt{};
    std::uint32_t preference_flags{};
    std::uint32_t relocation_constraint_flags{};
};
class HouseholdStore final {
public:
    [[nodiscard]] Result<void> insert(const Household& household);
    [[nodiscard]] Result<void> update(const Household& household);
    [[nodiscard]] std::optional<Household> get(HouseholdId id) const;
    [[nodiscard]] std::vector<Household> snapshot() const;
    void clear() noexcept;
private:
    std::map<HouseholdId, Household> households_;
};

struct PersonInput final {
    HouseholdId household{0};
    std::uint16_t age{};
    std::uint16_t education{};
    std::uint16_t occupation{};
    bool employed{};
    Money income{};
};
struct PersonView final {
    PersonId id{0};
    HouseholdId household{0};
    std::uint16_t age{};
    std::uint16_t education{};
    std::uint16_t occupation{};
    bool employed{};
    Money income{};
    bool alive{};
};
class PersonRegistry final {
public:
    [[nodiscard]] Result<PersonId> create(const PersonInput& input);
    [[nodiscard]] Result<void> erase(PersonId id);
    [[nodiscard]] std::optional<PersonView> get(PersonId id) const;
    [[nodiscard]] std::vector<PersonView> snapshot() const;
    [[nodiscard]] std::size_t size() const noexcept { return index_.size(); }
    [[nodiscard]] PersonId next_id() const noexcept { return PersonId{next_id_}; }
    void clear() noexcept;
private:
    std::uint64_t next_id_{1};
    std::vector<PersonId> ids_;
    std::vector<HouseholdId> households_;
    std::vector<std::uint16_t> ages_;
    std::vector<std::uint16_t> educations_;
    std::vector<std::uint16_t> occupations_;
    std::vector<bool> employed_;
    std::vector<Money> incomes_;
    std::vector<bool> alive_;
    std::vector<std::size_t> free_slots_;
    std::map<PersonId, std::size_t> index_;
};

enum class PopulationFidelity : std::uint32_t { explicit_person, weighted_cohort, regional_aggregate };
struct PopulationCohort final { CohortId id{0}; double population_weight{}; Money cash{}; PopulationFidelity fidelity{PopulationFidelity::weighted_cohort}; };
struct PopulationTotals final { double population_weight{}; Money cash{}; };
class PopulationFidelityStore final {
public:
    [[nodiscard]] Result<void> add_cohort(const PopulationCohort& cohort);
    [[nodiscard]] Result<void> promote(CohortId cohort, double weight);
    [[nodiscard]] Result<void> demote_explicit(double weight);
    [[nodiscard]] PopulationTotals totals() const noexcept;
private:
    struct ExplicitChunk final { CohortId origin{0}; double weight{}; Money cash{}; };
    std::map<CohortId, PopulationCohort> cohorts_;
    std::vector<ExplicitChunk> explicit_chunks_;
};

struct LifecycleCadence final { std::uint64_t aging_ticks{365}; std::uint64_t employment_ticks{7}; std::uint64_t migration_ticks{30}; };
struct LifecycleOutcome final { std::uint64_t aged{}; std::uint64_t employment_changes{}; std::uint64_t migration_checks{}; };
class LifecycleScheduler final {
public:
    explicit LifecycleScheduler(std::uint32_t seed, LifecycleCadence cadence = {});
    [[nodiscard]] Result<LifecycleOutcome> step(std::uint64_t tick, PersonRegistry& people);
private:
    RandomStreamRegistry rng_;
    LifecycleCadence cadence_;
};

struct HousingUnit final { HousingUnitId id{0}; BuildingId building{0}; double capacity{}; };
class HousingMarket final {
public:
    [[nodiscard]] Result<void> add_unit(const HousingUnit& unit);
    [[nodiscard]] Result<void> relocate(HouseholdId household, double member_weight, HousingUnitId destination);
    [[nodiscard]] std::optional<HousingUnitId> primary_home(HouseholdId household) const;
    [[nodiscard]] double occupancy(HousingUnitId unit) const noexcept;
private:
    std::map<HousingUnitId, HousingUnit> units_;
    std::map<HousingUnitId, double> occupancy_;
    std::map<HouseholdId, std::pair<HousingUnitId, double>> primary_;
};

struct ServiceEconomicInterface final {
    std::uint64_t service_id{};
    double demand{};
    double staffing{};
    double capacity{};
    Money operating_cost{};
    double accessibility{};
    [[nodiscard]] Result<void> validate() const;
};
struct UtilityEconomicInterface final {
    std::uint64_t utility_id{};
    double demand{};
    double connected_capacity{};
    Money operating_cost{};
    [[nodiscard]] Result<void> validate() const;
};

struct PayrollAccounts final { AccountId firm{0}; AccountId household{0}; };
class SocioeconomicRuntime final {
public:
    explicit SocioeconomicRuntime(std::uint32_t seed);
    [[nodiscard]] EconomicDefinitions& definitions() noexcept { return definitions_; }
    [[nodiscard]] EconomicLedger& ledger() noexcept { return ledger_; }
    [[nodiscard]] const EconomicLedger& ledger() const noexcept { return ledger_; }
    [[nodiscard]] FirmStore& firms() noexcept { return firms_; }
    [[nodiscard]] InventoryStore& inventories() noexcept { return inventories_; }
    [[nodiscard]] FreightOrderStore& freight() noexcept { return freight_; }
    [[nodiscard]] HouseholdStore& households() noexcept { return households_; }
    [[nodiscard]] const HouseholdStore& households() const noexcept { return households_; }
    [[nodiscard]] PersonRegistry& people() noexcept { return people_; }
    [[nodiscard]] const PersonRegistry& people() const noexcept { return people_; }
    [[nodiscard]] Result<void> register_payroll_accounts(FirmId firm, HouseholdId household, AccountId firm_account, AccountId household_account);
    [[nodiscard]] Result<void> pay_wage(FirmId firm, HouseholdId household, Money amount, std::uint64_t tick);
    [[nodiscard]] std::uint64_t authoritative_hash() const noexcept;
    [[nodiscard]] Result<std::string> serialize_v9_extension(std::uint64_t tick) const;
    [[nodiscard]] Result<void> restore_v9_extension(std::string_view json);
    [[nodiscard]] std::uint32_t seed() const noexcept { return seed_; }
private:
    [[nodiscard]] std::string canonical_state() const;
    static std::uint64_t fnv1a64(std::string_view bytes) noexcept;

    std::uint32_t seed_{};
    EconomicDefinitions definitions_;
    EconomicLedger ledger_;
    FirmStore firms_;
    InventoryStore inventories_;
    FreightOrderStore freight_;
    HouseholdStore households_;
    PersonRegistry people_;
    std::map<std::pair<FirmId, HouseholdId>, PayrollAccounts> payroll_accounts_;
};

} // namespace civic::socioeconomic
