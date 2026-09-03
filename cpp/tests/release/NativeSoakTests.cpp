#include <gtest/gtest.h>

#include <civic/core/NativeEngine.hpp>

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace {

void runDeterministicSoak(std::uint64_t ticks) {
    auto left = civic::NativeEngine::create({.seed = 131U});
    auto right = civic::NativeEngine::create({.seed = 131U});
    ASSERT_TRUE(left.has_value());
    ASSERT_TRUE(right.has_value());

    std::vector<civic::CommandEnvelope> commands;
    commands.push_back({1U, 1U, "soak-seed-command", {std::byte{0x01}, std::byte{0x02}}});
    ASSERT_TRUE((*left)->submit(commands).has_value());
    ASSERT_TRUE((*right)->submit(commands).has_value());
    ASSERT_TRUE((*left)->step(ticks).has_value());
    ASSERT_TRUE((*right)->step(ticks).has_value());
    EXPECT_EQ((*left)->tick(), ticks);
    EXPECT_EQ((*right)->tick(), ticks);

    const auto left_hash = (*left)->domainHash("kernel");
    const auto right_hash = (*right)->domainHash("kernel");
    ASSERT_TRUE(left_hash.has_value());
    ASSERT_TRUE(right_hash.has_value());
    EXPECT_EQ(left_hash->value, right_hash->value);

    const auto left_snapshot = (*left)->snapshot();
    const auto right_snapshot = (*right)->snapshot();
    ASSERT_TRUE(left_snapshot.has_value());
    ASSERT_TRUE(right_snapshot.has_value());
    EXPECT_EQ(left_snapshot->json, right_snapshot->json);
    EXPECT_EQ(left_snapshot->json.find("nan"), std::string::npos);
    EXPECT_EQ(left_snapshot->json.find("inf"), std::string::npos);
    EXPECT_LT(left_snapshot->json.size(), 4096U);
}

} // namespace

TEST(NativeSoak, DeterministicShortHorizon) {
    runDeterministicSoak(1U);
}

TEST(NativeSoak, DeterministicMediumHorizon) {
    runDeterministicSoak(1000U);
}

TEST(NativeSoak, DeterministicLongRawTickHorizon) {
    runDeterministicSoak(10000U);
}

TEST(NativeSoak, DeterministicExtendedRawTickHorizon) {
    runDeterministicSoak(50000U);
}
