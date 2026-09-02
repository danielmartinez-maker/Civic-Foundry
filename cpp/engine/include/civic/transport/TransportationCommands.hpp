#pragma once

#include <civic/core/Error.hpp>
#include <civic/core/Kernel.hpp>
#include <civic/persistence/TransportationSaveV9.hpp>
#include <civic/transport/transport_engine.hpp>

namespace civic {

[[nodiscard]] Result<bool> applyTransportationCommand(
    transport::TransportationAuthority& authority,
    LegacyRoadAuthorityV9& legacyRoads,
    const CommandEnvelope& command);

} // namespace civic
