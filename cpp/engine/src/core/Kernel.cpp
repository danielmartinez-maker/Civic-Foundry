#include <civic/core/Kernel.hpp>

#include <algorithm>
#include <limits>
#include <numeric>

namespace civic {
namespace {
bool validIdentity(std::string_view value) {
    return utf16_detail::validUtf8AndHasNonEcmaTrimCodePoint(value);
}

bool due(const SystemCadence& cadence, std::uint64_t tick) {
    return cadence.every > 0 && tick >= cadence.offset && ((tick - cadence.offset) % cadence.every) == 0;
}

bool overlap(const SystemCadence& left, const SystemCadence& right) {
    const auto g = std::gcd(left.every, right.every);
    const auto hi = std::max(left.offset, right.offset);
    const auto lo = std::min(left.offset, right.offset);
    return (hi - lo) % g == 0;
}

bool intersects(const std::vector<std::string>& a, const std::vector<std::string>& b) {
    for (const auto& item : a) if (std::find(b.begin(), b.end(), item) != b.end()) return true;
    return false;
}
} // namespace

Result<void> SimulationClock::setSpeed(SpeedMode speed) noexcept {
    if (!validSpeed(static_cast<std::uint32_t>(speed))) return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid clock speed"));
    speed_ = speed;
    return {};
}

Result<void> SimulationClock::step(std::uint64_t ticks) noexcept {
    if (ticks > std::numeric_limits<std::uint64_t>::max() - tick_) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, "clock tick overflow"));
    }
    tick_ += ticks;
    return {};
}

Result<void> CommandQueue::submit(std::span<const CommandEnvelope> commands, std::uint64_t current_tick) {
    (void)current_tick;
    std::set<std::uint64_t> batch;
    for (const auto& command : commands) {
        if (command.sequence == 0 || !batch.insert(command.sequence).second || sequences_.contains(command.sequence)) {
            return std::unexpected(make_error(ErrorCode::invalid_argument, "duplicate command sequence"));
        }
        if (!validIdentity(command.type)) return std::unexpected(make_error(ErrorCode::invalid_argument, "command type must not be empty"));
    }
    for (const auto& command : commands) {
        queue_.push_back(command);
        sequences_.insert(command.sequence);
    }
    std::ranges::sort(queue_, [](const auto& a, const auto& b) { return a.sequence < b.sequence; });
    return {};
}

std::vector<CommandEnvelope> CommandQueue::takeReady(std::uint64_t tick) {
    std::vector<CommandEnvelope> ready;
    std::vector<CommandEnvelope> pending;
    for (auto& command : queue_) {
        if (command.tick <= tick) {
            ready.push_back(std::move(command));
        } else {
            pending.push_back(std::move(command));
        }
    }
    queue_ = std::move(pending);
    std::ranges::sort(ready, [](const auto& a, const auto& b) { return a.sequence < b.sequence; });
    return ready;
}

DomainEvent DomainEventJournal::append(std::uint64_t tick, std::string type, std::string source, std::vector<std::byte> payload) {
    DomainEvent event{next_sequence_++, tick, std::move(type), std::move(source), std::move(payload)};
    events_.push_back(event);
    return event;
}

std::vector<DomainEvent> DomainEventJournal::drain() {
    auto drained = std::move(events_);
    events_.clear();
    return drained;
}

Result<void> SystemScheduler::registerSystem(SystemDefinition system) {
    if (!validIdentity(system.id)) return std::unexpected(make_error(ErrorCode::invalid_argument, "kernel system id must not be empty"));
    if (system.cadence.every == 0 || system.cadence.offset >= system.cadence.every) return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid system cadence"));
    if (systems_.contains(system.id)) return std::unexpected(make_error(ErrorCode::invalid_argument, "duplicate kernel system: " + system.id));
    const auto id = system.id;
    if (std::find(system.after.begin(), system.after.end(), id) != system.after.end() || std::find(system.before.begin(), system.before.end(), id) != system.before.end()) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, "self dependency for kernel system " + id));
    }
    auto hasDuplicates = [](const auto& values) {
        std::set<std::string, std::less<>> seen;
        return std::ranges::any_of(values, [&](const auto& value) { return !seen.insert(value).second; });
    };
    if (hasDuplicates(system.reads) || hasDuplicates(system.writes)) return std::unexpected(make_error(ErrorCode::invalid_argument, "duplicate domain declaration for system " + id));
    if (intersects(system.reads, system.writes)) return std::unexpected(make_error(ErrorCode::invalid_argument, "domain declared as read and write for system " + id));
    systems_.emplace(id, std::move(system));
    compiled_.clear();
    return {};
}

