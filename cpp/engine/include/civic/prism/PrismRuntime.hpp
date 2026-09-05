#pragma once

#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <span>
#include <string>
#include <string_view>
#include <vector>

#include <civic/core/Error.hpp>
#include <civic/core/StrongId.hpp>

namespace civic::prism {

struct Snapshot final {
    std::uint64_t tick{};
    std::uint32_t schema_version{1};
    std::map<std::string, std::uint64_t> domain_revisions;
    std::string payload;
};

class ImmutableSnapshotRegistry final {
public:
    [[nodiscard]] Result<std::uint64_t> publish(Snapshot snapshot);
    [[nodiscard]] std::shared_ptr<const Snapshot> latest() const noexcept;
    [[nodiscard]] std::uint64_t publication_revision() const noexcept { return publication_revision_; }
private:
    std::shared_ptr<const Snapshot> latest_;
    std::uint64_t publication_revision_{};
};

struct CausalityTraceTag;
using CausalityTraceId = StrongId<CausalityTraceTag>;
struct EntityMetric final {
    std::string domain;
    std::uint64_t entity{};
    std::string metric;
};
struct CausalContribution final {
    EntityMetric cause;
    double contribution{};
    std::string channel;
};
struct CausalityTrace final {
    CausalityTraceId id{0};
    EntityMetric outcome;
    std::uint64_t tick{};
    std::vector<CausalContribution> contributions;
};
class CausalityTraceStore final {
public:
    [[nodiscard]] Result<CausalityTraceId> begin(EntityMetric outcome, std::uint64_t tick);
    [[nodiscard]] Result<void> add_contribution(CausalityTraceId id, EntityMetric cause, double contribution, std::string channel);
    [[nodiscard]] std::optional<CausalityTrace> trace(CausalityTraceId id) const;
private:
    std::uint64_t next_id_{1};
    std::map<CausalityTraceId, CausalityTrace> traces_;
};

struct DomainPerformance final {
    double milliseconds{};
    std::uint64_t cadence{};
    std::uint64_t entity_count{};
    std::uint64_t pathfinding_count{};
    std::uint64_t cache_hits{};
    std::uint64_t cache_misses{};
    std::uint64_t allocations{};
    std::uint64_t snapshot_bytes{};
    double save_load_milliseconds{};
};
class PerformanceTelemetry final {
public:
    void set_enabled(bool enabled) noexcept { enabled_ = enabled; }
    [[nodiscard]] bool enabled() const noexcept { return enabled_; }
    void record(std::string domain, DomainPerformance performance);
    [[nodiscard]] std::optional<DomainPerformance> domain(std::string_view name) const;
private:
    bool enabled_{true};
    std::map<std::string, DomainPerformance> domains_;
};

struct JobResult final { std::uint64_t canonical_key{}; std::string payload; };
struct DerivedJob final {
    std::uint64_t canonical_key{};
    std::uint64_t input_revision{};
    std::function<JobResult()> execute;
};
class DeterministicJobSystem final {
public:
    explicit DeterministicJobSystem(std::size_t worker_count);
    [[nodiscard]] Result<std::vector<JobResult>> run(std::span<const DerivedJob> jobs) const;
    [[nodiscard]] std::size_t worker_count() const noexcept { return worker_count_; }
private:
    std::size_t worker_count_{1};
};

using DomainState = std::map<std::string, std::int64_t>;
struct DomainSystem final {
    std::string name;
    std::vector<std::string> dependencies;
    std::set<std::string> reads;
    std::set<std::string> writes;
    std::function<void(DomainState&)> execute;
};
class OrderedDomainExecutor final {
public:
    [[nodiscard]] Result<void> add(DomainSystem system);
    [[nodiscard]] Result<void> compile();
    [[nodiscard]] Result<void> execute(DomainState& state, std::size_t worker_count);
private:
    [[nodiscard]] bool has_dependency_path(std::string_view from, std::string_view to) const;
    std::map<std::string, DomainSystem> systems_;
    std::vector<std::vector<std::string>> levels_;
    bool compiled_{};
};

[[nodiscard]] std::uint64_t canonical_state_hash(const DomainState& state) noexcept;

} // namespace civic::prism
