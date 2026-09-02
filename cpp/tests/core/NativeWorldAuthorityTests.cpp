#include <gtest/gtest.h>

#include <civic/core/NativeEngine.hpp>

#include <string>

TEST(NativeWorldAuthority, EngineHandleOwnsGeneratedWorldAndStormMutation) {
    auto created = civic::NativeEngine::create({1337, 0, civic::SpeedMode::normal});
    ASSERT_TRUE(created);

    const auto world = (*created)->createWorld(R"({"seed":1337,"config":{"width":6,"height":5,"metersPerCell":30,"preset":"rolling_uplands"}})");
    ASSERT_TRUE(world);
    EXPECT_NE(world->json.find("\"mode\":\"generated-1r\""), std::string::npos);
    EXPECT_NE(world->json.find("\"seed\":1337"), std::string::npos);
    EXPECT_NE(world->json.find("\"lastFloodResult\":null"), std::string::npos);

    const auto hash = (*created)->domainHash("world");
    ASSERT_TRUE(hash);
    EXPECT_EQ(hash->ownership, civic::DomainOwnership::owned);
    EXPECT_NE(hash->value, 0U);

    const auto storm = (*created)->runDesignStorm(R"({"id":"storm:task19","rainfallMm":42,"durationHours":2})");
    ASSERT_TRUE(storm);
    EXPECT_NE(storm->json.find("\"eventId\":\"storm:task19\""), std::string::npos);
    EXPECT_EQ(storm->json.find("\"lastFloodResult\":null"), std::string::npos);

    const auto hash_after_storm = (*created)->domainHash("world");
    ASSERT_TRUE(hash_after_storm);
    EXPECT_EQ(hash_after_storm->ownership, civic::DomainOwnership::owned);
    EXPECT_EQ(hash_after_storm->value, hash->value);
}

TEST(NativeWorldAuthority, RestoredWorldKeepsDeterministicDomainHash) {
    auto source = civic::NativeEngine::create({1337, 0, civic::SpeedMode::normal});
    ASSERT_TRUE(source);
    const auto generated = (*source)->createWorld(R"({"seed":1337,"config":{"width":6,"height":5,"metersPerCell":30,"preset":"rolling_uplands"}})");
    ASSERT_TRUE(generated);
    const auto expected_hash = (*source)->domainHash("world");
    ASSERT_TRUE(expected_hash);

    auto restored = civic::NativeEngine::create({1337, 0, civic::SpeedMode::normal});
    ASSERT_TRUE(restored);
    const auto restored_snapshot = (*restored)->restoreWorld(generated->json);
    ASSERT_TRUE(restored_snapshot);
    EXPECT_EQ(restored_snapshot->json, generated->json);

    const auto actual_hash = (*restored)->domainHash("world");
    ASSERT_TRUE(actual_hash);
    EXPECT_EQ(actual_hash->ownership, civic::DomainOwnership::owned);
    EXPECT_EQ(actual_hash->value, expected_hash->value);
}
