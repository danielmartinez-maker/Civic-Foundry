#include <gtest/gtest.h>

#include <cstddef>
#include <span>
#include <string>
#include <vector>

#include <civic/core/AuthoritativeTransactionCheckpoint.hpp>

namespace {
std::vector<std::byte> bytes(std::initializer_list<unsigned int> values) {
    std::vector<std::byte> output;
    output.reserve(values.size());
    for (const auto value : values) output.push_back(static_cast<std::byte>(value));
    return output;
}
} // namespace

TEST(TransactionCheckpoint, CapturesParticipantsInDeterministicOrder) {
    civic::AuthoritativeTransactionCheckpoint checkpoint;
    const std::string supplementary{"\xF0\x90\x80\x80"}; // U+10000 => D800 DC00
    const std::string privateBmp{"\xEE\x80\x80"};       // U+E000

    ASSERT_TRUE(checkpoint.registerParticipant({
        privateBmp,
        []() -> civic::Result<std::vector<std::byte>> { return bytes({0xE0}); },
        [](std::span<const std::byte>) -> civic::Result<void> { return {}; },
    }));
    ASSERT_TRUE(checkpoint.registerParticipant({
        supplementary,
        []() -> civic::Result<std::vector<std::byte>> { return bytes({0x10}); },
        [](std::span<const std::byte>) -> civic::Result<void> { return {}; },
    }));
    ASSERT_TRUE(checkpoint.registerParticipant({
        "alpha",
        []() -> civic::Result<std::vector<std::byte>> { return bytes({0x01, 0x02}); },
        [](std::span<const std::byte>) -> civic::Result<void> { return {}; },
    }));

    const auto captured = checkpoint.capture();
    ASSERT_TRUE(captured);
    ASSERT_EQ(captured->size(), 3U);
    EXPECT_EQ((*captured)[0].participant_id, "alpha");
    EXPECT_EQ((*captured)[1].participant_id, supplementary);
    EXPECT_EQ((*captured)[2].participant_id, privateBmp);
    EXPECT_EQ((*captured)[0].payload, bytes({0x01, 0x02}));
}

TEST(TransactionCheckpoint, RestoresInReverseOrder) {
    civic::AuthoritativeTransactionCheckpoint checkpoint;
    std::vector<std::string> restored;

    for (const auto* id : {"alpha", "beta", "gamma"}) {
        ASSERT_TRUE(checkpoint.registerParticipant({
            id,
            []() -> civic::Result<std::vector<std::byte>> { return {}; },
            [&restored, id](std::span<const std::byte>) -> civic::Result<void> {
                restored.emplace_back(id);
                return {};
            },
        }));
    }

    const auto captured = checkpoint.capture();
    ASSERT_TRUE(captured);
    ASSERT_TRUE(checkpoint.restore(*captured));
    EXPECT_EQ(restored, (std::vector<std::string>{"gamma", "beta", "alpha"}));
}

TEST(TransactionCheckpoint, RejectsDuplicateParticipant) {
    civic::AuthoritativeTransactionCheckpoint checkpoint;
    const civic::TransactionParticipant participant{
        "kernel",
        []() -> civic::Result<std::vector<std::byte>> { return {}; },
        [](std::span<const std::byte>) -> civic::Result<void> { return {}; },
    };

    ASSERT_TRUE(checkpoint.registerParticipant(participant));
    const auto duplicate = checkpoint.registerParticipant(participant);
    ASSERT_FALSE(duplicate);
    EXPECT_EQ(duplicate.error().code, civic::ErrorCode::invalid_argument);
    EXPECT_EQ(duplicate.error().message, "duplicate transaction participant: kernel");
}

TEST(TransactionCheckpoint, MissingParticipantFailsRestore) {
    civic::AuthoritativeTransactionCheckpoint checkpoint;
    const std::vector<civic::TransactionSnapshot> snapshots{{"missing", bytes({0x01})}};

    const auto restored = checkpoint.restore(snapshots);
    ASSERT_FALSE(restored);
    EXPECT_EQ(restored.error().code, civic::ErrorCode::invalid_state);
    EXPECT_EQ(restored.error().message, "missing transaction participant during restore: missing");
}

TEST(TransactionCheckpoint, RestoreFailureIsSurfaced) {
    civic::AuthoritativeTransactionCheckpoint checkpoint;
    ASSERT_TRUE(checkpoint.registerParticipant({
        "kernel",
        []() -> civic::Result<std::vector<std::byte>> { return bytes({0x7F}); },
        [](std::span<const std::byte>) -> civic::Result<void> {
            return std::unexpected(civic::make_error(civic::ErrorCode::serialization_failure, "fixture restore failure"));
        },
    }));

    const auto captured = checkpoint.capture();
    ASSERT_TRUE(captured);
    const auto restored = checkpoint.restore(*captured);
    ASSERT_FALSE(restored);
    EXPECT_EQ(restored.error().code, civic::ErrorCode::serialization_failure);
    EXPECT_EQ(restored.error().message, "fixture restore failure");
}

TEST(TransactionCheckpoint, SnapshotPayloadOwnsCapturedBytes) {
    civic::AuthoritativeTransactionCheckpoint checkpoint;
    std::vector<std::byte> source = bytes({0x11, 0x22});
    ASSERT_TRUE(checkpoint.registerParticipant({
        "state",
        [&source]() -> civic::Result<std::vector<std::byte>> { return source; },
        [](std::span<const std::byte>) -> civic::Result<void> { return {}; },
    }));

    const auto captured = checkpoint.capture();
    ASSERT_TRUE(captured);
    source[0] = std::byte{0xFF};
    EXPECT_EQ(captured->at(0).payload, bytes({0x11, 0x22}));
}
