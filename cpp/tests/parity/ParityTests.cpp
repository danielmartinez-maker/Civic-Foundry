#include <gtest/gtest.h>
#include <civic/bridge/civic_engine.h>

#include <string>
#include <cstring>

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
    const std::string left_commands = R"([{"sequence":1,"tick":1,"type":"semantic","payload":{"a":1,"b":2}}])";
    const std::string right_commands = R"([{"sequence":1,"tick":1,"type":"semantic","payload":{"b":2,"a":1}}])";
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
    const std::string command = R"([{"sequence":1,"tick":10,"type":"\u0001","payload":null}])";
    ASSERT_EQ(cf_engine_submit_commands(engine, reinterpret_cast<const uint8_t*>(command.data()), command.size()), CF_ERROR_NONE);
    cf_buffer snapshot{};
    ASSERT_EQ(cf_engine_get_snapshot(engine, &snapshot), CF_ERROR_NONE);
    const std::string text(reinterpret_cast<const char*>(snapshot.data), snapshot.size);
    EXPECT_EQ(text.find(static_cast<char>(1)), std::string::npos);
    EXPECT_NE(text.find("\\u0001"), std::string::npos);
    cf_buffer_free(snapshot);
    cf_engine_destroy(engine);
}
