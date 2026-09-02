#include <civic/socioeconomic/SocioeconomicPersistence.hpp>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <map>
#include <optional>
#include <string>
#include <vector>

#include <json-c/json.h>

namespace civic::socioeconomic {
namespace {

struct JsonGuard final {
    json_object* value{};
    ~JsonGuard() { if (value) json_object_put(value); }
};

[[nodiscard]] Result<json_object*> required_member(json_object* object, const char* key, json_type type) {
    json_object* value = nullptr;
    if (!object || !json_object_object_get_ex(object, key, &value) || !value || json_object_get_type(value) != type) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, std::string{"missing or invalid JSON field: "} + key));
    }
    return value;
}

[[nodiscard]] Result<std::uint64_t> required_u64(json_object* object, const char* key) {
    auto value = required_member(object, key, json_type_int);
    if (!value) return std::unexpected(value.error());
    const auto raw = json_object_get_int64(*value);
    if (raw < 0) return std::unexpected(make_error(ErrorCode::serialization_failure, std::string{"negative JSON field: "} + key));
    return static_cast<std::uint64_t>(raw);
}

[[nodiscard]] Result<std::int64_t> required_i64(json_object* object, const char* key) {
    auto value = required_member(object, key, json_type_int);
    if (!value) return std::unexpected(value.error());
    return json_object_get_int64(*value);
}

[[nodiscard]] Result<double> required_double(json_object* object, const char* key) {
    json_object* value = nullptr;
    if (!object || !json_object_object_get_ex(object, key, &value) || !value) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, std::string{"missing numeric JSON field: "} + key));
    }
    const auto type = json_object_get_type(value);
    if (type != json_type_double && type != json_type_int) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, std::string{"invalid numeric JSON field: "} + key));
    }
    const auto raw = json_object_get_double(value);
    if (!std::isfinite(raw)) return std::unexpected(make_error(ErrorCode::serialization_failure, std::string{"non-finite JSON field: "} + key));
    return raw;
}

[[nodiscard]] Result<bool> required_bool(json_object* object, const char* key) {
    auto value = required_member(object, key, json_type_boolean);
    if (!value) return std::unexpected(value.error());
    return json_object_get_boolean(*value) != 0;
}

[[nodiscard]] Result<void> add_u64(json_object* object, const char* key, std::uint64_t value) {
    if (value > static_cast<std::uint64_t>(std::numeric_limits<std::int64_t>::max())) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, std::string{"value exceeds Save V9 signed integer range: "} + key));
    }
    json_object_object_add(object, key, json_object_new_int64(static_cast<std::int64_t>(value)));
    return {};
}

void add_i64(json_object* object, const char* key, std::int64_t value) {
    json_object_object_add(object, key, json_object_new_int64(value));
}

void add_double(json_object* object, const char* key, double value) {
    json_object_object_add(object, key, json_object_new_double(value));
}

void add_bool(json_object* object, const char* key, bool value) {
    json_object_object_add(object, key, json_object_new_boolean(value ? 1 : 0));
}

[[nodiscard]] PersonLifeStage legacy_life_stage_for_age(std::uint16_t age) noexcept {
    if (age < 13) return PersonLifeStage::child;
    if (age < 18) return PersonLifeStage::teen;
    if (age < 65) return PersonLifeStage::adult;
    return PersonLifeStage::senior;
}

[[nodiscard]] std::uint64_t next_person_id_from_snapshot(std::span<const PersonView> people) noexcept {
    std::uint64_t max_id = 0;
    for (const auto& person : people) max_id = std::max(max_id, person.id.value());
    return max_id + 1;
}

