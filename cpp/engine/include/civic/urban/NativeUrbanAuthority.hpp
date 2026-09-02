#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <string_view>

#include "civic/cadastre/Cadastre.hpp"
#include "civic/cadastre/ParcelGeneration.hpp"
#include "civic/core/Error.hpp"
#include "civic/persistence/SaveV9.hpp"
#include "civic/urban/DevelopmentAuthority.hpp"
#include "civic/urban/UrbanFabric.hpp"
#include "civic/urban/Zoning.hpp"

namespace civic {

class NativeUrbanAuthority final {
public:
    NativeUrbanAuthority();
    NativeUrbanAuthority(const NativeUrbanAuthority&) = delete;
    NativeUrbanAuthority& operator=(const NativeUrbanAuthority&) = delete;
    NativeUrbanAuthority(NativeUrbanAuthority&&) = delete;
    NativeUrbanAuthority& operator=(NativeUrbanAuthority&&) = delete;

    [[nodiscard]] static Result<std::unique_ptr<NativeUrbanAuthority>> restoreV9(
        const SaveV9Dto& save);
    [[nodiscard]] static Result<std::unique_ptr<NativeUrbanAuthority>> restoreAuthoritativeV9(
        const SaveV9Dto& save);
    [[nodiscard]] static Result<std::unique_ptr<NativeUrbanAuthority>> rebuildLegacy(
        std::string_view request_json);

    [[nodiscard]] Result<std::string> snapshotJson() const;
    [[nodiscard]] Result<std::string> cadastreJson() const;
    [[nodiscard]] Result<std::string> zoningJson() const;
    [[nodiscard]] Result<std::string> buildingsJson() const;
    [[nodiscard]] Result<std::string> propertyJson() const;
    [[nodiscard]] Result<std::string> patchSaveV9(std::string_view canonical_save_json) const;
    [[nodiscard]] Result<std::string> applyCommand(std::string_view request_json);

    [[nodiscard]] std::uint64_t cadastreHash() const noexcept;
    [[nodiscard]] std::uint64_t urbanHash() const noexcept;

    [[nodiscard]] const cadastre::CadastralGraph& cadastre() const noexcept { return cadastre_; }
    [[nodiscard]] const urban::ZoningStore& zoning() const noexcept { return zoning_; }
    [[nodiscard]] const urban::UrbanFabricStore& buildings() const noexcept { return buildings_; }
    [[nodiscard]] const urban::PropertyMarketSystem& property() const noexcept { return property_; }

private:
    [[nodiscard]] Result<void> restoreCadastre(std::string_view json);
    [[nodiscard]] Result<void> restoreZoning(std::string_view json);
    [[nodiscard]] Result<void> restoreBuildings(std::string_view json);
    [[nodiscard]] Result<void> restoreProperty(std::string_view json);

    cadastre::CadastralGraph cadastre_{};
    std::vector<cadastre::GeneratedUrbanBlock> blocks_{};
    urban::ZoningStore zoning_{};
    urban::UrbanFabricStore buildings_;
    urban::PropertyMarketSystem property_;
};

}  // namespace civic
