#include <civic/core/Kernel.hpp>

#include <algorithm>
#include <limits>
#include <numeric>

namespace civic {
namespace {
bool validIdentity(std::string_view value) {
    return utf16_detail::validUtf8AndHasNonEcmaTrimCodePoint(value);
}

bool overlap(const SystemCadence& left, const SystemCadence& right) {
    const auto g = std::gcd(left.every, right.every);
    const auto hi = std::max(left.offset, right.offset);
    const auto lo = std::min(left.offset, right.offset);
    return (hi - lo) % g == 0;
}

const std::string* firstIntersection(const std::vector<std::string>& a, const std::vector<std::string>& b) {
    for (const auto& item : a) {
        if (std::find(b.begin(), b.end(), item) != b.end()) return &item;
    }
    return nullptr;
}

const std::string* firstDuplicate(const std::vector<std::string>& values) {
    std::set<std::string, std::less<>> seen;
    for (const auto& value : values) {
        if (!seen.insert(value).second) return &value;
    }
    return nullptr;
}
} // namespace

Result<void> validateCadence(const SystemCadence& cadence, std::string_view owner) {
    if (cadence.every == 0 || cadence.offset >= cadence.every) {
        return std::unexpected(make_error(
            ErrorCode::invalid_argument,
            "invalid cadence for " + std::string(owner)
        ));
    }
    return {};
}

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

Result<std::uint64_t> CommandQueue::enqueue(
    std::uint64_t enqueued_tick,
    std::string type,
    std::vector<std::byte> payload
) {
    if (!validIdentity(type)) return std::unexpected(make_error(ErrorCode::invalid_argument, "command type must not be empty"));
    if (next_sequence_ == 0 || next_sequence_ == std::numeric_limits<std::uint64_t>::max()) {
        return std::unexpected(make_error(ErrorCode::invalid_state, "command sequence exhausted"));
    }

    const auto sequence = next_sequence_;
    ++next_sequence_;
    queue_.push_back(CommandEnvelope{sequence, enqueued_tick, std::move(type), std::move(payload)});
    sequences_.insert(sequence);
    return sequence;
}

Result<void> CommandQueue::submit(std::span<const CommandEnvelope> commands, std::uint64_t current_tick) {
    (void)current_tick;
    std::set<std::uint64_t> batch;
    auto next_sequence = next_sequence_;
    for (const auto& command : commands) {
        if (command.version != command_protocol_version) {
            return std::unexpected(make_error(ErrorCode::invalid_argument, "unsupported command envelope version"));
        }
        if (command.sequence == 0 || !batch.insert(command.sequence).second || sequences_.contains(command.sequence)) {
            return std::unexpected(make_error(ErrorCode::invalid_argument, "duplicate command sequence"));
        }
        if (command.sequence == std::numeric_limits<std::uint64_t>::max()) {
            return std::unexpected(make_error(ErrorCode::invalid_argument, "command sequence exceeds native sequence range"));
        }
        if (!validIdentity(command.type)) return std::unexpected(make_error(ErrorCode::invalid_argument, "command type must not be empty"));
        next_sequence = std::max(next_sequence, command.sequence + 1U);
    }
    for (const auto& command : commands) {
        queue_.push_back(command);
        sequences_.insert(command.sequence);
    }
    next_sequence_ = next_sequence;
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

CommandQueueSnapshot CommandQueue::snapshot() const {
    auto queue = queue_;
    std::ranges::sort(queue, [](const auto& a, const auto& b) { return a.sequence < b.sequence; });
    return CommandQueueSnapshot{std::move(queue), sequences_, next_sequence_};
}

Result<void> CommandQueue::restore(const CommandQueueSnapshot& snapshot) {
    if (snapshot.next_sequence < 1) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid command queue snapshot"));
    }

    for (const auto sequence : snapshot.seen_sequences) {
        if (sequence == 0 || sequence >= snapshot.next_sequence) {
            return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid command sequence"));
        }
    }

    std::set<std::uint64_t> queue_sequences;
    auto queue = snapshot.queue;
    for (const auto& command : queue) {
        if (command.version != command_protocol_version) {
            return std::unexpected(make_error(ErrorCode::invalid_argument, "unsupported command envelope version"));
        }
        if (command.sequence == 0 || command.sequence >= snapshot.next_sequence || !queue_sequences.insert(command.sequence).second) {
            return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid command sequence"));
        }
        if (!snapshot.seen_sequences.contains(command.sequence)) {
            return std::unexpected(make_error(ErrorCode::invalid_argument, "pending command sequence missing from seen set"));
        }
        if (!validIdentity(command.type)) {
            return std::unexpected(make_error(ErrorCode::invalid_argument, "command type must not be empty"));
        }
    }

    std::ranges::sort(queue, [](const auto& a, const auto& b) { return a.sequence < b.sequence; });
    queue_ = std::move(queue);
    sequences_ = snapshot.seen_sequences;
    next_sequence_ = snapshot.next_sequence;
    return {};
}

Result<DomainEvent> DomainEventJournal::append(std::uint64_t tick, std::string type, std::string source, std::vector<std::byte> payload) {
    if (!validIdentity(type)) return std::unexpected(make_error(ErrorCode::invalid_argument, "event type must not be empty"));
    if (!validIdentity(source)) return std::unexpected(make_error(ErrorCode::invalid_argument, "event source must not be empty"));
    DomainEvent event{next_sequence_++, tick, std::move(type), std::move(source), std::move(payload)};
    events_.push_back(event);
    return event;
}

std::vector<DomainEvent> DomainEventJournal::drain() {
    auto drained = std::move(events_);
    events_.clear();
    return drained;
}

std::vector<DomainEvent> DomainEventJournal::since(std::uint64_t sequence_exclusive) const {
    std::vector<DomainEvent> result;
    for (const auto& event : events_) {
        if (event.sequence > sequence_exclusive) result.push_back(event);
    }
    return result;
}

DomainEventJournalSnapshot DomainEventJournal::snapshot() const {
    return DomainEventJournalSnapshot{events_, next_sequence_};
}

Result<void> DomainEventJournal::restore(const DomainEventJournalSnapshot& snapshot) {
    if (snapshot.next_sequence == 0) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid event journal snapshot"));
    }

