#include <gtest/gtest.h>
#include <civic/bridge/civic_engine.h>
#include <civic/core/Kernel.hpp>
#include <civic/core/RandomStreamRegistry.hpp>
#include <civic/persistence/SaveV9.hpp>

#include <cstring>
#include <string>
#include <vector>

namespace {
const std::string kNbsp{"\xC2\xA0"};
const std::string kIdeographicSpace{"\xE3\x80\x80"};
const std::string kSupplementary{"\xF0\x90\x80\x80"}; // U+10000 -> UTF-16 D800 DC00
const std::string kPrivateBmp{"\xEE\x80\x80"};       // U+E000
}

TEST(CAbi, LifecycleBufferOwnershipAndErrorContract) {
    cf_engine* engine = nullptr; const cf_engine_config config{9, 0, 1};
    ASSERT_EQ(cf_engine_create(&config, &engine), CF_ERROR_NONE); ASSERT_NE(engine, nullptr);
    ASSERT_EQ(cf_engine_step(engine, 1), CF_ERROR_NONE);
    cf_buffer snapshot{}; ASSERT_EQ(cf_engine_get_snapshot(engine, &snapshot), CF_ERROR_NONE); EXPECT_GT(snapshot.size, 0U); cf_buffer_free(snapshot);
    cf_buffer save{}; EXPECT_EQ(cf_engine_save_v9(engine, &save), CF_ERROR_INVALID_STATE);
    cf_error error{}; ASSERT_EQ(cf_engine_get_last_error(engine, &error), CF_ERROR_NONE); EXPECT_EQ(error.code, CF_ERROR_INVALID_STATE); EXPECT_GT(error.message.size, 0U); cf_buffer_free(error.message);
    cf_engine_destroy(engine);
}

TEST(CAbi, RepeatedLifecycleIsSafe) {
    for (int index = 0; index < 1000; ++index) {
        cf_engine* engine = nullptr; const cf_engine_config config{static_cast<uint32_t>(index), 0, 1};
        ASSERT_EQ(cf_engine_create(&config, &engine), CF_ERROR_NONE);
        cf_engine_destroy(engine);
    }
}

TEST(CAbi, DomainHashCanonicalizesSemanticCommandPayloadAndMarksUnownedDomains) {
    cf_engine* left = nullptr;
    cf_engine* right = nullptr;
    const cf_engine_config config{17, 0, 1};
    ASSERT_EQ(cf_engine_create(&config, &left), CF_ERROR_NONE);
    ASSERT_EQ(cf_engine_create(&config, &right), CF_ERROR_NONE);
    const std::string left_commands = R"([{"version":1,"sequence":1,"tick":1,"type":"semantic","payload":{"a":1,"b":2}}])";
    const std::string right_commands = R"([{"version":1,"sequence":1,"tick":1,"type":"semantic","payload":{"b":2,"a":1}}])";
    ASSERT_EQ(cf_engine_submit_commands(left, reinterpret_cast<const uint8_t*>(left_commands.data()), left_commands.size()), CF_ERROR_NONE);
    ASSERT_EQ(cf_engine_submit_commands(right, reinterpret_cast<const uint8_t*>(right_commands.data()), right_commands.size()), CF_ERROR_NONE);
    cf_domain_hash left_hash{};
    cf_domain_hash right_hash{};
    ASSERT_EQ(cf_engine_get_domain_hash(left, "kernel", &left_hash), CF_ERROR_NONE);
    ASSERT_EQ(cf_engine_get_domain_hash(right, "kernel", &right_hash), CF_ERROR_NONE);
    EXPECT_EQ(left_hash.ownership, 1U);
    EXPECT_EQ(left_hash.version, 1U);
    EXPECT_EQ(left_hash.value, right_hash.value);
    for (const auto* domain : {"world", "cadastre", "buildings", "transportation", "population", "economy", "services"}) {
        cf_domain_hash unowned{};
        ASSERT_EQ(cf_engine_get_domain_hash(left, domain, &unowned), CF_ERROR_NONE);
        EXPECT_EQ(unowned.ownership, 2U) << domain;
        EXPECT_EQ(unowned.version, 1U) << domain;
        EXPECT_EQ(unowned.value, 0U) << domain;
    }
    cf_engine_destroy(left);
    cf_engine_destroy(right);
}