[[nodiscard]] Result<void> restore_freight_order(
    FreightOrderStore& store,
    const FreightOrder& saved,
    const InventoryStore& final_inventories) {
    const auto source = final_inventories.get(saved.source);
    const auto destination = final_inventories.get(saved.destination);
    if (!source || !destination || source->product != saved.product || destination->product != saved.product) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "freight order references missing or incompatible inventory"));
    }
    if (saved.created <= 0 || saved.delivered < 0 || saved.returned < 0 || saved.active < 0 || saved.lost < 0 ||
        saved.delivered + saved.returned + saved.active + saved.lost != saved.created) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "freight order violates conservation"));
    }

    auto created = store.create({saved.source, saved.destination, saved.product, saved.created});
    if (!created || *created != saved.id) return std::unexpected(make_error(ErrorCode::serialization_failure, "freight order ids are not canonical dense sequence"));

    InventoryStore dummy;
    auto source_created = dummy.create(saved.source, saved.product, 0, saved.returned);
    if (!source_created) return std::unexpected(source_created.error());
    auto destination_created = dummy.create(saved.destination, saved.product, 0, saved.delivered);
    if (!destination_created) return std::unexpected(destination_created.error());

    if (saved.delivery_attempted) {
        auto delivered = store.deliver(saved.id, saved.created, dummy);
        if (!delivered || delivered->delivered != saved.delivered) {
            return std::unexpected(make_error(ErrorCode::serialization_failure, "freight delivery continuation could not be reconstructed"));
        }
    } else if (saved.delivered != 0) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "freight has delivered cargo without delivery attempt"));
    }

    if (saved.returned > 0) {
        auto returned = store.cancel(saved.id, dummy);
        if (!returned || returned->returned != saved.returned) {
            return std::unexpected(make_error(ErrorCode::serialization_failure, "freight return continuation could not be reconstructed"));
        }
    }

    if (saved.lost > 0) {
        auto loss = store.record_modeled_loss(saved.id, saved.lost);
        if (!loss) return std::unexpected(loss.error());
    }

    const auto reconstructed = store.get(saved.id);
    if (!reconstructed || reconstructed->created != saved.created || reconstructed->delivered != saved.delivered ||
        reconstructed->returned != saved.returned || reconstructed->active != saved.active || reconstructed->lost != saved.lost ||
        reconstructed->delivery_attempted != saved.delivery_attempted || reconstructed->state != saved.state) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "freight lifecycle state cannot be reconstructed exactly"));
    }
    return {};
}

} // namespace

Result<FreightOrderId> reserve_freight_order(
    FreightOrderStore& freight,
    InventoryStore& inventories,
    const FreightOrderInput& input) {
    if (input.quantity <= 0) return std::unexpected(make_error(ErrorCode::invalid_argument, "freight reservation quantity must be positive"));
    const auto source = inventories.get(input.source);
    const auto destination = inventories.get(input.destination);
    if (!source || !destination || source->product != input.product || destination->product != input.product) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, "freight reservation inventory/product mismatch"));
    }
    if (source->quantity < input.quantity) return std::unexpected(make_error(ErrorCode::invalid_state, "freight reservation exceeds source inventory"));

    auto consumed = inventories.consume(input.source, input.quantity);
    if (!consumed) return std::unexpected(consumed.error());
    auto created = freight.create(input);
    if (created) return *created;

    auto rollback = inventories.receive(input.source, input.quantity);
    if (!rollback || rollback->accepted != input.quantity || rollback->rejected != 0) {
        return std::unexpected(make_error(ErrorCode::invariant_failure, "failed freight reservation could not restore source inventory"));
    }
    return std::unexpected(created.error());
}

Result<void> restore_person_registry(
    PersonRegistry& registry,
    std::span<const PersonView> people,
    PersonId requested_next_id) {
    if (registry.size() != 0 || requested_next_id.value() == 0) {
        return std::unexpected(make_error(ErrorCode::invalid_state, "person restore requires pristine registry and positive next id"));
    }
    std::vector<PersonView> sorted(people.begin(), people.end());
    std::ranges::sort(sorted, {}, &PersonView::id);
    for (std::size_t i = 1; i < sorted.size(); ++i) {
        if (sorted[i - 1].id == sorted[i].id) return std::unexpected(make_error(ErrorCode::serialization_failure, "duplicate restored person id"));
    }
    if (!sorted.empty() && requested_next_id.value() <= sorted.back().id.value()) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "person next id must exceed every live id"));
    }

    std::size_t live_index = 0;
    for (std::uint64_t expected = 1; expected < requested_next_id.value(); ++expected) {
        const bool live = live_index < sorted.size() && sorted[live_index].id.value() == expected;
        PersonInput input{};
        if (live) {
            const auto& person = sorted[live_index];
            if (!person.alive) return std::unexpected(make_error(ErrorCode::serialization_failure, "person snapshot contains non-live record"));
            input = {person.household, person.age, person.education, person.occupation, person.employed, person.income};
            input.resident = person.resident;
            input.life_stage = person.life_stage;
            input.provenance = person.provenance;
            input.home_entity = person.home_entity;
            input.location = person.location;
        } else {
            input = {HouseholdId{1}, 0, 0, 0, false, Money{0}};
        }
        auto created = registry.create(input);
        if (!created || created->value() != expected) return std::unexpected(make_error(ErrorCode::serialization_failure, "person allocator restore diverged"));
        if (!live) {
            auto erased = registry.erase(*created);
            if (!erased) return std::unexpected(erased.error());
        } else {
            ++live_index;
        }
    }
    if (live_index != sorted.size()) return std::unexpected(make_error(ErrorCode::serialization_failure, "person restore left unreachable ids"));
    return {};
}

