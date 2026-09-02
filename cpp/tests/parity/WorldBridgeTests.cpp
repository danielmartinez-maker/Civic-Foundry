#include <gtest/gtest.h>

#include <civic/bridge/civic_engine.h>

#include <string>

namespace {
std::string take(cf_buffer buffer) {
    const std::string text(
        reinterpret_cast<const char*>(buffer.data),
        buffer.size);
    cf_buffer_free(buffer);
    return text;
}
}

TEST(CAbiWorldAuthority, CreateStormRestoreAndHashUseOwnedNativeWorld) {
    cf_engine* engine = nullptr;
    const cf_engine_config config{73, 0, 1};
    ASSERT_EQ(cf_engine_create(&config, &engine), CF_ERROR_NONE);
    ASSERT_NE(engine, nullptr);

    const std::string create = R"({"seed":73,"config":{"width":4,"height":3,"metersPerCell":30,"preset":"plain"}})";
    cf_buffer created{};
    ASSERT_EQ(
        cf_engine_create_world(
            engine,
            reinterpret_cast<const uint8_t*>(create.data()),
            create.size(),
            &created),
        CF_ERROR_NONE);
    const auto snapshot = take(created);
    EXPECT_NE(snapshot.find("\"mode\":\"generated-1r\""), std::string::npos);
    EXPECT_NE(snapshot.find("\"terrain\""), std::string::npos);
    EXPECT_NE(snapshot.find("\"hydrology\""), std::string::npos);

    cf_domain_hash hash_before{};
    ASSERT_EQ(cf_engine_get_domain_hash(engine, "world", &hash_before), CF_ERROR_NONE);
    EXPECT_EQ(hash_before.ownership, 1U);
    EXPECT_NE(hash_before.value, 0U);

    const std::string storm = R"({"id":"bridge-storm","rainfallMm":35,"durationHours":2,"saturationFactor":0.8})";
    cf_buffer storm_response{};
    ASSERT_EQ(
        cf_engine_run_design_storm(
            engine,
            reinterpret_cast<const uint8_t*>(storm.data()),
            storm.size(),
            &storm_response),
        CF_ERROR_NONE);
    const auto storm_text = take(storm_response);
    EXPECT_NE(storm_text.find("\"eventId\":\"bridge-storm\""), std::string::npos);
    EXPECT_NE(storm_text.find("\"snapshot\""), std::string::npos);

    cf_buffer restored{};
    ASSERT_EQ(
        cf_engine_restore_world(
            engine,
            reinterpret_cast<const uint8_t*>(snapshot.data()),
            snapshot.size(),
            &restored),
        CF_ERROR_NONE);
    const auto restored_text = take(restored);
    EXPECT_EQ(restored_text, snapshot);

    cf_domain_hash hash_after{};
    ASSERT_EQ(cf_engine_get_domain_hash(engine, "world", &hash_after), CF_ERROR_NONE);
    EXPECT_EQ(hash_after.ownership, 1U);
    EXPECT_EQ(hash_after.value, hash_before.value);

    cf_engine_destroy(engine);
}

TEST(CAbiWorldAuthority, InvalidWorldJsonPreservesNativeErrorContract) {
    cf_engine* engine = nullptr;
    ASSERT_EQ(cf_engine_create(nullptr, &engine), CF_ERROR_NONE);

    const std::string malformed = "{not-json";
    cf_buffer output{};
    EXPECT_EQ(
        cf_engine_create_world(
            engine,
            reinterpret_cast<const uint8_t*>(malformed.data()),
            malformed.size(),
            &output),
        CF_ERROR_SERIALIZATION_FAILURE);
    EXPECT_EQ(output.data, nullptr);
    EXPECT_EQ(output.size, 0U);

    cf_error error{};
    ASSERT_EQ(cf_engine_get_last_error(engine, &error), CF_ERROR_NONE);
    EXPECT_EQ(error.code, CF_ERROR_SERIALIZATION_FAILURE);
    EXPECT_GT(error.message.size, 0U);
    cf_buffer_free(error.message);

    cf_engine_destroy(engine);
}
