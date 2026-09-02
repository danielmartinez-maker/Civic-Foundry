#include "civic/urban/NativeUrbanAuthority.hpp"

#include <utility>

namespace civic {

Result<std::unique_ptr<NativeUrbanAuthority>> NativeUrbanAuthority::cloneForTransaction() const {
    SaveV9Dto dto{};

    auto cadastre = cadastreJson();
    if (!cadastre) return std::unexpected(cadastre.error());
    dto.urbanFabric = std::move(*cadastre);

    auto zoning = zoningJson();
    if (!zoning) return std::unexpected(zoning.error());
    dto.zoningV2 = std::move(*zoning);

    auto buildings = buildingsJson();
    if (!buildings) return std::unexpected(buildings.error());
    dto.buildingsV2 = std::move(*buildings);

    auto property = propertyJson();
    if (!property) return std::unexpected(property.error());
    dto.propertyMarket = std::move(*property);

    auto clone = restoreAuthoritativeV9(dto);
    if (!clone) return std::unexpected(clone.error());
    (*clone)->inheritRuntimeContext(*this);
    return clone;
}

}  // namespace civic
