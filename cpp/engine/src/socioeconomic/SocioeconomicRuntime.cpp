#include <civic/socioeconomic/SocioeconomicRuntime.hpp>

#include <algorithm>
#include <cmath>
#include <limits>
#include <set>
#include <sstream>
#include <stdexcept>

#include <json-c/json.h>

namespace civic::socioeconomic {
namespace {

[[nodiscard]] bool valid_id(std::string_view id) {
    return !id.empty() && std::ranges::all_of(id, [](unsigned char ch) { return ch > 0x20U && ch != 0x7fU; });
}

[[nodiscard]] Result<std::int64_t> checked_add(std::int64_t left, std::int64_t right) {
    if ((right > 0 && left > std::numeric_limits<std::int64_t>::max() - right) ||
        (right < 0 && left < std::numeric_limits<std::int64_t>::min() - right)) {
        return std::unexpected(make_error(ErrorCode::invariant_failure, "integer overflow"));
    }
    return left + right;
}

[[nodiscard]] Result<std::int64_t> checked_mul(std::int64_t left, std::int64_t right) {
    if (left == 0 || right == 0) return 0;
    if (left == -1 && right == std::numeric_limits<std::int64_t>::min()) {
        return std::unexpected(make_error(ErrorCode::invariant_failure, "integer overflow"));
    }
    if (right == -1 && left == std::numeric_limits<std::int64_t>::min()) {
        return std::unexpected(make_error(ErrorCode::invariant_failure, "integer overflow"));
    }
    const auto result = left * right;
    if (result / right != left) {
        return std::unexpected(make_error(ErrorCode::invariant_failure, "integer overflow"));
    }
    return result;
}

[[nodiscard]] Result<void> validate_firm(const Firm& firm) {
    if (firm.id.value() == 0 || firm.sector.value() == 0 || firm.location.value() == 0) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, "firm requires non-zero id, sector and location"));
    }
    if (!std::isfinite(firm.employment) || firm.employment < 0.0) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, "firm employment must be finite and non-negative"));
    }
    if (firm.cash.minor_units() == std::numeric_limits<std::int64_t>::min() || firm.debt.minor_units() < 0) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, "firm monetary state is invalid"));
    }
    return {};
}

[[nodiscard]] Result<void> validate_household(const Household& household) {
    if (household.id.value() == 0 || !std::isfinite(household.member_weight) || household.member_weight < 0.0) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, "household identity/weight is invalid"));
    }
    if (household.debt.minor_units() < 0 || household.cash.minor_units() == std::numeric_limits<std::int64_t>::min() ||
        household.income.minor_units() == std::numeric_limits<std::int64_t>::min()) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, "household monetary state is invalid"));
    }
    return {};
}

[[nodiscard]] std::string json_escape(std::string_view value) {
    std::ostringstream out;
    out << '"';
    for (const unsigned char ch : value) {
        switch (ch) {
            case '"': out << "\\\""; break;
            case '\\': out << "\\\\"; break;
            case '\b': out << "\\b"; break;
            case '\f': out << "\\f"; break;
            case '\n': out << "\\n"; break;
            case '\r': out << "\\r"; break;
            case '\t': out << "\\t"; break;
            default:
                if (ch < 0x20U) {
                    constexpr char digits[] = "0123456789abcdef";
                    out << "\\u00" << digits[(ch >> 4U) & 0x0fU] << digits[ch & 0x0fU];
                } else {
                    out << static_cast<char>(ch);
                }
        }
    }
    out << '"';
    return out.str();
}

[[nodiscard]] std::optional<json_object*> object_member(json_object* object, const char* key, json_type type) {
    json_object* value = nullptr;
    if (!object || !json_object_object_get_ex(object, key, &value) || !value || json_object_get_type(value) != type) return std::nullopt;
    return value;
}

[[nodiscard]] Result<std::uint64_t> json_u64(json_object* object, const char* key) {
    auto value = object_member(object, key, json_type_int);
    if (!value) return std::unexpected(make_error(ErrorCode::serialization_failure, std::string{"missing integer field: "} + key));
    const auto raw = json_object_get_int64(*value);
    if (raw < 0) return std::unexpected(make_error(ErrorCode::serialization_failure, std::string{"negative integer field: "} + key));
    return static_cast<std::uint64_t>(raw);
}

[[nodiscard]] Result<std::int64_t> json_i64(json_object* object, const char* key) {
    auto value = object_member(object, key, json_type_int);
    if (!value) return std::unexpected(make_error(ErrorCode::serialization_failure, std::string{"missing integer field: "} + key));
    return json_object_get_int64(*value);
}

[[nodiscard]] Result<double> json_f64(json_object* object, const char* key) {
    json_object* value = nullptr;
    if (!object || !json_object_object_get_ex(object, key, &value) || !value) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, std::string{"missing numeric field: "} + key));
    }
    const auto type = json_object_get_type(value);
    if (type != json_type_double && type != json_type_int) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, std::string{"invalid numeric field: "} + key));
    }
    const auto raw = json_object_get_double(value);
    if (!std::isfinite(raw)) return std::unexpected(make_error(ErrorCode::serialization_failure, std::string{"non-finite numeric field: "} + key));
    return raw;
}

} // namespace

