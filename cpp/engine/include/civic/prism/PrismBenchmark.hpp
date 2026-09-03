#pragma once

#include <cstdint>
#include <string_view>

#include <civic/prism/PrismRuntime.hpp>

namespace civic::prism {

struct RepresentativeCityWorkload final {
    std::uint64_t entity_count{};
    std::uint64_t pathfinding_count{};
    std::uint64_t snapshot_bytes{};
    std::uint32_t iterations{1};
};

class RepresentativeCityBenchmark final {
public:
    [[nodiscard]] Result<DomainPerformance> run(
        std::string_view domain,
        const RepresentativeCityWorkload& workload,
        PerformanceTelemetry& telemetry) const;
};

} // namespace civic::prism