TEST(CAbi, CommandParserRejectsTrailingNonWhitespace) {
    cf_engine* engine = nullptr;
    const cf_engine_config config{23, 0, 1};
    ASSERT_EQ(cf_engine_create(&config, &engine), CF_ERROR_NONE);
    const std::string bad = R"([] trailing)";
    EXPECT_EQ(cf_engine_submit_commands(engine, reinterpret_cast<const uint8_t*>(bad.data()), bad.size()), CF_ERROR_SERIALIZATION_FAILURE);
    const std::string good = "[]\n\t ";
    EXPECT_EQ(cf_engine_submit_commands(engine, reinterpret_cast<const uint8_t*>(good.data()), good.size()), CF_ERROR_NONE);
    cf_engine_destroy(engine);
}

TEST(CAbi, SnapshotEscapesControlCharactersInCommandIdentity) {
    cf_engine* engine = nullptr;
    const cf_engine_config config{29, 0, 1};
    ASSERT_EQ(cf_engine_create(&config, &engine), CF_ERROR_NONE);
    const std::string command = R"([{"version":1,"sequence":1,"tick":10,"type":"\u0001","payload":null}])";
    ASSERT_EQ(cf_engine_submit_commands(engine, reinterpret_cast<const uint8_t*>(command.data()), command.size()), CF_ERROR_NONE);
    cf_buffer snapshot{};
    ASSERT_EQ(cf_engine_get_snapshot(engine, &snapshot), CF_ERROR_NONE);
    const std::string text(reinterpret_cast<const char*>(snapshot.data), snapshot.size);
    EXPECT_EQ(text.find(static_cast<char>(1)), std::string::npos);
    EXPECT_NE(text.find("\\u0001"), std::string::npos);
    cf_buffer_free(snapshot);
    cf_engine_destroy(engine);
}

TEST(RandomParity, RejectsEcmaWhitespaceOnlyStreamNames) {
    civic::RandomStreamRegistry registry(31);
    EXPECT_FALSE(registry.stream(kNbsp));
    EXPECT_FALSE(registry.stream(kIdeographicSpace));
}

TEST(RandomParity, SnapshotUsesJavaScriptUtf16OrdinalOrder) {
    civic::RandomStreamRegistry registry(31);
    ASSERT_TRUE(registry.stream(kPrivateBmp));
    ASSERT_TRUE(registry.stream(kSupplementary));
    const auto snapshot = registry.snapshot();
    ASSERT_EQ(snapshot.size(), 2U);
    auto iterator = snapshot.begin();
    EXPECT_EQ(iterator->first, kSupplementary);
    ++iterator;
    EXPECT_EQ(iterator->first, kPrivateBmp);
}

TEST(CommandContracts, RejectsEcmaWhitespaceOnlyCommandType) {
    civic::CommandQueue queue;
    const std::vector<civic::CommandEnvelope> commands{{1, 0, kNbsp, {}}};
    EXPECT_FALSE(queue.submit(commands, 0));
}


TEST(EventJournalParity, SinceReturnsOnlyStrictlyNewerSequence) {
    civic::DomainEventJournal journal;
    ASSERT_TRUE(journal.append(1, "a", "test"));
    ASSERT_TRUE(journal.append(2, "b", "test"));
    ASSERT_TRUE(journal.append(3, "c", "test"));

    const auto newer = journal.since(1);
    ASSERT_EQ(newer.size(), 2U);
    EXPECT_EQ(newer[0].sequence, 2U);
    EXPECT_EQ(newer[1].sequence, 3U);
    EXPECT_TRUE(journal.since(3).empty());
}