Result<void> EconomicDefinitions::load(
    std::span<const ProductDefinitionInput> product_inputs,
    std::span<const SectorDefinitionInput> sector_inputs,
    std::span<const RecipeDefinitionInput> recipe_inputs) {
    std::vector<ProductDefinitionInput> sorted_products(product_inputs.begin(), product_inputs.end());
    std::vector<SectorDefinitionInput> sorted_sectors(sector_inputs.begin(), sector_inputs.end());
    std::vector<RecipeDefinitionInput> sorted_recipes(recipe_inputs.begin(), recipe_inputs.end());
    std::ranges::sort(sorted_products, {}, &ProductDefinitionInput::id);
    std::ranges::sort(sorted_sectors, {}, &SectorDefinitionInput::id);
    std::ranges::sort(sorted_recipes, {}, &RecipeDefinitionInput::id);

    std::vector<ProductDefinition> next_products;
    std::vector<SectorDefinition> next_sectors;
    std::vector<RecipeDefinition> next_recipes;
    std::map<std::string, ProductRuntimeId, std::less<>> product_ids;
    std::map<std::string, SectorRuntimeId, std::less<>> sector_ids;

    std::uint32_t product_id = 1;
    for (const auto& input : sorted_products) {
        if (!valid_id(input.id) || input.unit_scale <= 0 || product_ids.contains(input.id)) {
            return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid or duplicate product definition: " + input.id));
        }
        const ProductRuntimeId runtime{product_id++};
        product_ids.emplace(input.id, runtime);
        next_products.push_back({input.id, runtime, input.unit_scale});
    }

    std::uint32_t sector_id = 1;
    for (const auto& input : sorted_sectors) {
        if (!valid_id(input.id) || sector_ids.contains(input.id)) {
            return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid or duplicate sector definition: " + input.id));
        }
        const SectorRuntimeId runtime{sector_id++};
        sector_ids.emplace(input.id, runtime);
        next_sectors.push_back({input.id, runtime});
    }

    std::map<ProductRuntimeId, std::set<ProductRuntimeId>> dependency_graph;
    std::uint32_t recipe_id = 1;
    std::set<std::string> seen_recipes;
    for (const auto& input : sorted_recipes) {
        if (!valid_id(input.id) || !seen_recipes.insert(input.id).second || !std::isfinite(input.labor_requirement) || input.labor_requirement < 0.0) {
            return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid or duplicate recipe definition: " + input.id));
        }
        const auto sector_it = sector_ids.find(input.sector);
        if (sector_it == sector_ids.end()) {
            return std::unexpected(make_error(ErrorCode::invalid_argument, "recipe references missing sector: " + input.sector));
        }
        if (input.outputs.empty()) return std::unexpected(make_error(ErrorCode::invalid_argument, "recipe requires at least one output"));
        RecipeDefinition recipe{input.id, RecipeRuntimeId{recipe_id++}, sector_it->second, {}, {}, input.labor_requirement};
        for (const auto& item : input.inputs) {
            const auto it = product_ids.find(item.product);
            if (it == product_ids.end() || item.quantity <= 0) {
                return std::unexpected(make_error(ErrorCode::invalid_argument, "recipe input references invalid product/quantity: " + item.product));
            }
            recipe.inputs.push_back({it->second, item.quantity});
        }
        for (const auto& item : input.outputs) {
            const auto it = product_ids.find(item.product);
            if (it == product_ids.end() || item.quantity <= 0) {
                return std::unexpected(make_error(ErrorCode::invalid_argument, "recipe output references invalid product/quantity: " + item.product));
            }
            recipe.outputs.push_back({it->second, item.quantity});
            for (const auto& in : recipe.inputs) dependency_graph[in.product].insert(it->second);
        }
        next_recipes.push_back(std::move(recipe));
    }

    enum class Visit : std::uint8_t { fresh, active, complete };
    std::map<ProductRuntimeId, Visit> visits;
    std::function<bool(ProductRuntimeId)> cyclic = [&](ProductRuntimeId node) {
        const auto state = visits[node];
        if (state == Visit::active) return true;
        if (state == Visit::complete) return false;
        visits[node] = Visit::active;
        if (const auto it = dependency_graph.find(node); it != dependency_graph.end()) {
            for (const auto child : it->second) if (cyclic(child)) return true;
        }
        visits[node] = Visit::complete;
        return false;
    };
    for (const auto& [node, _] : dependency_graph) {
        if (cyclic(node)) return std::unexpected(make_error(ErrorCode::invalid_argument, "cyclic production dependency is prohibited"));
    }

    products_ = std::move(next_products);
    sectors_ = std::move(next_sectors);
    recipes_ = std::move(next_recipes);
    return {};
}

std::optional<ProductDefinition> EconomicDefinitions::product(std::string_view id) const {
    const auto it = std::ranges::find(products_, id, &ProductDefinition::id);
    if (it == products_.end()) return std::nullopt;
    return *it;
}
std::optional<SectorDefinition> EconomicDefinitions::sector(std::string_view id) const {
    const auto it = std::ranges::find(sectors_, id, &SectorDefinition::id);
    if (it == sectors_.end()) return std::nullopt;
    return *it;
}
std::optional<RecipeDefinition> EconomicDefinitions::recipe(std::string_view id) const {
    const auto it = std::ranges::find(recipes_, id, &RecipeDefinition::id);
    if (it == recipes_.end()) return std::nullopt;
    return *it;
}

Result<void> EconomicLedger::transfer(AccountId debit, AccountId credit, Money amount, std::uint64_t tick, LedgerReason reason, EntityId source) {
    if (debit.value() == 0 || credit.value() == 0 || debit == credit || amount.minor_units() <= 0 || source.value() == 0) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, "ledger transfer requires distinct accounts, positive amount and source"));
    }
    entries_.push_back({next_sequence_++, debit, credit, amount, tick, reason, source});
    return {};
}
Result<LedgerReconciliation> EconomicLedger::reconcile() const {
    std::int64_t debit_total = 0;
    std::int64_t credit_total = 0;
    std::uint64_t expected_sequence = 1;
    for (const auto& entry : entries_) {
        if (entry.sequence != expected_sequence++ || entry.amount.minor_units() <= 0 || entry.debit == entry.credit) {
            return std::unexpected(make_error(ErrorCode::invariant_failure, "ledger sequence or entry invariant failed"));
        }
        auto debit = checked_add(debit_total, entry.amount.minor_units()); if (!debit) return std::unexpected(debit.error()); debit_total = *debit;
        auto credit = checked_add(credit_total, entry.amount.minor_units()); if (!credit) return std::unexpected(credit.error()); credit_total = *credit;
    }
    if (debit_total != credit_total) return std::unexpected(make_error(ErrorCode::invariant_failure, "ledger does not reconcile"));
    return LedgerReconciliation{Money{debit_total}, Money{credit_total}, entries_.size()};
}
void EconomicLedger::clear() noexcept { entries_.clear(); next_sequence_ = 1; }