    std::set<std::uint64_t> seen;
    auto restored = snapshot.events;
    for (const auto& event : restored) {
        if (!validIdentity(event.type)) return std::unexpected(make_error(ErrorCode::invalid_argument, "event type must not be empty"));
        if (!validIdentity(event.source)) return std::unexpected(make_error(ErrorCode::invalid_argument, "event source must not be empty"));
        if (event.sequence == 0 || !seen.insert(event.sequence).second) {
            return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid event sequence"));
        }
    }

    std::ranges::sort(restored, [](const auto& left, const auto& right) { return left.sequence < right.sequence; });
    if (std::ranges::any_of(restored, [&](const auto& event) { return event.sequence >= snapshot.next_sequence; })) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, "event sequence exceeds next sequence"));
    }

    events_ = std::move(restored);
    next_sequence_ = snapshot.next_sequence;
    return {};
}

void DomainEventJournal::clearDiagnosticHistory() noexcept {
    events_.clear();
}

Result<void> SystemScheduler::registerSystem(SystemDefinition system) {
    if (!validIdentity(system.id)) return std::unexpected(make_error(ErrorCode::invalid_argument, "kernel system id must not be empty"));
    auto cadence = validateCadence(system.cadence, "system " + system.id);
    if (!cadence) return cadence;

    const auto id = system.id;
    if (const auto* duplicate_read = firstDuplicate(system.reads)) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, "duplicate read domain for system " + id + ": " + *duplicate_read));
    }
    if (const auto* duplicate_write = firstDuplicate(system.writes)) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, "duplicate write domain for system " + id + ": " + *duplicate_write));
    }
    if (const auto* read_write = firstIntersection(system.writes, system.reads)) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, "domain declared as read and write for system " + id + ": " + *read_write));
    }
    if (std::find(system.after.begin(), system.after.end(), id) != system.after.end() || std::find(system.before.begin(), system.before.end(), id) != system.before.end()) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, "self dependency for kernel system " + id));
    }
    if (systems_.contains(id)) return std::unexpected(make_error(ErrorCode::invalid_argument, "duplicate kernel system: " + id));

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
            const auto* shared_write = firstIntersection(a->second.writes, b->second.writes);
            if (!ordered && shared_write != nullptr) {
                return std::unexpected(make_error(ErrorCode::invalid_state, "ambiguous write conflict on domain " + *shared_write + ": " + a->first + ", " + b->first));
            }
            const auto* a_write_b_read = firstIntersection(a->second.writes, b->second.reads);
            const auto* b_write_a_read = firstIntersection(b->second.writes, a->second.reads);
            const auto* read_write_domain = a_write_b_read != nullptr ? a_write_b_read : b_write_a_read;
            if (!ordered && read_write_domain != nullptr) {
                return std::unexpected(make_error(ErrorCode::invalid_state, "ambiguous read/write conflict on domain " + *read_write_domain + ": " + a->first + ", " + b->first));
            }
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
    if (result.size() != systems_.size()) {
        std::vector<std::string> participants;
        participants.reserve(systems_.size() - result.size());
        for (const auto& [id, degree] : indegree) {
            if (degree > 0) participants.push_back(id);
        }
        std::string message = "kernel dependency cycle: ";
        for (std::size_t index = 0; index < participants.size(); ++index) {
            if (index > 0) message += " -> ";
            message += participants[index];
        }
        return std::unexpected(make_error(ErrorCode::invalid_state, std::move(message)));
    }
    compiled_ = std::move(result);
    return {};
}

