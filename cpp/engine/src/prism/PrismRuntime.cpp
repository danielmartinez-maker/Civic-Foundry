#include <civic/prism/PrismRuntime.hpp>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <exception>
#include <future>
#include <mutex>
#include <queue>
#include <thread>
#include <utility>

namespace civic::prism {

Result<std::uint64_t> ImmutableSnapshotRegistry::publish(Snapshot snapshot) {
    if (snapshot.schema_version == 0) return std::unexpected(make_error(ErrorCode::invalid_argument, "snapshot schema version must be non-zero"));
    if (latest_ && snapshot.tick < latest_->tick) return std::unexpected(make_error(ErrorCode::invalid_state, "snapshot tick cannot move backwards"));
    latest_ = std::make_shared<const Snapshot>(std::move(snapshot));
    return ++publication_revision_;
}
std::shared_ptr<const Snapshot> ImmutableSnapshotRegistry::latest() const noexcept { return latest_; }

Result<CausalityTraceId> CausalityTraceStore::begin(EntityMetric outcome, std::uint64_t tick) {
    if (outcome.domain.empty() || outcome.metric.empty()) return std::unexpected(make_error(ErrorCode::invalid_argument, "causality outcome requires domain and metric"));
    const CausalityTraceId id{next_id_++};
    traces_.emplace(id, CausalityTrace{id, std::move(outcome), tick, {}});
    return id;
}
Result<void> CausalityTraceStore::add_contribution(CausalityTraceId id, EntityMetric cause, double contribution, std::string channel) {
    const auto it = traces_.find(id);
    if (it == traces_.end() || cause.domain.empty() || cause.metric.empty() || channel.empty() || !std::isfinite(contribution)) return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid causality contribution"));
    it->second.contributions.push_back({std::move(cause), contribution, std::move(channel)});
    std::ranges::stable_sort(it->second.contributions, [](const auto& a, const auto& b) {
        if (a.cause.domain != b.cause.domain) return a.cause.domain < b.cause.domain;
        if (a.cause.entity != b.cause.entity) return a.cause.entity < b.cause.entity;
        if (a.cause.metric != b.cause.metric) return a.cause.metric < b.cause.metric;
        return a.channel < b.channel;
    });
    return {};
}
std::optional<CausalityTrace> CausalityTraceStore::trace(CausalityTraceId id) const { if (const auto it = traces_.find(id); it != traces_.end()) return it->second; return std::nullopt; }

void PerformanceTelemetry::record(std::string domain_name, DomainPerformance performance) { if (!enabled_ || domain_name.empty()) return; domains_[std::move(domain_name)] = performance; }
std::optional<DomainPerformance> PerformanceTelemetry::domain(std::string_view name) const { const auto it = domains_.find(std::string{name}); if (it == domains_.end()) return std::nullopt; return it->second; }

DeterministicJobSystem::DeterministicJobSystem(std::size_t worker_count) : worker_count_(std::max<std::size_t>(1, worker_count)) {}
Result<std::vector<JobResult>> DeterministicJobSystem::run(std::span<const DerivedJob> jobs) const {
    for (const auto& job : jobs) if (!job.execute) return std::unexpected(make_error(ErrorCode::invalid_argument, "derived job missing executable"));
    std::vector<std::optional<JobResult>> slots(jobs.size());
    std::atomic_size_t cursor{0};
    std::atomic_bool failed{false};
    std::mutex error_mutex;
    std::optional<Error> error;
    const auto worker_total = std::min<std::size_t>(worker_count_, std::max<std::size_t>(1, jobs.size()));
    std::vector<std::jthread> workers;
    workers.reserve(worker_total);
    for (std::size_t worker = 0; worker < worker_total; ++worker) {
        workers.emplace_back([&] {
            while (!failed.load(std::memory_order_relaxed)) {
                const auto index = cursor.fetch_add(1, std::memory_order_relaxed);
                if (index >= jobs.size()) break;
                try {
                    auto result = jobs[index].execute();
                    if (result.canonical_key != jobs[index].canonical_key) {
                        std::scoped_lock lock(error_mutex);
                        error = make_error(ErrorCode::invariant_failure, "derived job changed its canonical key");
                        failed.store(true, std::memory_order_relaxed);
                        break;
                    }
                    slots[index] = std::move(result);
                } catch (const std::exception& ex) {
                    std::scoped_lock lock(error_mutex);
                    error = make_error(ErrorCode::internal_error, ex.what());
                    failed.store(true, std::memory_order_relaxed);
                    break;
                } catch (...) {
                    std::scoped_lock lock(error_mutex);
                    error = make_error(ErrorCode::internal_error, "derived job threw unknown exception");
                    failed.store(true, std::memory_order_relaxed);
                    break;
                }
            }
        });
    }
    workers.clear();
    if (error) return std::unexpected(*error);
    std::vector<JobResult> results;
    results.reserve(slots.size());
    for (auto& slot : slots) {
        if (!slot) return std::unexpected(make_error(ErrorCode::invariant_failure, "derived job did not produce a result"));
        results.push_back(std::move(*slot));
    }
    std::ranges::stable_sort(results, [](const JobResult& a, const JobResult& b) {
        if (a.canonical_key != b.canonical_key) return a.canonical_key < b.canonical_key;
        return a.payload < b.payload;
    });
    return results;
}

Result<void> OrderedDomainExecutor::add(DomainSystem system) {
    if (system.name.empty() || !system.execute || systems_.contains(system.name)) return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid or duplicate domain system"));
    for (const auto& write : system.writes) if (write.empty()) return std::unexpected(make_error(ErrorCode::invalid_argument, "domain write key cannot be empty"));
    systems_.emplace(system.name, std::move(system));
    compiled_ = false;
    levels_.clear();
    return {};
}

bool OrderedDomainExecutor::has_dependency_path(std::string_view from, std::string_view to) const {
    std::set<std::string> visited;
    std::vector<std::string> pending{std::string{to}};
    while (!pending.empty()) {
        auto current = std::move(pending.back()); pending.pop_back();
        if (!visited.insert(current).second) continue;
        if (current == from) return true;
        const auto it = systems_.find(current); if (it == systems_.end()) continue;
        for (const auto& dependency : it->second.dependencies) pending.push_back(dependency);
    }
    return false;
}

Result<void> OrderedDomainExecutor::compile() {
    for (const auto& [name, system] : systems_) {
        for (const auto& dependency : system.dependencies) if (!systems_.contains(dependency)) return std::unexpected(make_error(ErrorCode::invalid_state, "domain dependency missing: " + name + " -> " + dependency));
    }
    for (auto left = systems_.begin(); left != systems_.end(); ++left) {
        for (auto right = std::next(left); right != systems_.end(); ++right) {
            std::vector<std::string> overlap;
            std::set_intersection(left->second.writes.begin(), left->second.writes.end(), right->second.writes.begin(), right->second.writes.end(), std::back_inserter(overlap));
            if (!overlap.empty() && !has_dependency_path(left->first, right->first) && !has_dependency_path(right->first, left->first)) return std::unexpected(make_error(ErrorCode::invalid_state, "unordered authoritative write conflict"));
        }
    }

    std::map<std::string, std::size_t> indegree;
    std::map<std::string, std::vector<std::string>> dependents;
    for (const auto& [name, system] : systems_) {
        indegree[name] = system.dependencies.size();
        for (const auto& dependency : system.dependencies) dependents[dependency].push_back(name);
    }
    std::set<std::string> ready;
    for (const auto& [name, degree] : indegree) if (degree == 0) ready.insert(name);
    std::vector<std::vector<std::string>> next_levels;
    std::size_t visited = 0;
    while (!ready.empty()) {
        std::vector<std::string> level(ready.begin(), ready.end());
        ready.clear();
        visited += level.size();
        next_levels.push_back(level);
        for (const auto& name : level) {
            auto deps = dependents[name];
            std::ranges::sort(deps);
            for (const auto& child : deps) if (--indegree[child] == 0) ready.insert(child);
        }
    }
    if (visited != systems_.size()) return std::unexpected(make_error(ErrorCode::invalid_state, "domain dependency cycle"));
    levels_ = std::move(next_levels);
    compiled_ = true;
    return {};
}

Result<void> OrderedDomainExecutor::execute(DomainState& state, std::size_t worker_count) {
    if (!compiled_) { auto compiled = compile(); if (!compiled) return compiled; }
    const auto workers = std::max<std::size_t>(1, worker_count);
    for (const auto& level : levels_) {
        struct Staged final { std::string name; std::map<std::string, std::int64_t> writes; };
        std::vector<Staged> staged(level.size());
        auto run_one = [&](std::size_t index) -> Result<void> {
            const auto& system = systems_.at(level[index]);
            DomainState local = state;
            try { system.execute(local); }
            catch (const std::exception& ex) { return std::unexpected(make_error(ErrorCode::internal_error, ex.what())); }
            catch (...) { return std::unexpected(make_error(ErrorCode::internal_error, "domain system threw unknown exception")); }
            Staged result{system.name, {}};
            for (const auto& key : system.writes) {
                const auto it = local.find(key);
                if (it == local.end()) return std::unexpected(make_error(ErrorCode::invariant_failure, "domain system failed to stage declared write: " + key));
                result.writes.emplace(key, it->second);
            }
            staged[index] = std::move(result);
            return {};
        };
        if (workers == 1 || level.size() <= 1) {
            for (std::size_t i = 0; i < level.size(); ++i) { auto result = run_one(i); if (!result) return result; }
        } else {
            std::vector<std::future<Result<void>>> futures;
            futures.reserve(level.size());
            for (std::size_t i = 0; i < level.size(); ++i) futures.push_back(std::async(std::launch::async, run_one, i));
            for (auto& future : futures) { auto result = future.get(); if (!result) return result; }
        }
        std::ranges::sort(staged, {}, &Staged::name);
        for (const auto& result : staged) for (const auto& [key, value] : result.writes) state[key] = value;
    }
    return {};
}

std::uint64_t canonical_state_hash(const DomainState& state) noexcept {
    std::uint64_t hash = 14695981039346656037ULL;
    auto mix = [&](std::string_view bytes) { for (const unsigned char byte : bytes) { hash ^= byte; hash *= 1099511628211ULL; } };
    for (const auto& [key, value] : state) { mix(key); mix("="); mix(std::to_string(value)); mix(";"); }
    return hash;
}

} // namespace civic::prism