Result<void> FirmStore::insert(const Firm& firm) {
    auto valid = validate_firm(firm); if (!valid) return valid;
    if (firms_.contains(firm.id)) return std::unexpected(make_error(ErrorCode::invalid_argument, "duplicate firm id"));
    firms_.emplace(firm.id, firm);
    next_id_ = std::max(next_id_, firm.id.value() + 1);
    return {};
}
Result<void> FirmStore::restore(std::span<const Firm> firms, FirmId requested_next_id) {
    std::map<FirmId, Firm> next;
    std::uint64_t max_id = 0;
    for (const auto& firm : firms) {
        auto valid = validate_firm(firm); if (!valid) return valid;
        if (!next.emplace(firm.id, firm).second) return std::unexpected(make_error(ErrorCode::serialization_failure, "duplicate restored firm id"));
        max_id = std::max(max_id, firm.id.value());
    }
    firms_ = std::move(next);
    next_id_ = std::max<std::uint64_t>({1, requested_next_id.value(), max_id + 1});
    return {};
}
std::optional<Firm> FirmStore::get(FirmId id) const { if (const auto it = firms_.find(id); it != firms_.end()) return it->second; return std::nullopt; }
Result<void> FirmStore::update(const Firm& firm) { auto valid = validate_firm(firm); if (!valid) return valid; const auto it = firms_.find(firm.id); if (it == firms_.end()) return std::unexpected(make_error(ErrorCode::invalid_argument, "unknown firm")); it->second = firm; return {}; }
std::vector<Firm> FirmStore::snapshot() const { std::vector<Firm> out; out.reserve(firms_.size()); for (const auto& [_, firm] : firms_) out.push_back(firm); return out; }

Result<void> InventoryStore::create(InventoryId id, ProductRuntimeId product, std::int64_t quantity_value, std::int64_t capacity) {
    if (id.value() == 0 || product.value() == 0 || quantity_value < 0 || capacity < 0 || quantity_value > capacity) return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid inventory state"));
    if (!records_.emplace(id, InventoryRecord{id, product, quantity_value, capacity}).second) return std::unexpected(make_error(ErrorCode::invalid_argument, "duplicate inventory id"));
    return {};
}
Result<InventoryReceipt> InventoryStore::receive(InventoryId id, std::int64_t amount) {
    if (amount < 0) return std::unexpected(make_error(ErrorCode::invalid_argument, "receive quantity must be non-negative"));
    const auto it = records_.find(id); if (it == records_.end()) return std::unexpected(make_error(ErrorCode::invalid_argument, "unknown inventory"));
    const auto available = it->second.capacity - it->second.quantity;
    const auto accepted = std::min(amount, available);
    it->second.quantity += accepted;
    return InventoryReceipt{accepted, amount - accepted};
}
Result<InventoryReceipt> InventoryStore::transfer(InventoryId source, InventoryId destination, std::int64_t amount) {
    if (amount < 0) return std::unexpected(make_error(ErrorCode::invalid_argument, "transfer quantity must be non-negative"));
    const auto source_it = records_.find(source); const auto dest_it = records_.find(destination);
    if (source_it == records_.end() || dest_it == records_.end() || source_it->second.product != dest_it->second.product) return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid inventory transfer endpoints"));
    if (source_it->second.quantity < amount) return std::unexpected(make_error(ErrorCode::invalid_state, "insufficient source inventory"));
    const auto accepted = std::min(amount, dest_it->second.capacity - dest_it->second.quantity);
    source_it->second.quantity -= accepted;
    dest_it->second.quantity += accepted;
    return InventoryReceipt{accepted, amount - accepted};
}
Result<void> InventoryStore::consume(InventoryId id, std::int64_t amount) {
    if (amount < 0) return std::unexpected(make_error(ErrorCode::invalid_argument, "consume quantity must be non-negative"));
    const auto it = records_.find(id); if (it == records_.end() || it->second.quantity < amount) return std::unexpected(make_error(ErrorCode::invalid_state, "insufficient inventory"));
    it->second.quantity -= amount; return {};
}
Result<void> InventoryStore::restore(std::span<const InventoryRecord> records) {
    std::map<InventoryId, InventoryRecord> next;
    for (const auto& record : records) {
        if (record.id.value() == 0 || record.product.value() == 0 || record.quantity < 0 || record.capacity < 0 || record.quantity > record.capacity || !next.emplace(record.id, record).second) {
            return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid restored inventory"));
        }
    }
    records_ = std::move(next); return {};
}
std::int64_t InventoryStore::quantity(InventoryId id) const noexcept { if (const auto it = records_.find(id); it != records_.end()) return it->second.quantity; return 0; }
std::optional<InventoryRecord> InventoryStore::get(InventoryId id) const { if (const auto it = records_.find(id); it != records_.end()) return it->second; return std::nullopt; }
std::vector<InventoryRecord> InventoryStore::snapshot() const { std::vector<InventoryRecord> out; out.reserve(records_.size()); for (const auto& [_, record] : records_) out.push_back(record); return out; }

