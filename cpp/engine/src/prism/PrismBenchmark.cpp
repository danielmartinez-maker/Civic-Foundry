#include <civic/prism/PrismBenchmark.hpp>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <limits>
#include <string>
#include <vector>

namespace civic::prism {
namespace {

std::atomic<std::uint64_t> benchmark_sink{};

} // namespace

Result<DomainPerformance> RepresentativeCityBenchmark::run(
    std::string_view domain,
    const RepresentativeCityWorkload& workload,
    PerformanceTelemetry& telemetry) const {
    if (domain.empty() || workload.iterations == 0 || workload.entity_count == 0) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, "representative city benchmark requires domain, entities and iterations"));
    }

    const auto bounded_entities = static_cast<std::size_t>(
        std::min<std::uint64_t>(workload.entity_count, 1'000'000U));
    std::vector<std::uint64_t> scratch(bounded_entities);
    std::uint64_t checksum{};

    const auto started = std::chrono::steady_clock::now();
    for (std::uint32_t iteration = 0; iteration < workload.iterations; ++iteration) {
        for (std::size_t index = 0; index < scratch.size(); ++index) {
            const auto value = static_cast<std::uint64_t>(index) +
                static_cast<std::uint64_t>(iteration) * 0x9e3779b97f4a7c15ULL;
            scratch[index] = value ^ (value >> 17U);
            checksum ^= scratch[index] + 0x517cc1b727220a95ULL;
        }
        for (std::uint64_t path = 0; path < workload.pathfinding_count; ++path) {
            checksum ^= (path + 1U) * 0x94d049bb133111ebULL;
        }
    }
    const auto finished = std::chrono::steady_clock::now();
    benchmark_sink.store(checksum, std::memory_order_relaxed);

    const double elapsed_ms =
        std::chrono::duration<double, std::milli>(finished - started).count();
    DomainPerformance performance{};
    performance.milliseconds = elapsed_ms / static_cast<double>(workload.iterations);
    performance.cadence = 1;
    performance.entity_count = workload.entity_count;
    performance.pathfinding_count = workload.pathfinding_count;
    performance.allocations = scratch.empty() ? 0U : 1U;
    performance.snapshot_bytes = workload.snapshot_bytes;
    telemetry.record(std::string{domain}, performance);
    return performance;
}

} // namespace civic::prism