TEST(EventJournalParity, SnapshotRestorePreservesNextSequence) {
    civic::DomainEventJournal original;
    auto first = original.append(5, "created", "fixture", {std::byte{0x2A}});
    ASSERT_TRUE(first);

    const auto snapshot = original.snapshot();
    EXPECT_EQ(snapshot.next_sequence, 2U);

    civic::DomainEventJournal restored;
    ASSERT_TRUE(restored.restore(snapshot));
    ASSERT_EQ(restored.list().size(), 1U);
    EXPECT_EQ(restored.list()[0].sequence, 1U);
    EXPECT_EQ(restored.list()[0].tick, 5U);
    EXPECT_EQ(restored.list()[0].type, "created");
    EXPECT_EQ(restored.list()[0].source, "fixture");
    ASSERT_EQ(restored.list()[0].payload.size(), 1U);
    EXPECT_EQ(restored.list()[0].payload[0], std::byte{0x2A});
    EXPECT_EQ(restored.nextSequence(), 2U);

    auto second = restored.append(6, "continued", "fixture");
    ASSERT_TRUE(second);
    EXPECT_EQ(second->sequence, 2U);
}

TEST(EventJournalParity, RestoreRejectsDuplicateSequence) {
    civic::DomainEventJournal journal;
    const civic::DomainEventJournalSnapshot snapshot{
        {
            civic::DomainEvent{1, 1, "first", "fixture", {}},
            civic::DomainEvent{1, 2, "duplicate", "fixture", {}},
        },
        3,
    };

    const auto restored = journal.restore(snapshot);
    ASSERT_FALSE(restored);
    EXPECT_EQ(restored.error().code, civic::ErrorCode::invalid_argument);
    EXPECT_TRUE(journal.list().empty());
    EXPECT_EQ(journal.nextSequence(), 1U);
}

TEST(EventJournalParity, RestoreRejectsOutOfRangeSequenceAndInvalidNextSequence) {
    civic::DomainEventJournal journal;
    const civic::DomainEventJournalSnapshot out_of_range{
        {civic::DomainEvent{2, 1, "future", "fixture", {}}},
        2,
    };
    EXPECT_FALSE(journal.restore(out_of_range));

    const civic::DomainEventJournalSnapshot invalid_next{{}, 0};
    EXPECT_FALSE(journal.restore(invalid_next));
    EXPECT_TRUE(journal.list().empty());
    EXPECT_EQ(journal.nextSequence(), 1U);
}

TEST(EventJournalParity, RestoreSortsEventsBySequence) {
    civic::DomainEventJournal journal;
    const civic::DomainEventJournalSnapshot snapshot{
        {
            civic::DomainEvent{2, 2, "second", "fixture", {}},
            civic::DomainEvent{1, 1, "first", "fixture", {}},
        },
        3,
    };

    ASSERT_TRUE(journal.restore(snapshot));
    ASSERT_EQ(journal.list().size(), 2U);
    EXPECT_EQ(journal.list()[0].sequence, 1U);
    EXPECT_EQ(journal.list()[1].sequence, 2U);
}

TEST(EventJournalParity, RestoreRejectsInvalidIdentityWithoutMutation) {
    civic::DomainEventJournal journal;
    ASSERT_TRUE(journal.append(1, "existing", "fixture"));
    const auto before = journal.snapshot();

    const civic::DomainEventJournalSnapshot invalid{
        {civic::DomainEvent{1, 1, "valid", kNbsp, {}}},
        2,
    };
    const auto restored = journal.restore(invalid);
    ASSERT_FALSE(restored);
    EXPECT_EQ(restored.error().code, civic::ErrorCode::invalid_argument);
    EXPECT_EQ(journal.list().size(), before.events.size());
    EXPECT_EQ(journal.list()[0].type, before.events[0].type);
    EXPECT_EQ(journal.nextSequence(), before.next_sequence);
}