Result<std::string> SocioeconomicPersistence::serialize_v9_extension(
    SocioeconomicRuntime& runtime,
    std::uint64_t tick) {
    if (tick > static_cast<std::uint64_t>(std::numeric_limits<std::int64_t>::max())) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "tick exceeds Save V9 integer range"));
    }

    JsonGuard root{json_object_new_object()};
    if (!root.value) return std::unexpected(make_error(ErrorCode::internal_error, "failed to allocate socioeconomic save object"));
    auto save_version = add_u64(root.value, "saveVersion", 9); if (!save_version) return std::unexpected(save_version.error());
    json_object* extension = json_object_new_object();
    json_object_object_add(root.value, "nativeSocioeconomic", extension);
    auto schema = add_u64(extension, "schemaVersion", 3); if (!schema) return std::unexpected(schema.error());
    auto seed = add_u64(extension, "seed", runtime.seed()); if (!seed) return std::unexpected(seed.error());
    auto saved_tick = add_u64(extension, "tick", tick); if (!saved_tick) return std::unexpected(saved_tick.error());

    json_object* firms = json_object_new_array();
    for (const auto& firm : runtime.firms().snapshot()) {
        json_object* item = json_object_new_object();
        add_u64(item, "id", firm.id.value());
        add_u64(item, "sector", firm.sector.value());
        add_u64(item, "location", firm.location.value());
        add_double(item, "employment", firm.employment);
        add_i64(item, "cash", firm.cash.minor_units());
        add_i64(item, "debt", firm.debt.minor_units());
        add_u64(item, "lifecycle", static_cast<std::uint64_t>(firm.lifecycle));
        json_object* inventory_refs = json_object_new_array();
        for (const auto inventory : firm.inventories) json_object_array_add(inventory_refs, json_object_new_int64(static_cast<std::int64_t>(inventory.value())));
        json_object_object_add(item, "inventories", inventory_refs);
        json_object_array_add(firms, item);
    }
    json_object_object_add(extension, "firms", firms);
    add_u64(extension, "nextFirmId", runtime.firms().next_id().value());

    json_object* inventories = json_object_new_array();
    for (const auto& inventory : runtime.inventories().snapshot()) {
        json_object* item = json_object_new_object();
        add_u64(item, "id", inventory.id.value());
        add_u64(item, "product", inventory.product.value());
        add_i64(item, "quantity", inventory.quantity);
        add_i64(item, "capacity", inventory.capacity);
        json_object_array_add(inventories, item);
    }
    json_object_object_add(extension, "inventories", inventories);

    const auto freight_snapshot = runtime.freight().snapshot();
    json_object* freight = json_object_new_array();
    for (const auto& order : freight_snapshot) {
        json_object* item = json_object_new_object();
        add_u64(item, "id", order.id.value());
        add_u64(item, "source", order.source.value());
        add_u64(item, "destination", order.destination.value());
        add_u64(item, "product", order.product.value());
        add_i64(item, "created", order.created);
        add_i64(item, "delivered", order.delivered);
        add_i64(item, "returned", order.returned);
        add_i64(item, "active", order.active);
        add_i64(item, "lost", order.lost);
        add_u64(item, "state", static_cast<std::uint64_t>(order.state));
        add_bool(item, "deliveryAttempted", order.delivery_attempted);
        json_object_array_add(freight, item);
    }
    json_object_object_add(extension, "freightOrders", freight);

    const auto households_snapshot = runtime.households().snapshot();
    json_object* households = json_object_new_array();
    for (const auto& household : households_snapshot) {
        json_object* item = json_object_new_object();
        add_u64(item, "id", household.id.value());
        add_double(item, "memberWeight", household.member_weight);
        add_i64(item, "income", household.income.minor_units());
        add_i64(item, "cash", household.cash.minor_units());
        add_i64(item, "debt", household.debt.minor_units());
        add_u64(item, "vehicles", household.vehicle_count);
        add_u64(item, "dependents", household.dependents);
        add_u64(item, "preferences", household.preference_flags);
        add_u64(item, "relocationConstraints", household.relocation_constraint_flags);
        if (household.home) add_u64(item, "home", household.home->value());
        else json_object_object_add(item, "home", json_object_new_null());
        json_object_array_add(households, item);
    }
    json_object_object_add(extension, "households", households);

    const auto people_snapshot = runtime.people().snapshot();
    json_object* people = json_object_new_array();
    for (const auto& person : people_snapshot) {
        json_object* item = json_object_new_object();
        add_u64(item, "id", person.id.value());
        add_u64(item, "household", person.household.value());
        add_u64(item, "age", person.age);
        add_u64(item, "education", person.education);
        add_u64(item, "occupation", person.occupation);
        add_bool(item, "employed", person.employed);
        add_i64(item, "income", person.income.minor_units());
        add_bool(item, "resident", person.resident);
        add_u64(item, "lifeStage", static_cast<std::uint64_t>(person.life_stage));
        add_u64(item, "provenance", static_cast<std::uint64_t>(person.provenance));
        if (person.home_entity) {
            auto added = add_u64(item, "homeEntity", person.home_entity->value());
            if (!added) return std::unexpected(added.error());
        } else {
            json_object_object_add(item, "homeEntity", json_object_new_null());
        }
        if (person.location) {
            add_u64(item, "locationKind", static_cast<std::uint64_t>(person.location->kind));
            auto added = add_u64(item, "locationEntity", person.location->entity.value());
            if (!added) return std::unexpected(added.error());
        } else {
            json_object_object_add(item, "locationKind", json_object_new_null());
            json_object_object_add(item, "locationEntity", json_object_new_null());
        }
        json_object_array_add(people, item);
    }
    json_object_object_add(extension, "people", people);
    const auto next_person_id = std::max(runtime.people().next_id().value(), next_person_id_from_snapshot(people_snapshot));
    add_u64(extension, "nextPersonId", next_person_id);

    json_object* ledger = json_object_new_array();
    for (const auto& entry : runtime.ledger().entries()) {
        json_object* item = json_object_new_object();
        add_u64(item, "sequence", entry.sequence);
        add_u64(item, "debit", entry.debit.value());
        add_u64(item, "credit", entry.credit.value());
        add_i64(item, "amount", entry.amount.minor_units());
        add_u64(item, "tick", entry.tick);
        add_u64(item, "reason", static_cast<std::uint64_t>(entry.reason));
        add_u64(item, "source", entry.source.value());
        json_object_array_add(ledger, item);
    }
    json_object_object_add(extension, "ledger", ledger);

    const char* encoded = json_object_to_json_string_ext(root.value, JSON_C_TO_STRING_PLAIN);
    if (!encoded) return std::unexpected(make_error(ErrorCode::serialization_failure, "failed to encode socioeconomic save"));
    return std::string{encoded};
}