Result<void> SystemScheduler::compile() {
    using Utf16Set = std::set<std::string, Utf16OrdinalLess>;
    std::map<std::string, Utf16Set, Utf16OrdinalLess> outgoing;
    std::map<std::string, std::size_t, Utf16OrdinalLess> indegree;
    for (const auto& entry : systems_) { outgoing[entry.first]; indegree[entry.first] = 0; }
    auto addEdge = [&](const std::string& from, const std::string& to) -> Result<void> {
        if (!systems_.contains(from) || !systems_.contains(to)) return std::unexpected(make_error(ErrorCode::invalid_argument, "unknown kernel dependency: " + from + " -> " + to));
        if (outgoing[from].insert(to).second) ++indegree[to];
        return {};
    };
    for (const auto& [id, system] : systems_) {
        for (const auto& dep : system.after) { auto result = addEdge(dep, id); if (!result) return result; }
        for (const auto& dep : system.before) { auto result = addEdge(id, dep); if (!result) return result; }
    }
    auto reaches = [&](const std::string& start, const std::string& target) {
        std::vector<std::string> stack(outgoing[start].begin(), outgoing[start].end());
        Utf16Set seen;
        while (!stack.empty()) {
            auto current = std::move(stack.back()); stack.pop_back();
            if (current == target) return true;
            if (!seen.insert(current).second) continue;
            const auto& next = outgoing[current]; stack.insert(stack.end(), next.begin(), next.end());
        }
        return false;
    };
    for (auto a = systems_.begin(); a != systems_.end(); ++a) {
        for (auto b = std::next(a); b != systems_.end(); ++b) {
            if (!overlap(a->second.cadence, b->second.cadence)) continue;
            const bool ordered = reaches(a->first, b->first) || reaches(b->first, a->first);
            if (!ordered && intersects(a->second.writes, b->second.writes)) return std::unexpected(make_error(ErrorCode::invalid_state, "ambiguous write conflict: " + a->first + ", " + b->first));
            if (!ordered && (intersects(a->second.writes, b->second.reads) || intersects(b->second.writes, a->second.reads))) return std::unexpected(make_error(ErrorCode::invalid_state, "ambiguous read/write conflict: " + a->first + ", " + b->first));
        }
    }
    const Utf16OrdinalLess ordinal_less{};
    auto priority = [&](const std::string& a, const std::string& b) {
        const auto& sa = systems_.at(a); const auto& sb = systems_.at(b);
        if (sa.order != sb.order) return sa.order < sb.order;
        return ordinal_less(a, b);
    };
    std::vector<std::string> available;
    for (const auto& [id, degree] : indegree) if (degree == 0) available.push_back(id);
    std::ranges::sort(available, priority);
    std::vector<std::string> result;
    while (!available.empty()) {
        auto id = available.front(); available.erase(available.begin()); result.push_back(id);
        for (const auto& next : outgoing[id]) {
            auto& degree = indegree[next];
            --degree;
            if (degree == 0) { available.push_back(next); std::ranges::sort(available, priority); }
        }
    }
    if (result.size() != systems_.size()) return std::unexpected(make_error(ErrorCode::invalid_state, "kernel dependency cycle"));
    compiled_ = std::move(result);
    return {};
}

Result<std::vector<SystemDefinition*>> SystemScheduler::dueSystems(std::uint64_t tick) {
    if (compiled_.empty() && !systems_.empty()) {
        auto compiled = compile();
        if (!compiled) return std::unexpected(compiled.error());
    }
    std::vector<SystemDefinition*> result;
    for (const auto& id : compiled_) if (due(systems_.at(id).cadence, tick)) result.push_back(&systems_.at(id));
    return result;
}

std::vector<std::string> SystemScheduler::orderedIds() const { return compiled_; }

Result<void> InvariantRunner::registerInvariant(InvariantDefinition invariant) {
    if (!validIdentity(invariant.id) || invariant.cadence.every == 0 || invariant.cadence.offset >= invariant.cadence.every || !invariant.check) return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid invariant definition"));
    if (invariants_.contains(invariant.id)) return std::unexpected(make_error(ErrorCode::invalid_argument, "duplicate invariant: " + invariant.id));
    invariants_.emplace(invariant.id, std::move(invariant));
    return {};
}

Result<void> InvariantRunner::runDue(std::uint64_t tick) const {
    for (const auto& [id, invariant] : invariants_) {
        if (!due(invariant.cadence, tick)) continue;
        auto result = invariant.check(tick);
        if (!result) return std::unexpected(make_error(ErrorCode::invariant_failure, id + ": " + result.error().message));
    }
    return {};
}

} // namespace civic
