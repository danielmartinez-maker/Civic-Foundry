#pragma once

#include <string_view>

#include <civic/core/Error.hpp>
#include <civic/transport/transport_engine.hpp>

namespace civic {

[[nodiscard]] Result<transport::TransportationSnapshot> parseTransportationV9(std::string_view canonicalSaveJson);

} // namespace civic
