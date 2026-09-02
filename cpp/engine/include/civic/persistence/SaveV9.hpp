#pragma once

#include <cstdint>
#include <string>
#include <string_view>

#include <civic/core/Error.hpp>
#include <civic/core/Kernel.hpp>

namespace civic {

struct SaveV9Dto final {
    std::uint32_t saveVersion{9};
    std::string gameVersion;
    std::uint32_t seed{};
    std::uint64_t tick{};
    SpeedMode speed{SpeedMode::normal};
    std::string inheritedV8;
    std::string urbanFabric;
    std::string zoningV2;
    std::string buildingsV2;
    std::string propertyMarket;
    std::string canonicalJson;
};

[[nodiscard]] Result<SaveV9Dto> parseSaveV9(std::string_view json);

} // namespace civic