Result<ProductionResult> ProductionSystem::run(const RuntimeRecipe& recipe, std::int64_t batches, double labor_available, InventoryStore& inventories) const {
    if (batches <= 0 || !std::isfinite(recipe.labor_per_batch) || recipe.labor_per_batch < 0.0 || !std::isfinite(labor_available) || labor_available < 0.0) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid production request"));
    }
    const double required_labor = recipe.labor_per_batch * static_cast<double>(batches);
    if (!std::isfinite(required_labor) || required_labor > labor_available) return std::unexpected(make_error(ErrorCode::invalid_state, "insufficient labor"));
    for (const auto& input : recipe.inputs) {
        auto required = checked_mul(input.quantity, batches); if (!required) return std::unexpected(required.error());
        const auto record = inventories.get(input.inventory); if (!record || *required < 0 || record->quantity < *required) return std::unexpected(make_error(ErrorCode::invalid_state, "production input unavailable"));
    }
    for (const auto& output : recipe.outputs) {
        auto produced = checked_mul(output.quantity, batches); if (!produced) return std::unexpected(produced.error());
        const auto record = inventories.get(output.inventory); if (!record || *produced < 0 || record->capacity - record->quantity < *produced) return std::unexpected(make_error(ErrorCode::invalid_state, "production output capacity unavailable"));
    }
    for (const auto& input : recipe.inputs) { auto required = checked_mul(input.quantity, batches); if (!required) return std::unexpected(required.error()); auto consumed = inventories.consume(input.inventory, *required); if (!consumed) return consumed.transform([] { return ProductionResult{}; }); }
    for (const auto& output : recipe.outputs) { auto produced = checked_mul(output.quantity, batches); if (!produced) return std::unexpected(produced.error()); auto receipt = inventories.receive(output.inventory, *produced); if (!receipt || receipt->rejected != 0) return std::unexpected(make_error(ErrorCode::invariant_failure, "prevalidated production output did not fit")); }
    return ProductionResult{batches, required_labor};
}

Result<void> LaborMarket::add_worker(const Worker& worker) {
    if (worker.id.value() == 0 || !std::isfinite(worker.accessibility_cost) || worker.accessibility_cost < 0.0 || !workers_.emplace(worker.id, worker).second) return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid or duplicate worker"));
    return {};
}
Result<void> LaborMarket::add_opening(const JobOpening& opening) {
    if (opening.id.value() == 0 || opening.firm.value() == 0 || opening.wage.minor_units() < 0 || !std::isfinite(opening.accessibility_cost) || opening.accessibility_cost < 0.0 || !openings_.emplace(opening.id, opening).second) return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid or duplicate job opening"));
    return {};
}
Result<std::vector<LaborAllocation>> LaborMarket::clear() {
    std::vector<LaborAllocation> allocations;
    std::set<WorkerId> allocated_workers;
    for (auto& [opening_id, opening] : openings_) {
        if (!opening.open) continue;
        std::optional<Worker> best;
        double best_score = std::numeric_limits<double>::infinity();
        for (const auto& [worker_id, worker] : workers_) {
            if (!worker.available || allocated_workers.contains(worker_id)) continue;
            const auto skill_gap = static_cast<double>(worker.skill > opening.required_skill ? worker.skill - opening.required_skill : opening.required_skill - worker.skill);
            const auto score = skill_gap * 1000.0 + worker.accessibility_cost + opening.accessibility_cost;
            if (!best || score < best_score || (score == best_score && worker.id < best->id)) { best = worker; best_score = score; }
        }
        if (!best) continue;
        allocations.push_back({best->id, opening_id, opening.firm, opening.wage});
        allocated_workers.insert(best->id);
        workers_.at(best->id).available = false;
        opening.open = false;
    }
    return allocations;
}
void LaborMarket::reset() noexcept { workers_.clear(); openings_.clear(); }

std::optional<SupplierCandidate> TradeSystem::choose_supplier(std::span<const SupplierCandidate> candidates) {
    std::optional<SupplierCandidate> best;
    std::int64_t best_cost = std::numeric_limits<std::int64_t>::max();
    for (const auto& candidate : candidates) {
        if (candidate.supplier.value() == 0 || candidate.production_price < 0 || candidate.transport_cost < 0 || candidate.congestion_reliability_cost < 0 || candidate.inventory_risk_cost < 0) continue;
        auto cost = checked_add(candidate.production_price, candidate.transport_cost); if (!cost) continue;
        cost = checked_add(*cost, candidate.congestion_reliability_cost); if (!cost) continue;
        cost = checked_add(*cost, candidate.inventory_risk_cost); if (!cost) continue;
        if (!best || *cost < best_cost || (*cost == best_cost && candidate.supplier < best->supplier)) { best = candidate; best_cost = *cost; }
    }
    return best;
}