Result<std::vector<SystemDefinition*>> SystemScheduler::dueSystems(std::uint64_t tick) {
    if (compiled_.empty() && !systems_.empty()) {
        auto compiled = compile();
        if (!compiled) return std::unexpected(compiled.error());
    }
    std::vector<SystemDefinition*> result;
    for (const auto& id : compiled_) if (isDue(systems_.at(id).cadence, tick)) result.push_back(&systems_.at(id));
    return result;
}

std::vector<std::string> SystemScheduler::orderedIds() const { return compiled_; }

std::vector<std::string> SystemScheduler::listSystemIds() const {
    std::vector<std::string> ids;
    ids.reserve(systems_.size());
    for (const auto& [id, system] : systems_) {
        (void)system;
        ids.push_back(id);
    }
    return ids;
}

Result<void> InvariantRunner::registerInvariant(InvariantDefinition invariant) {
    if (!validIdentity(invariant.id) || !invariant.check) return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid invariant definition"));
    auto cadence = validateCadence(invariant.cadence, invariant.id);
    if (!cadence) return cadence;
    if (invariants_.contains(invariant.id)) return std::unexpected(make_error(ErrorCode::invalid_argument, "duplicate invariant: " + invariant.id));
    invariants_.emplace(invariant.id, std::move(invariant));
    return {};
}

Result<void> InvariantRunner::runDue(std::uint64_t tick) const {
    for (const auto& [id, invariant] : invariants_) {
        if (!isDue(invariant.cadence, tick)) continue;
        auto result = invariant.check(tick);
        if (!result) {
            return std::unexpected(make_error(
                ErrorCode::invariant_failure,
                "invariant failed [" + id + "] at tick " + std::to_string(tick) + ": " + result.error().message));
        }
    }
    return {};
}

std::vector<std::string> InvariantRunner::listIds() const {
    std::vector<std::string> ids;
    ids.reserve(invariants_.size());
    for (const auto& [id, invariant] : invariants_) {
        (void)invariant;
        ids.push_back(id);
    }
    return ids;
}

} // namespace civic
