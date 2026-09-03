#pragma once

#include <span>
#include <string>
#include <string_view>

#include <civic/core/Error.hpp>
#include <civic/socioeconomic/SocioeconomicRuntime.hpp>

namespace civic::socioeconomic {

[[nodiscard]] Result<FreightOrderId> reserve_freight_order(
    FreightOrderStore& freight,
    InventoryStore& inventories,
    const FreightOrderInput& input);

[[nodiscard]] Result<void> restore_person_registry(
    PersonRegistry& registry,
    std::span<const PersonView> people,
    PersonId requested_next_id);

class SocioeconomicPersistence final {
public:
    [[nodiscard]] static Result<std::string> serialize_v9_extension(
        SocioeconomicRuntime& runtime,
        std::uint64_t tick);

    [[nodiscard]] static Result<SocioeconomicRuntime> restore_v9_extension(
        std::string_view json);
};

} // namespace civic::socioeconomic