Result<FreightOrderId> FreightOrderStore::create(const FreightOrderInput& input) {
    if (input.source.value() == 0 || input.destination.value() == 0 || input.product.value() == 0 || input.quantity <= 0 || input.source == input.destination) return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid freight order"));
    const FreightOrderId id{next_id_++};
    orders_.emplace(id, FreightOrder{id, input.source, input.destination, input.product, input.quantity, 0, 0, input.quantity, 0, FreightOrderState::created, false});
    return id;
}
Result<FreightMutation> FreightOrderStore::deliver(FreightOrderId id, std::int64_t offered_quantity, InventoryStore& inventories) {
    const auto it = orders_.find(id); if (it == orders_.end()) return std::unexpected(make_error(ErrorCode::invalid_argument, "unknown freight order"));
    auto& order = it->second;
    if (order.delivery_attempted || order.state == FreightOrderState::delivered || order.state == FreightOrderState::cancelled || order.state == FreightOrderState::lost) return std::unexpected(make_error(ErrorCode::invalid_state, "freight delivery already resolved"));
    if (offered_quantity <= 0 || offered_quantity > order.active) return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid delivery quantity"));
    const auto destination = inventories.get(order.destination); if (!destination || destination->product != order.product) return std::unexpected(make_error(ErrorCode::invalid_state, "freight destination inventory mismatch"));
    auto receipt = inventories.receive(order.destination, offered_quantity); if (!receipt) return std::unexpected(receipt.error());
    order.delivered += receipt->accepted;
    order.active -= receipt->accepted;
    order.delivery_attempted = true;
    order.state = order.active == 0 ? FreightOrderState::delivered : FreightOrderState::returning;
    return FreightMutation{receipt->accepted, 0, order.active};
}
Result<FreightMutation> FreightOrderStore::cancel(FreightOrderId id, InventoryStore& inventories) {
    const auto it = orders_.find(id); if (it == orders_.end()) return std::unexpected(make_error(ErrorCode::invalid_argument, "unknown freight order"));
    auto& order = it->second;
    if (order.state == FreightOrderState::delivered || order.state == FreightOrderState::lost || order.active == 0) return std::unexpected(make_error(ErrorCode::invalid_state, "freight order has no returnable cargo"));
    const auto source = inventories.get(order.source); if (!source || source->product != order.product) return std::unexpected(make_error(ErrorCode::invalid_state, "freight source inventory mismatch"));
    auto receipt = inventories.receive(order.source, order.active); if (!receipt) return std::unexpected(receipt.error());
    order.returned += receipt->accepted;
    order.active -= receipt->accepted;
    order.state = order.active == 0 ? FreightOrderState::cancelled : FreightOrderState::returning;
    return FreightMutation{0, receipt->accepted, order.active};
}
Result<void> FreightOrderStore::record_modeled_loss(FreightOrderId id, std::int64_t amount) {
    const auto it = orders_.find(id); if (it == orders_.end() || amount <= 0 || amount > it->second.active) return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid modeled freight loss"));
    it->second.active -= amount; it->second.lost += amount; it->second.state = it->second.active == 0 ? FreightOrderState::lost : FreightOrderState::returning; return {};
}
Result<FreightConservation> FreightOrderStore::conservation(FreightOrderId id) const {
    const auto it = orders_.find(id); if (it == orders_.end()) return std::unexpected(make_error(ErrorCode::invalid_argument, "unknown freight order"));
    const auto& order = it->second;
    const auto sum = order.delivered + order.returned + order.active + order.lost;
    return FreightConservation{order.created, order.delivered, order.returned, order.active, order.lost, sum == order.created};
}
std::optional<FreightOrder> FreightOrderStore::get(FreightOrderId id) const { if (const auto it = orders_.find(id); it != orders_.end()) return it->second; return std::nullopt; }
std::vector<FreightOrder> FreightOrderStore::snapshot() const { std::vector<FreightOrder> out; out.reserve(orders_.size()); for (const auto& [_, order] : orders_) out.push_back(order); return out; }

