from __future__ import annotations

import json
import re
import sys
from pathlib import Path


def append_once(path: str, marker: str, block: str) -> None:
    file_path = Path(path)
    text = file_path.read_text()
    if marker not in text:
        file_path.write_text(text + block)


def add_tests() -> None:
    append_once(
        "cpp/tests/core/CoreTests.cpp",
        "TEST(SchedulerContracts, CadenceOverlapUsesGcdArithmeticAndDependencyPaths)",
        r'''

TEST(SchedulerContracts, RegistrationValidationMatchesTypeScriptDiagnostics) {
    civic::SystemScheduler scheduler;

    const auto duplicate_read = scheduler.registerSystem({"dup-read", {1,0}, {}, {}, {"traffic", "traffic"}, {}, 0, {}});
    ASSERT_FALSE(duplicate_read);
    EXPECT_EQ(duplicate_read.error().message, "duplicate read domain for system dup-read: traffic");

    const auto duplicate_write = scheduler.registerSystem({"dup-write", {1,0}, {}, {}, {}, {"traffic", "traffic"}, 0, {}});
    ASSERT_FALSE(duplicate_write);
    EXPECT_EQ(duplicate_write.error().message, "duplicate write domain for system dup-write: traffic");

    const auto read_write = scheduler.registerSystem({"read-write", {1,0}, {}, {}, {"traffic"}, {"traffic"}, 0, {}});
    ASSERT_FALSE(read_write);
    EXPECT_EQ(read_write.error().message, "domain declared as read and write for system read-write: traffic");

    const auto self_after = scheduler.registerSystem({"self-after", {1,0}, {"self-after"}, {}, {}, {}, 0, {}});
    ASSERT_FALSE(self_after);
    EXPECT_EQ(self_after.error().message, "self dependency for kernel system self-after");

    const auto invalid_cadence = scheduler.registerSystem({"bad-cadence", {2,2}, {}, {}, {}, {}, 0, {}});
    ASSERT_FALSE(invalid_cadence);
    EXPECT_EQ(invalid_cadence.error().message, "invalid cadence for system bad-cadence");
}

TEST(SchedulerContracts, CadenceOverlapUsesGcdArithmeticAndDependencyPaths) {
    civic::SystemScheduler disjoint;
    ASSERT_TRUE(disjoint.registerSystem({"even", {2,0}, {}, {}, {}, {"market"}, 0, {}}));
    ASSERT_TRUE(disjoint.registerSystem({"odd", {2,1}, {}, {}, {}, {"market"}, 0, {}}));
    EXPECT_TRUE(disjoint.compile());

    civic::SystemScheduler overlapping;
    ASSERT_TRUE(overlapping.registerSystem({"four", {4,1}, {}, {}, {}, {"market"}, 0, {}}));
    ASSERT_TRUE(overlapping.registerSystem({"six", {6,3}, {}, {}, {}, {"market"}, 0, {}}));
    const auto conflict = overlapping.compile();
    ASSERT_FALSE(conflict);
    EXPECT_EQ(conflict.error().message, "ambiguous write conflict on domain market: four, six");

    civic::SystemScheduler ordered;
    ASSERT_TRUE(ordered.registerSystem({"four", {4,1}, {}, {}, {}, {"market"}, 0, {}}));
    ASSERT_TRUE(ordered.registerSystem({"six", {6,3}, {"four"}, {}, {}, {"market"}, 0, {}}));
    ASSERT_TRUE(ordered.compile());
    EXPECT_EQ(ordered.orderedIds(), (std::vector<std::string>{"four", "six"}));
}

TEST(SchedulerContracts, OrderFieldBreaksTopologicalTies) {
    civic::SystemScheduler scheduler;
    ASSERT_TRUE(scheduler.registerSystem({"beta", {1,0}, {}, {}, {}, {}, 5, {}}));
    ASSERT_TRUE(scheduler.registerSystem({"gamma", {1,0}, {}, {}, {}, {}, -1, {}}));
    ASSERT_TRUE(scheduler.registerSystem({"alpha", {1,0}, {}, {}, {}, {}, 5, {}}));
    ASSERT_TRUE(scheduler.compile());
    EXPECT_EQ(scheduler.orderedIds(), (std::vector<std::string>{"gamma", "alpha", "beta"}));
}

TEST(SchedulerContracts, UnknownDependenciesAndCycleParticipantsAreDeterministic) {
    civic::SystemScheduler unknown_after;
    ASSERT_TRUE(unknown_after.registerSystem({"traffic", {1,0}, {"roads"}, {}, {}, {}, 0, {}}));
    const auto after_result = unknown_after.compile();
    ASSERT_FALSE(after_result);
    EXPECT_EQ(after_result.error().message, "unknown kernel dependency: roads -> traffic");

    civic::SystemScheduler unknown_before;
    ASSERT_TRUE(unknown_before.registerSystem({"traffic", {1,0}, {}, {"roads"}, {}, {}, 0, {}}));
    const auto before_result = unknown_before.compile();
    ASSERT_FALSE(before_result);
    EXPECT_EQ(before_result.error().message, "unknown kernel dependency: traffic -> roads");

    civic::SystemScheduler cycle;
    ASSERT_TRUE(cycle.registerSystem({"c", {1,0}, {"b"}, {}, {}, {}, 0, {}}));
    ASSERT_TRUE(cycle.registerSystem({"a", {1,0}, {"c"}, {}, {}, {}, 0, {}}));
    ASSERT_TRUE(cycle.registerSystem({"b", {1,0}, {"a"}, {}, {}, {}, 0, {}}));
    const auto cycle_result = cycle.compile();
    ASSERT_FALSE(cycle_result);
    EXPECT_EQ(cycle_result.error().message, "kernel dependency cycle: a -> b -> c");
}

TEST(SchedulerContracts, DueFilteringAndListIdsAreIndependentOfCompiledOrder) {
    civic::SystemScheduler scheduler;
    ASSERT_TRUE(scheduler.registerSystem({"zeta", {2,0}, {}, {}, {}, {}, -5, {}}));
    ASSERT_TRUE(scheduler.registerSystem({"alpha", {2,1}, {}, {}, {}, {}, 10, {}}));

    EXPECT_EQ(scheduler.listSystemIds(), (std::vector<std::string>{"alpha", "zeta"}));
    ASSERT_TRUE(scheduler.compile());
    EXPECT_EQ(scheduler.orderedIds(), (std::vector<std::string>{"zeta", "alpha"}));
    EXPECT_EQ(scheduler.listSystemIds(), (std::vector<std::string>{"alpha", "zeta"}));

    const auto tick_one = scheduler.dueSystems(1);
    ASSERT_TRUE(tick_one);
    ASSERT_EQ(tick_one->size(), 1U);
    EXPECT_EQ((*tick_one)[0]->id, "alpha");

    const auto tick_two = scheduler.dueSystems(2);
    ASSERT_TRUE(tick_two);
    ASSERT_EQ(tick_two->size(), 1U);
    EXPECT_EQ((*tick_two)[0]->id, "zeta");
}
''',
    )

    append_once(
        "cpp/tests/parity/ParityTests.cpp",
        "TEST(SchedulerParity, ConflictDiagnosticsMatchTypeScript)",
        r'''

TEST(SchedulerParity, ConflictDiagnosticsMatchTypeScript) {
    civic::SystemScheduler write_conflict;
    ASSERT_TRUE(write_conflict.registerSystem({"a", {1,0}, {}, {}, {}, {"traffic"}, 0, {}}));
    ASSERT_TRUE(write_conflict.registerSystem({"b", {1,0}, {}, {}, {}, {"traffic"}, 0, {}}));
    const auto write_result = write_conflict.compile();
    ASSERT_FALSE(write_result);
    EXPECT_EQ(write_result.error().message, "ambiguous write conflict on domain traffic: a, b");

    civic::SystemScheduler read_write_conflict;
    ASSERT_TRUE(read_write_conflict.registerSystem({"a", {1,0}, {}, {}, {}, {"traffic"}, 0, {}}));
    ASSERT_TRUE(read_write_conflict.registerSystem({"b", {1,0}, {}, {}, {"traffic"}, {}, 0, {}}));
    const auto read_write_result = read_write_conflict.compile();
    ASSERT_FALSE(read_write_result);
    EXPECT_EQ(read_write_result.error().message, "ambiguous read/write conflict on domain traffic: a, b");
}

TEST(SchedulerParity, Utf16OrdinalBreaksEqualOrderTiesAndListsIds) {
    civic::SystemScheduler scheduler;
    ASSERT_TRUE(scheduler.registerSystem({kPrivateBmp, {1,0}, {}, {}, {}, {}, 0, {}}));
    ASSERT_TRUE(scheduler.registerSystem({kSupplementary, {1,0}, {}, {}, {}, {}, 0, {}}));
    ASSERT_TRUE(scheduler.compile());
    EXPECT_EQ(scheduler.orderedIds(), (std::vector<std::string>{kSupplementary, kPrivateBmp}));
    EXPECT_EQ(scheduler.listSystemIds(), (std::vector<std::string>{kSupplementary, kPrivateBmp}));
}

TEST(SchedulerParity, CycleParticipantsUseTypeScriptUtf16OrdinalOrder) {
    civic::SystemScheduler scheduler;
    ASSERT_TRUE(scheduler.registerSystem({kPrivateBmp, {1,0}, {kSupplementary}, {}, {}, {}, 0, {}}));
    ASSERT_TRUE(scheduler.registerSystem({kSupplementary, {1,0}, {kPrivateBmp}, {}, {}, {}, 0, {}}));
    const auto result = scheduler.compile();
    ASSERT_FALSE(result);
    EXPECT_EQ(result.error().message, "kernel dependency cycle: " + kSupplementary + " -> " + kPrivateBmp);
}
''',
    )


