#pragma once

#include <cstdint>
#include <string>
#include <string_view>

#include <civic/core/Error.hpp>
#include <civic/transport/Transportation.hpp>

namespace civic::transport {

// Save V9 stays the canonical outer envelope. Native transportation is stored as
// an additive top-level field and legacy V9 road/transit state is migrated when
// that field is absent.
[[nodiscard]] Result<void> loadTransportationV9(TransportationEngine& engine, std::string_view save_json, std::uint64_t tick);
[[nodiscard]] Result<std::string> saveTransportationV9(std::string_view canonical_v9_json, const TransportationEngine& engine);
[[nodiscard]] Result<std::string> transportationSnapshotJson(const TransportationSnapshot& snapshot);

} // namespace civic::transport