Result<void> FreightVehicleStore::assign(const FreightVehicle& vehicle) {
    if (vehicle.id.value() == 0 || vehicle.order.value() == 0 || vehicle.cargo <= 0 || !std::isfinite(vehicle.travel_time) || vehicle.travel_time <= 0.0 || !std::isfinite(vehicle.progress) || vehicle.progress < 0.0 || vehicle.progress > vehicle.travel_time || !vehicles_.emplace(vehicle.id, vehicle).second) return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid or duplicate freight vehicle"));
    return {};
}
Result<void> FreightVehicleStore::reroute_failure(FreightVehicleId id) { const auto it = vehicles_.find(id); if (it == vehicles_.end()) return std::unexpected(make_error(ErrorCode::invalid_argument, "unknown freight vehicle")); it->second.route_valid = false; return {}; }
Result<void> FreightVehicleStore::restore(std::span<const FreightVehicle> vehicles) { std::map<FreightVehicleId, FreightVehicle> next; for (const auto& vehicle : vehicles) { if (vehicle.id.value() == 0 || vehicle.order.value() == 0 || vehicle.cargo <= 0 || !std::isfinite(vehicle.travel_time) || vehicle.travel_time <= 0.0 || !std::isfinite(vehicle.progress) || vehicle.progress < 0.0 || vehicle.progress > vehicle.travel_time || !next.emplace(vehicle.id, vehicle).second) return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid restored freight vehicle")); } vehicles_ = std::move(next); return {}; }
std::optional<FreightVehicle> FreightVehicleStore::get(FreightVehicleId id) const { if (const auto it = vehicles_.find(id); it != vehicles_.end()) return it->second; return std::nullopt; }

BusinessLifecycleState BusinessLifecycle::evaluate(const BusinessLifecycleInput& input) const noexcept {
    if (input.cash.minor_units() < 0 || input.debt.minor_units() > std::max<std::int64_t>(0, input.cash.minor_units()) * 4) return BusinessLifecycleState::distressed;
    if (input.live_contracts) return BusinessLifecycleState::operating;
    return BusinessLifecycleState::operating;
}
bool BusinessLifecycle::can_close(FirmId firm, std::span<const FirmId> active_freight_firms) const noexcept { return std::ranges::find(active_freight_firms, firm) == active_freight_firms.end(); }

Result<void> HouseholdStore::insert(const Household& household) { auto valid = validate_household(household); if (!valid) return valid; if (!households_.emplace(household.id, household).second) return std::unexpected(make_error(ErrorCode::invalid_argument, "duplicate household id")); return {}; }
Result<void> HouseholdStore::update(const Household& household) { auto valid = validate_household(household); if (!valid) return valid; const auto it = households_.find(household.id); if (it == households_.end()) return std::unexpected(make_error(ErrorCode::invalid_argument, "unknown household")); it->second = household; return {}; }
std::optional<Household> HouseholdStore::get(HouseholdId id) const { if (const auto it = households_.find(id); it != households_.end()) return it->second; return std::nullopt; }
std::vector<Household> HouseholdStore::snapshot() const { std::vector<Household> out; out.reserve(households_.size()); for (const auto& [_, household] : households_) out.push_back(household); return out; }
void HouseholdStore::clear() noexcept { households_.clear(); }

Result<PersonId> PersonRegistry::create(const PersonInput& input) {
    if (input.household.value() == 0 || input.age > 130 || input.income.minor_units() == std::numeric_limits<std::int64_t>::min()) return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid person state"));
    const PersonId id{next_id_++};
    std::size_t slot{};
    if (!free_slots_.empty()) { slot = free_slots_.back(); free_slots_.pop_back(); ids_[slot] = id; households_[slot] = input.household; ages_[slot] = input.age; educations_[slot] = input.education; occupations_[slot] = input.occupation; employed_[slot] = input.employed; incomes_[slot] = input.income; alive_[slot] = true; }
    else { slot = ids_.size(); ids_.push_back(id); households_.push_back(input.household); ages_.push_back(input.age); educations_.push_back(input.education); occupations_.push_back(input.occupation); employed_.push_back(input.employed); incomes_.push_back(input.income); alive_.push_back(true); }
    index_.emplace(id, slot); return id;
}
Result<void> PersonRegistry::erase(PersonId id) { const auto it = index_.find(id); if (it == index_.end()) return std::unexpected(make_error(ErrorCode::invalid_argument, "unknown person")); const auto slot = it->second; alive_[slot] = false; index_.erase(it); free_slots_.push_back(slot); return {}; }
std::optional<PersonView> PersonRegistry::get(PersonId id) const { const auto it = index_.find(id); if (it == index_.end()) return std::nullopt; const auto slot = it->second; if (!alive_[slot]) return std::nullopt; return PersonView{ids_[slot], households_[slot], ages_[slot], educations_[slot], occupations_[slot], employed_[slot], incomes_[slot], true}; }
std::vector<PersonView> PersonRegistry::snapshot() const { std::vector<PersonView> out; out.reserve(index_.size()); for (const auto& [id, _] : index_) if (auto person = get(id)) out.push_back(*person); return out; }
void PersonRegistry::clear() noexcept { next_id_ = 1; ids_.clear(); households_.clear(); ages_.clear(); educations_.clear(); occupations_.clear(); employed_.clear(); incomes_.clear(); alive_.clear(); free_slots_.clear(); index_.clear(); }

Result<void> PopulationFidelityStore::add_cohort(const PopulationCohort& cohort) { if (cohort.id.value() == 0 || !std::isfinite(cohort.population_weight) || cohort.population_weight < 0.0 || cohort.cash.minor_units() < 0 || !cohorts_.emplace(cohort.id, cohort).second) return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid or duplicate population cohort")); return {}; }
Result<void> PopulationFidelityStore::promote(CohortId id, double weight) {
    const auto it = cohorts_.find(id); if (it == cohorts_.end() || !std::isfinite(weight) || weight <= 0.0 || weight > it->second.population_weight) return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid population promotion"));
    const auto before_weight = it->second.population_weight;
    const auto before_cash = it->second.cash.minor_units();
    const auto cash_share = weight == before_weight ? before_cash : static_cast<std::int64_t>(std::llround(static_cast<long double>(before_cash) * static_cast<long double>(weight / before_weight)));
    it->second.population_weight -= weight;
    it->second.cash = Money{before_cash - cash_share};
    explicit_chunks_.push_back({id, weight, Money{cash_share}});
    return {};
}
Result<void> PopulationFidelityStore::demote_explicit(double weight) {
    if (!std::isfinite(weight) || weight <= 0.0) return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid population demotion"));
    double remaining = weight;
    while (remaining > 0.0 && !explicit_chunks_.empty()) {
        auto& chunk = explicit_chunks_.back();
        const auto take = std::min(remaining, chunk.weight);
        const auto cash_take = take == chunk.weight ? chunk.cash.minor_units() : static_cast<std::int64_t>(std::llround(static_cast<long double>(chunk.cash.minor_units()) * static_cast<long double>(take / chunk.weight)));
        auto cohort = cohorts_.find(chunk.origin); if (cohort == cohorts_.end()) return std::unexpected(make_error(ErrorCode::invariant_failure, "promotion origin cohort disappeared"));
        cohort->second.population_weight += take;
        cohort->second.cash = Money{cohort->second.cash.minor_units() + cash_take};
        chunk.weight -= take;
        chunk.cash = Money{chunk.cash.minor_units() - cash_take};
        remaining -= take;
        if (chunk.weight <= 1e-12) explicit_chunks_.pop_back();
    }
    if (remaining > 1e-9) return std::unexpected(make_error(ErrorCode::invalid_state, "insufficient explicit population to demote"));
    return {};
}
PopulationTotals PopulationFidelityStore::totals() const noexcept { double weight = 0.0; std::int64_t cash = 0; for (const auto& [_, cohort] : cohorts_) { weight += cohort.population_weight; cash += cohort.cash.minor_units(); } for (const auto& chunk : explicit_chunks_) { weight += chunk.weight; cash += chunk.cash.minor_units(); } return {weight, Money{cash}}; }

LifecycleScheduler::LifecycleScheduler(std::uint32_t seed, LifecycleCadence cadence) : rng_(seed), cadence_(cadence) {}
Result<LifecycleOutcome> LifecycleScheduler::step(std::uint64_t tick, PersonRegistry& people) {
    if (cadence_.aging_ticks == 0 || cadence_.employment_ticks == 0 || cadence_.migration_ticks == 0) return std::unexpected(make_error(ErrorCode::invalid_state, "lifecycle cadence cannot be zero"));
    LifecycleOutcome outcome{};
    if (tick % cadence_.aging_ticks == 0) outcome.aged = people.size();
    if (tick % cadence_.employment_ticks == 0) { auto stream = rng_.stream("demographics.employment"); if (!stream) return std::unexpected(stream.error()); for (std::size_t i = 0; i < people.size(); ++i) if ((*stream)->next() < 0.01) ++outcome.employment_changes; }
    if (tick % cadence_.migration_ticks == 0) { auto stream = rng_.stream("demographics.migration"); if (!stream) return std::unexpected(stream.error()); for (std::size_t i = 0; i < people.size(); ++i) { (void)(*stream)->next(); ++outcome.migration_checks; } }
    return outcome;
}

Result<void> HousingMarket::add_unit(const HousingUnit& unit) { if (unit.id.value() == 0 || unit.building.value() == 0 || !std::isfinite(unit.capacity) || unit.capacity < 0.0 || !units_.emplace(unit.id, unit).second) return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid or duplicate housing unit")); occupancy_.emplace(unit.id, 0.0); return {}; }
Result<void> HousingMarket::relocate(HouseholdId household, double member_weight, HousingUnitId destination) {
    if (household.value() == 0 || !std::isfinite(member_weight) || member_weight < 0.0) return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid household relocation"));
    const auto dest = units_.find(destination); if (dest == units_.end()) return std::unexpected(make_error(ErrorCode::invalid_argument, "unknown housing unit"));
    double destination_existing = occupancy_.at(destination);
    if (const auto old = primary_.find(household); old != primary_.end() && old->second.first == destination) destination_existing -= old->second.second;
    if (destination_existing + member_weight > dest->second.capacity + 1e-9) return std::unexpected(make_error(ErrorCode::invalid_state, "housing capacity exceeded"));
    if (const auto old = primary_.find(household); old != primary_.end()) occupancy_.at(old->second.first) -= old->second.second;
    occupancy_.at(destination) += member_weight;
    primary_[household] = {destination, member_weight};
    return {};
}
std::optional<HousingUnitId> HousingMarket::primary_home(HouseholdId household) const { if (const auto it = primary_.find(household); it != primary_.end()) return it->second.first; return std::nullopt; }
double HousingMarket::occupancy(HousingUnitId unit) const noexcept { if (const auto it = occupancy_.find(unit); it != occupancy_.end()) return it->second; return 0.0; }

Result<void> ServiceEconomicInterface::validate() const { if (service_id == 0 || !std::isfinite(demand) || demand < 0 || !std::isfinite(staffing) || staffing < 0 || !std::isfinite(capacity) || capacity < 0 || !std::isfinite(accessibility) || accessibility < 0 || operating_cost.minor_units() < 0) return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid service economic interface")); return {}; }
Result<void> UtilityEconomicInterface::validate() const { if (utility_id == 0 || !std::isfinite(demand) || demand < 0 || !std::isfinite(connected_capacity) || connected_capacity < 0 || operating_cost.minor_units() < 0) return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid utility economic interface")); return {}; }

SocioeconomicRuntime::SocioeconomicRuntime(std::uint32_t seed) : seed_(seed) {}
Result<void> SocioeconomicRuntime::register_payroll_accounts(FirmId firm, HouseholdId household, AccountId firm_account, AccountId household_account) {
    if (firm.value() == 0 || household.value() == 0 || firm_account.value() == 0 || household_account.value() == 0 || firm_account == household_account) return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid payroll account mapping"));
    payroll_accounts_[{firm, household}] = {firm_account, household_account}; return {};
}
Result<void> SocioeconomicRuntime::pay_wage(FirmId firm, HouseholdId household_id, Money amount, std::uint64_t tick) {
    if (amount.minor_units() <= 0) return std::unexpected(make_error(ErrorCode::invalid_argument, "wage must be positive"));
    const auto mapping = payroll_accounts_.find({firm, household_id}); if (mapping == payroll_accounts_.end()) return std::unexpected(make_error(ErrorCode::invalid_state, "payroll accounts are not registered"));
    auto household = households_.get(household_id); if (!household) return std::unexpected(make_error(ErrorCode::invalid_state, "payroll household does not exist"));
    auto next_income = checked_add(household->income.minor_units(), amount.minor_units()); if (!next_income) return std::unexpected(next_income.error());
    auto next_cash = checked_add(household->cash.minor_units(), amount.minor_units()); if (!next_cash) return std::unexpected(next_cash.error());
    auto posted = ledger_.transfer(mapping->second.firm, mapping->second.household, amount, tick, LedgerReason::payroll, EntityId{firm.value()}); if (!posted) return posted;
    household->income = Money{*next_income}; household->cash = Money{*next_cash};
    auto updated = households_.update(*household); if (!updated) return updated;
    return {};
}

std::string SocioeconomicRuntime::canonical_state() const {
    std::ostringstream out;
    out << "seed=" << seed_ << ';';
    for (const auto& firm : firms_.snapshot()) out << "F" << firm.id.value() << ',' << firm.sector.value() << ',' << firm.location.value() << ',' << firm.employment << ',' << firm.cash.minor_units() << ',' << firm.debt.minor_units() << ';';
    for (const auto& inventory : inventories_.snapshot()) out << "I" << inventory.id.value() << ',' << inventory.product.value() << ',' << inventory.quantity << ',' << inventory.capacity << ';';
    for (const auto& order : freight_.snapshot()) out << "R" << order.id.value() << ',' << order.source.value() << ',' << order.destination.value() << ',' << order.product.value() << ',' << order.created << ',' << order.delivered << ',' << order.returned << ',' << order.active << ',' << order.lost << ',' << static_cast<std::uint32_t>(order.state) << ',' << order.delivery_attempted << ';';
    for (const auto& household : households_.snapshot()) out << "H" << household.id.value() << ',' << household.member_weight << ',' << household.income.minor_units() << ',' << household.cash.minor_units() << ',' << household.debt.minor_units() << ',' << household.vehicle_count << ',' << household.dependents << ';';
    for (const auto& person : people_.snapshot()) out << "P" << person.id.value() << ',' << person.household.value() << ',' << person.age << ',' << person.education << ',' << person.occupation << ',' << person.employed << ',' << person.income.minor_units() << ';';
    for (const auto& entry : ledger_.entries()) out << "L" << entry.sequence << ',' << entry.debit.value() << ',' << entry.credit.value() << ',' << entry.amount.minor_units() << ',' << entry.tick << ',' << static_cast<std::uint32_t>(entry.reason) << ',' << entry.source.value() << ';';
    return out.str();
}
std::uint64_t SocioeconomicRuntime::fnv1a64(std::string_view bytes) noexcept { std::uint64_t hash = 14695981039346656037ULL; for (const unsigned char byte : bytes) { hash ^= byte; hash *= 1099511628211ULL; } return hash; }
std::uint64_t SocioeconomicRuntime::authoritative_hash() const noexcept { return fnv1a64(canonical_state()); }

Result<std::string> SocioeconomicRuntime::serialize_v9_extension(std::uint64_t tick) const {
    std::ostringstream out;
    out << "{\"saveVersion\":9,\"nativeSocioeconomic\":{\"schemaVersion\":1,\"seed\":" << seed_ << ",\"tick\":" << tick << ",\"households\":[";
    const auto households = households_.snapshot();
    for (std::size_t i = 0; i < households.size(); ++i) {
        if (i) out << ',';
        const auto& h = households[i];
        out << "{\"id\":" << h.id.value() << ",\"memberWeight\":" << h.member_weight << ",\"income\":" << h.income.minor_units() << ",\"cash\":" << h.cash.minor_units() << ",\"debt\":" << h.debt.minor_units() << ",\"vehicles\":" << h.vehicle_count << ",\"dependents\":" << h.dependents << '}';
    }
    out << "],\"people\":[";
    const auto people = people_.snapshot();
    for (std::size_t i = 0; i < people.size(); ++i) {
        if (i) out << ',';
        const auto& p = people[i];
        out << "{\"id\":" << p.id.value() << ",\"household\":" << p.household.value() << ",\"age\":" << p.age << ",\"education\":" << p.education << ",\"occupation\":" << p.occupation << ",\"employed\":" << (p.employed ? "true" : "false") << ",\"income\":" << p.income.minor_units() << '}';
    }
    out << "]}}";
    return out.str();
}

Result<void> SocioeconomicRuntime::restore_v9_extension(std::string_view json) {
    json_tokener* tokener = json_tokener_new();
    if (!tokener) return std::unexpected(make_error(ErrorCode::internal_error, "json tokener allocation failed"));
    json_object* root = json_tokener_parse_ex(tokener, json.data(), static_cast<int>(json.size()));
    const auto parse_error = json_tokener_get_error(tokener);
    json_tokener_free(tokener);
    if (parse_error != json_tokener_success || !root || json_object_get_type(root) != json_type_object) { if (root) json_object_put(root); return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid socioeconomic save JSON")); }
    struct RootGuard { json_object* value; ~RootGuard() { if (value) json_object_put(value); } } guard{root};
    auto save_version = json_u64(root, "saveVersion"); if (!save_version || *save_version != 9) return std::unexpected(make_error(ErrorCode::unsupported_save_version, "native socioeconomic extension requires Save V9"));
    auto extension = object_member(root, "nativeSocioeconomic", json_type_object); if (!extension) return std::unexpected(make_error(ErrorCode::serialization_failure, "nativeSocioeconomic object missing"));
    auto schema = json_u64(*extension, "schemaVersion"); if (!schema || *schema != 1) return std::unexpected(make_error(ErrorCode::serialization_failure, "unsupported socioeconomic schema"));
    auto seed = json_u64(*extension, "seed"); if (!seed || *seed > std::numeric_limits<std::uint32_t>::max()) return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid socioeconomic seed"));
    auto households_json = object_member(*extension, "households", json_type_array); if (!households_json) return std::unexpected(make_error(ErrorCode::serialization_failure, "households array missing"));
    auto people_json = object_member(*extension, "people", json_type_array); if (!people_json) return std::unexpected(make_error(ErrorCode::serialization_failure, "people array missing"));

    HouseholdStore next_households;
    const auto household_count = json_object_array_length(*households_json);
    for (std::size_t i = 0; i < household_count; ++i) {
        auto* item = json_object_array_get_idx(*households_json, i); if (!item || json_object_get_type(item) != json_type_object) return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid household entry"));
        auto id = json_u64(item, "id"); auto weight = json_f64(item, "memberWeight"); auto income = json_i64(item, "income"); auto cash = json_i64(item, "cash"); auto debt = json_i64(item, "debt"); auto vehicles = json_u64(item, "vehicles"); auto dependents = json_u64(item, "dependents");
        if (!id || !weight || !income || !cash || !debt || !vehicles || !dependents || *vehicles > std::numeric_limits<std::uint32_t>::max() || *dependents > std::numeric_limits<std::uint32_t>::max()) return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid household fields"));
        auto inserted = next_households.insert({HouseholdId{*id}, *weight, Money{*income}, Money{*cash}, static_cast<std::uint32_t>(*vehicles), {}, static_cast<std::uint32_t>(*dependents), Money{*debt}}); if (!inserted) return std::unexpected(inserted.error());
    }

    PersonRegistry next_people;
    const auto person_count = json_object_array_length(*people_json);
    for (std::size_t i = 0; i < person_count; ++i) {
        auto* item = json_object_array_get_idx(*people_json, i); if (!item || json_object_get_type(item) != json_type_object) return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid person entry"));
        auto stored_id = json_u64(item, "id"); auto household = json_u64(item, "household"); auto age = json_u64(item, "age"); auto education = json_u64(item, "education"); auto occupation = json_u64(item, "occupation"); auto income = json_i64(item, "income");
        json_object* employed_value = nullptr;
        if (!stored_id || !household || !age || !education || !occupation || !income || !json_object_object_get_ex(item, "employed", &employed_value) || json_object_get_type(employed_value) != json_type_boolean || *age > 130 || *education > std::numeric_limits<std::uint16_t>::max() || *occupation > std::numeric_limits<std::uint16_t>::max()) return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid person fields"));
        auto created = next_people.create({HouseholdId{*household}, static_cast<std::uint16_t>(*age), static_cast<std::uint16_t>(*education), static_cast<std::uint16_t>(*occupation), json_object_get_boolean(employed_value) != 0, Money{*income}}); if (!created) return std::unexpected(created.error());
        if (created->value() != *stored_id) return std::unexpected(make_error(ErrorCode::serialization_failure, "person ids must be dense monotonic in schema v1"));
    }

    seed_ = static_cast<std::uint32_t>(*seed);
    households_ = std::move(next_households);
    people_ = std::move(next_people);
    ledger_.clear();
    firms_ = FirmStore{};
    inventories_ = InventoryStore{};
    freight_ = FreightOrderStore{};
    payroll_accounts_.clear();
    return {};
}

} // namespace civic::socioeconomic