def apply_production() -> None:
    header = Path("cpp/engine/include/civic/core/Kernel.hpp")
    text = header.read_text()
    old = "    [[nodiscard]] std::vector<std::string> orderedIds() const;\n"
    new = old + "    [[nodiscard]] std::vector<std::string> listSystemIds() const;\n"
    if "listSystemIds() const" not in text:
        assert text.count(old) == 1
        header.write_text(text.replace(old, new, 1))

    source = Path("cpp/engine/src/core/Kernel.cpp")
    text = source.read_text()
    old_helper = '''bool intersects(const std::vector<std::string>& a, const std::vector<std::string>& b) {
    for (const auto& item : a) if (std::find(b.begin(), b.end(), item) != b.end()) return true;
    return false;
}
'''
    new_helper = '''const std::string* firstIntersection(const std::vector<std::string>& a, const std::vector<std::string>& b) {
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
'''
    if old_helper in text:
        text = text.replace(old_helper, new_helper, 1)

    new_register = '''Result<void> SystemScheduler::registerSystem(SystemDefinition system) {
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

'''
    text, count = re.subn(
        r"Result<void> SystemScheduler::registerSystem\(SystemDefinition system\) \{.*?\n\}\n\n(?=Result<void> SystemScheduler::compile\(\))",
        new_register,
        text,
        count=1,
        flags=re.S,
    )
    assert count == 1

    old_conflicts = '''            if (!ordered && intersects(a->second.writes, b->second.writes)) return std::unexpected(make_error(ErrorCode::invalid_state, "ambiguous write conflict: " + a->first + ", " + b->first));
            if (!ordered && (intersects(a->second.writes, b->second.reads) || intersects(b->second.writes, a->second.reads))) return std::unexpected(make_error(ErrorCode::invalid_state, "ambiguous read/write conflict: " + a->first + ", " + b->first));
'''
    new_conflicts = '''            const auto* shared_write = firstIntersection(a->second.writes, b->second.writes);
            if (!ordered && shared_write != nullptr) {
                return std::unexpected(make_error(ErrorCode::invalid_state, "ambiguous write conflict on domain " + *shared_write + ": " + a->first + ", " + b->first));
            }
            const auto* a_write_b_read = firstIntersection(a->second.writes, b->second.reads);
            const auto* b_write_a_read = firstIntersection(b->second.writes, a->second.reads);
            const auto* read_write_domain = a_write_b_read != nullptr ? a_write_b_read : b_write_a_read;
            if (!ordered && read_write_domain != nullptr) {
                return std::unexpected(make_error(ErrorCode::invalid_state, "ambiguous read/write conflict on domain " + *read_write_domain + ": " + a->first + ", " + b->first));
            }
'''
    assert text.count(old_conflicts) == 1
    text = text.replace(old_conflicts, new_conflicts, 1)

    old_cycle = '    if (result.size() != systems_.size()) return std::unexpected(make_error(ErrorCode::invalid_state, "kernel dependency cycle"));\n'
    new_cycle = '''    if (result.size() != systems_.size()) {
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
'''
    assert text.count(old_cycle) == 1
    text = text.replace(old_cycle, new_cycle, 1)

    old_ordered = "std::vector<std::string> SystemScheduler::orderedIds() const { return compiled_; }\n"
    new_ordered = '''std::vector<std::string> SystemScheduler::orderedIds() const { return compiled_; }

std::vector<std::string> SystemScheduler::listSystemIds() const {
    std::vector<std::string> ids;
    ids.reserve(systems_.size());
    for (const auto& [id, system] : systems_) {
        (void)system;
        ids.push_back(id);
    }
    return ids;
}
'''
    if "SystemScheduler::listSystemIds() const" not in text:
        assert text.count(old_ordered) == 1
        text = text.replace(old_ordered, new_ordered, 1)
    source.write_text(text)

    ledger_path = Path("docs/cpp/TS_REWRITE_LEDGER.json")
    ledger = json.loads(ledger_path.read_text())
    matches = [entry for entry in ledger["entries"] if entry["path"] == "src/simulation/kernel/SystemScheduler.ts"]
    assert len(matches) == 1
    entry = matches[0]
    entry["assignedStack"] = "K008"
    entry["targetNativeOwner"] = "civic::SystemScheduler"
    entry["nativeTestOwner"] = "cpp/tests/parity/ParityTests.cpp"
    entry["status"] = "parity_accepted"
    entry["currentAuthority"] = "typescript"
    entry["parityClassification"] = "parity"
    ledger_path.write_text(json.dumps(ledger, indent=2) + "\n")


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in {"tests", "production"}:
        raise SystemExit("usage: k008_remote_impl.py <tests|production>")
    if sys.argv[1] == "tests":
        add_tests()
    else:
        apply_production()


if __name__ == "__main__":
    main()