Result<SocioeconomicRuntime> SocioeconomicPersistence::restore_v9_extension(std::string_view json) {
    json_tokener* tokener = json_tokener_new();
    if (!tokener) return std::unexpected(make_error(ErrorCode::internal_error, "json tokener allocation failed"));
    json_object* root_value = json_tokener_parse_ex(tokener, json.data(), static_cast<int>(json.size()));
    const auto parse_error = json_tokener_get_error(tokener);
    json_tokener_free(tokener);
    JsonGuard root{root_value};
    if (parse_error != json_tokener_success || !root.value || json_object_get_type(root.value) != json_type_object) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid socioeconomic Save V9 JSON"));
    }

    auto save_version = required_u64(root.value, "saveVersion");
    if (!save_version || *save_version != 9) return std::unexpected(make_error(ErrorCode::unsupported_save_version, "socioeconomic persistence requires Save V9"));
    auto extension = required_member(root.value, "nativeSocioeconomic", json_type_object); if (!extension) return std::unexpected(extension.error());
    auto schema = required_u64(*extension, "schemaVersion");
    if (!schema || (*schema != 2 && *schema != 3)) return std::unexpected(make_error(ErrorCode::serialization_failure, "unsupported native socioeconomic schema"));
    auto seed = required_u64(*extension, "seed");
    if (!seed || *seed > std::numeric_limits<std::uint32_t>::max()) return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid socioeconomic seed"));

    SocioeconomicRuntime runtime{static_cast<std::uint32_t>(*seed)};

    auto inventories_json = required_member(*extension, "inventories", json_type_array); if (!inventories_json) return std::unexpected(inventories_json.error());
    std::vector<InventoryRecord> inventory_records;
    for (std::size_t i = 0; i < json_object_array_length(*inventories_json); ++i) {
        auto* item = json_object_array_get_idx(*inventories_json, i);
        if (!item || json_object_get_type(item) != json_type_object) return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid inventory entry"));
        auto id = required_u64(item, "id"); auto product = required_u64(item, "product"); auto quantity = required_i64(item, "quantity"); auto capacity = required_i64(item, "capacity");
        if (!id || !product || !quantity || !capacity) return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid inventory fields"));
        inventory_records.push_back({InventoryId{*id}, ProductRuntimeId{static_cast<std::uint32_t>(*product)}, *quantity, *capacity});
    }
    auto restored_inventories = runtime.inventories().restore(inventory_records); if (!restored_inventories) return std::unexpected(restored_inventories.error());

    auto firms_json = required_member(*extension, "firms", json_type_array); if (!firms_json) return std::unexpected(firms_json.error());
    std::vector<Firm> firms;
    for (std::size_t i = 0; i < json_object_array_length(*firms_json); ++i) {
        auto* item = json_object_array_get_idx(*firms_json, i);
        if (!item || json_object_get_type(item) != json_type_object) return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid firm entry"));
        auto id = required_u64(item, "id"); auto sector = required_u64(item, "sector"); auto location = required_u64(item, "location");
        auto employment = required_double(item, "employment"); auto cash = required_i64(item, "cash"); auto debt = required_i64(item, "debt"); auto lifecycle = required_u64(item, "lifecycle");
        auto refs = required_member(item, "inventories", json_type_array);
        if (!id || !sector || !location || !employment || !cash || !debt || !lifecycle || !refs || *sector > std::numeric_limits<std::uint32_t>::max() || *lifecycle > static_cast<std::uint64_t>(FirmLifecycleState::closed)) {
            return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid firm fields"));
        }
        Firm firm{};
        firm.id = FirmId{*id}; firm.sector = SectorRuntimeId{static_cast<std::uint32_t>(*sector)}; firm.location = BuildingId{*location}; firm.employment = *employment; firm.cash = Money{*cash}; firm.debt = Money{*debt}; firm.lifecycle = static_cast<FirmLifecycleState>(*lifecycle);
        for (std::size_t r = 0; r < json_object_array_length(*refs); ++r) {
            auto* ref = json_object_array_get_idx(*refs, r);
            if (!ref || json_object_get_type(ref) != json_type_int || json_object_get_int64(ref) <= 0) return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid firm inventory reference"));
            const InventoryId inventory{static_cast<std::uint64_t>(json_object_get_int64(ref))};
            if (!runtime.inventories().get(inventory)) return std::unexpected(make_error(ErrorCode::serialization_failure, "firm references missing inventory"));
            firm.inventories.push_back(inventory);
        }
        firms.push_back(std::move(firm));
    }
    auto next_firm = required_u64(*extension, "nextFirmId"); if (!next_firm) return std::unexpected(next_firm.error());
    auto restored_firms = runtime.firms().restore(firms, FirmId{*next_firm}); if (!restored_firms) return std::unexpected(restored_firms.error());

    auto households_json = required_member(*extension, "households", json_type_array); if (!households_json) return std::unexpected(households_json.error());
    for (std::size_t i = 0; i < json_object_array_length(*households_json); ++i) {
        auto* item = json_object_array_get_idx(*households_json, i);
        if (!item || json_object_get_type(item) != json_type_object) return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid household entry"));
        auto id = required_u64(item, "id"); auto member_weight = required_double(item, "memberWeight"); auto income = required_i64(item, "income"); auto cash = required_i64(item, "cash"); auto debt = required_i64(item, "debt");
        auto vehicles = required_u64(item, "vehicles"); auto dependents = required_u64(item, "dependents"); auto preferences = required_u64(item, "preferences"); auto relocation = required_u64(item, "relocationConstraints");
        if (!id || !member_weight || !income || !cash || !debt || !vehicles || !dependents || !preferences || !relocation || *vehicles > std::numeric_limits<std::uint32_t>::max() || *dependents > std::numeric_limits<std::uint32_t>::max() || *preferences > std::numeric_limits<std::uint32_t>::max() || *relocation > std::numeric_limits<std::uint32_t>::max()) {
            return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid household fields"));
        }
        Household household{};
        household.id = HouseholdId{*id}; household.member_weight = *member_weight; household.income = Money{*income}; household.cash = Money{*cash}; household.debt = Money{*debt}; household.vehicle_count = static_cast<std::uint32_t>(*vehicles); household.dependents = static_cast<std::uint32_t>(*dependents); household.preference_flags = static_cast<std::uint32_t>(*preferences); household.relocation_constraint_flags = static_cast<std::uint32_t>(*relocation);
        json_object* home = nullptr;
        if (!json_object_object_get_ex(item, "home", &home)) return std::unexpected(make_error(ErrorCode::serialization_failure, "household home field missing"));
        if (home != nullptr) {
            if (json_object_get_type(home) == json_type_int) {
                const auto raw_home = json_object_get_int64(home);
                if (raw_home <= 0) return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid household home id"));
                household.home = HousingUnitId{static_cast<std::uint64_t>(raw_home)};
            } else if (json_object_get_type(home) != json_type_null) {
                return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid household home field"));
            }
        }
        auto inserted = runtime.households().insert(household); if (!inserted) return std::unexpected(inserted.error());
    }

    auto people_json = required_member(*extension, "people", json_type_array); if (!people_json) return std::unexpected(people_json.error());
    std::vector<PersonView> people;
    for (std::size_t i = 0; i < json_object_array_length(*people_json); ++i) {
        auto* item = json_object_array_get_idx(*people_json, i);
        if (!item || json_object_get_type(item) != json_type_object) return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid person entry"));
        auto id = required_u64(item, "id"); auto household = required_u64(item, "household"); auto age = required_u64(item, "age"); auto education = required_u64(item, "education"); auto occupation = required_u64(item, "occupation"); auto employed = required_bool(item, "employed"); auto income = required_i64(item, "income");
        if (!id || !household || !age || !education || !occupation || !employed || !income || *age > 130 || *education > std::numeric_limits<std::uint16_t>::max() || *occupation > std::numeric_limits<std::uint16_t>::max() || !runtime.households().get(HouseholdId{*household})) {
            return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid person fields or household reference"));
        }
        PersonView person{PersonId{*id}, HouseholdId{*household}, static_cast<std::uint16_t>(*age), static_cast<std::uint16_t>(*education), static_cast<std::uint16_t>(*occupation), *employed, Money{*income}, true};
        if (*schema >= 3) {
            auto resident = required_bool(item, "resident");
            auto life_stage = required_u64(item, "lifeStage");
            auto provenance = required_u64(item, "provenance");
            if (!resident || !life_stage || !provenance || *life_stage > static_cast<std::uint64_t>(PersonLifeStage::senior) || *provenance > static_cast<std::uint64_t>(PersonHistoryProvenance::imported_fact)) {
                return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid person lifecycle state"));
            }
            person.resident = *resident;
            person.life_stage = static_cast<PersonLifeStage>(*life_stage);
            person.provenance = static_cast<PersonHistoryProvenance>(*provenance);

            json_object* home_entity = nullptr;
            if (!json_object_object_get_ex(item, "homeEntity", &home_entity) || !home_entity) {
                return std::unexpected(make_error(ErrorCode::serialization_failure, "person homeEntity field missing"));
            }
            if (json_object_get_type(home_entity) == json_type_int) {
                const auto raw = json_object_get_int64(home_entity);
                if (raw <= 0) return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid person homeEntity"));
                person.home_entity = EntityId{static_cast<std::uint64_t>(raw)};
            } else if (json_object_get_type(home_entity) != json_type_null) {
                return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid person homeEntity"));
            }

            json_object* location_kind = nullptr;
            json_object* location_entity = nullptr;
            if (!json_object_object_get_ex(item, "locationKind", &location_kind) || !location_kind ||
                !json_object_object_get_ex(item, "locationEntity", &location_entity) || !location_entity) {
                return std::unexpected(make_error(ErrorCode::serialization_failure, "person location fields missing"));
            }
            if (json_object_get_type(location_kind) == json_type_int) {
                if (json_object_get_type(location_entity) != json_type_int) return std::unexpected(make_error(ErrorCode::serialization_failure, "person location entity missing"));
                const auto kind = json_object_get_int64(location_kind);
                const auto entity = json_object_get_int64(location_entity);
                if (kind < 0 || kind > static_cast<std::int64_t>(PersonLocationKind::network) || entity <= 0) {
                    return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid person location"));
                }
                person.location = PersonLocation{static_cast<PersonLocationKind>(kind), EntityId{static_cast<std::uint64_t>(entity)}};
            } else if (json_object_get_type(location_kind) != json_type_null || json_object_get_type(location_entity) != json_type_null) {
                return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid person location nullability"));
            }
        } else {
            person.resident = true;
            person.life_stage = legacy_life_stage_for_age(person.age);
            person.provenance = PersonHistoryProvenance::bootstrap_background;
        }
        people.push_back(std::move(person));
    }
    auto next_person = required_u64(*extension, "nextPersonId"); if (!next_person) return std::unexpected(next_person.error());
    auto restored_people = restore_person_registry(runtime.people(), people, PersonId{*next_person}); if (!restored_people) return std::unexpected(restored_people.error());

    auto ledger_json = required_member(*extension, "ledger", json_type_array); if (!ledger_json) return std::unexpected(ledger_json.error());
    std::uint64_t expected_sequence = 1;
    for (std::size_t i = 0; i < json_object_array_length(*ledger_json); ++i) {
        auto* item = json_object_array_get_idx(*ledger_json, i);
        if (!item || json_object_get_type(item) != json_type_object) return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid ledger entry"));
        auto sequence = required_u64(item, "sequence"); auto debit = required_u64(item, "debit"); auto credit = required_u64(item, "credit"); auto amount = required_i64(item, "amount"); auto entry_tick = required_u64(item, "tick"); auto reason = required_u64(item, "reason"); auto source = required_u64(item, "source");
        if (!sequence || !debit || !credit || !amount || !entry_tick || !reason || !source || *sequence != expected_sequence++ || *reason > static_cast<std::uint64_t>(LedgerReason::transfer)) {
            return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid ledger fields or sequence"));
        }
        auto posted = runtime.ledger().transfer(AccountId{*debit}, AccountId{*credit}, Money{*amount}, *entry_tick, static_cast<LedgerReason>(*reason), EntityId{*source});
        if (!posted) return std::unexpected(posted.error());
    }
    auto reconciliation = runtime.ledger().reconcile(); if (!reconciliation) return std::unexpected(reconciliation.error());

    auto freight_json = required_member(*extension, "freightOrders", json_type_array); if (!freight_json) return std::unexpected(freight_json.error());
    for (std::size_t i = 0; i < json_object_array_length(*freight_json); ++i) {
        auto* item = json_object_array_get_idx(*freight_json, i);
        if (!item || json_object_get_type(item) != json_type_object) return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid freight order entry"));
        auto id = required_u64(item, "id"); auto source = required_u64(item, "source"); auto destination = required_u64(item, "destination"); auto product = required_u64(item, "product"); auto created = required_i64(item, "created"); auto delivered = required_i64(item, "delivered"); auto returned = required_i64(item, "returned"); auto active = required_i64(item, "active"); auto lost = required_i64(item, "lost"); auto state = required_u64(item, "state"); auto attempted = required_bool(item, "deliveryAttempted");
        if (!id || !source || !destination || !product || !created || !delivered || !returned || !active || !lost || !state || !attempted || *product > std::numeric_limits<std::uint32_t>::max() || *state > static_cast<std::uint64_t>(FreightOrderState::lost)) {
            return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid freight order fields"));
        }
        FreightOrder saved{FreightOrderId{*id}, InventoryId{*source}, InventoryId{*destination}, ProductRuntimeId{static_cast<std::uint32_t>(*product)}, *created, *delivered, *returned, *active, *lost, static_cast<FreightOrderState>(*state), *attempted};
        auto restored = restore_freight_order(runtime.freight(), saved, runtime.inventories()); if (!restored) return std::unexpected(restored.error());
    }

    return runtime;
}

} // namespace civic::socioeconomic