TEST(EventJournalParity, ClearHistoryDoesNotResetSequence) {
    civic::DomainEventJournal journal;
    ASSERT_TRUE(journal.append(1, "a", "test"));
    ASSERT_TRUE(journal.append(2, "b", "test"));
    EXPECT_EQ(journal.nextSequence(), 3U);

    journal.clearDiagnosticHistory();
    EXPECT_TRUE(journal.list().empty());
    EXPECT_EQ(journal.nextSequence(), 3U);

    auto next = journal.append(3, "c", "test");
    ASSERT_TRUE(next);
    EXPECT_EQ(next->sequence, 3U);
}

TEST(EventJournalParity, RejectsEmptyTypeAndSource) {
    civic::DomainEventJournal journal;

    const auto empty_type = journal.append(1, "   ", "fixture");
    ASSERT_FALSE(empty_type);
    EXPECT_EQ(empty_type.error().code, civic::ErrorCode::invalid_argument);

    const auto empty_source = journal.append(1, "valid", kNbsp);
    ASSERT_FALSE(empty_source);
    EXPECT_EQ(empty_source.error().code, civic::ErrorCode::invalid_argument);

    EXPECT_TRUE(journal.list().empty());
    EXPECT_EQ(journal.nextSequence(), 1U);
}

TEST(SchedulerContracts, UsesJavaScriptUtf16OrdinalOrderForTies) {
    civic::SystemScheduler scheduler;
    ASSERT_TRUE(scheduler.registerSystem({kPrivateBmp, {1, 0}, {}, {}, {}, {}, 0, {}}));
    ASSERT_TRUE(scheduler.registerSystem({kSupplementary, {1, 0}, {}, {}, {}, {}, 0, {}}));
    ASSERT_TRUE(scheduler.compile());
    const auto ids = scheduler.orderedIds();
    ASSERT_EQ(ids.size(), 2U);
    EXPECT_EQ(ids[0], kSupplementary);
    EXPECT_EQ(ids[1], kPrivateBmp);
}

TEST(InvariantContracts, UsesJavaScriptUtf16OrdinalExecutionOrder) {
    civic::InvariantRunner runner;
    std::vector<std::string> order;
    ASSERT_TRUE(runner.registerInvariant({kPrivateBmp, {1, 0}, [&](std::uint64_t) -> civic::Result<void> { order.push_back(kPrivateBmp); return {}; }}));
    ASSERT_TRUE(runner.registerInvariant({kSupplementary, {1, 0}, [&](std::uint64_t) -> civic::Result<void> { order.push_back(kSupplementary); return {}; }}));
    ASSERT_TRUE(runner.runDue(0));
    ASSERT_EQ(order.size(), 2U);
    EXPECT_EQ(order[0], kSupplementary);
    EXPECT_EQ(order[1], kPrivateBmp);
}

TEST(InvariantParity, ListsIdsInJavaScriptUtf16OrdinalOrder) {
    civic::InvariantRunner runner;
    ASSERT_TRUE(runner.registerInvariant({kPrivateBmp, {1, 0}, [](std::uint64_t) -> civic::Result<void> { return {}; }}));
    ASSERT_TRUE(runner.registerInvariant({kSupplementary, {1, 0}, [](std::uint64_t) -> civic::Result<void> { return {}; }}));
    EXPECT_EQ(runner.listIds(), (std::vector<std::string>{kSupplementary, kPrivateBmp}));
}

TEST(InvariantParity, FailureIncludesInvariantIdTickAndDetail) {
    civic::InvariantRunner runner;
    ASSERT_TRUE(runner.registerInvariant({"broken", {1, 0}, [](std::uint64_t) -> civic::Result<void> {
        return std::unexpected(civic::make_error(civic::ErrorCode::invalid_state, "underlying detail"));
    }}));
    const auto result = runner.runDue(7);
    ASSERT_FALSE(result);
    EXPECT_EQ(result.error().code, civic::ErrorCode::invariant_failure);
    EXPECT_EQ(result.error().message, "invariant failed [broken] at tick 7: underlying detail");
}

TEST(InvariantParity, RejectsDuplicateAndInvalidCadence) {
    civic::InvariantRunner runner;
    const auto pass = [](std::uint64_t) -> civic::Result<void> { return {}; };
    EXPECT_FALSE(runner.registerInvariant({kNbsp, {1, 0}, pass}));
    ASSERT_TRUE(runner.registerInvariant({"valid", {2, 1}, pass}));
    EXPECT_FALSE(runner.registerInvariant({"valid", {2, 1}, pass}));
    EXPECT_FALSE(runner.registerInvariant({"zero", {0, 0}, pass}));
    EXPECT_FALSE(runner.registerInvariant({"offset", {2, 2}, pass}));
}

TEST(InvariantParity, HonorsOffsetCadenceExactly) {
    civic::InvariantRunner runner;
    std::vector<std::uint64_t> ticks;
    ASSERT_TRUE(runner.registerInvariant({"periodic", {3, 2}, [&](std::uint64_t tick) -> civic::Result<void> {
        ticks.push_back(tick);
        return {};
    }}));
    for (std::uint64_t tick = 0; tick <= 8; ++tick) ASSERT_TRUE(runner.runDue(tick));
    EXPECT_EQ(ticks, (std::vector<std::uint64_t>{2, 5, 8}));
}

TEST(SaveV9Parity, CanonicalObjectKeysUseJavaScriptUtf16OrdinalOrder) {
    std::string save = R"({"saveVersion":9,"gameVersion":"0.9.0-urban-fabric","seed":7,"clock":{"tick":11,"speed":1},"terrain":{},"world":{},"urbanFabric":{"parcels":[],"lineage":[]},"zoningV2":{"parcelAssignments":[]},"buildingsV2":[],"propertyMarket":{"holdings":[],"transactions":[],"nextTransactionId":1}})";
    save.pop_back();
    save += ",\"" + kPrivateBmp + "\":2,\"" + kSupplementary + "\":1}";
    auto parsed = civic::parseSaveV9(save);
    ASSERT_TRUE(parsed);
    const auto supplementary = parsed->canonicalJson.find(kSupplementary);
    const auto private_bmp = parsed->canonicalJson.find(kPrivateBmp);
    ASSERT_NE(supplementary, std::string::npos);
    ASSERT_NE(private_bmp, std::string::npos);
    EXPECT_LT(supplementary, private_bmp);
}

TEST(CAbi, CommandPayloadCanonicalKeysUseJavaScriptUtf16OrdinalOrder) {
    cf_engine* engine = nullptr;
    const cf_engine_config config{37, 0, 1};
    ASSERT_EQ(cf_engine_create(&config, &engine), CF_ERROR_NONE);
    const std::string commands = "[{\"version\":1,\"sequence\":1,\"tick\":10,\"type\":\"unicode\",\"payload\":{\"" + kPrivateBmp + "\":2,\"" + kSupplementary + "\":1}}]";
    ASSERT_EQ(cf_engine_submit_commands(engine, reinterpret_cast<const uint8_t*>(commands.data()), commands.size()), CF_ERROR_NONE);
    cf_buffer snapshot{};
    ASSERT_EQ(cf_engine_get_snapshot(engine, &snapshot), CF_ERROR_NONE);
    const std::string text(reinterpret_cast<const char*>(snapshot.data), snapshot.size);
    const auto supplementary = text.find(kSupplementary);
    const auto private_bmp = text.find(kPrivateBmp);
    ASSERT_NE(supplementary, std::string::npos);
    ASSERT_NE(private_bmp, std::string::npos);
    EXPECT_LT(supplementary, private_bmp);
    cf_buffer_free(snapshot);
    cf_engine_destroy(engine);
}


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
