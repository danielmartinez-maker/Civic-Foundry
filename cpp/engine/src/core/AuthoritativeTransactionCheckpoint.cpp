#include <civic/core/AuthoritativeTransactionCheckpoint.hpp>

#include <exception>
#include <optional>
#include <string>
#include <string_view>
#include <utility>

namespace civic {
namespace {

bool validParticipantId(std::string_view id) {
    return utf16_detail::validUtf8AndHasNonEcmaTrimCodePoint(id);
}

template <typename Callback>
auto invokeCheckpointCallback(Callback&& callback, std::string_view operation)
    -> decltype(callback()) {
    try {
        return callback();
    } catch (const std::exception& exception) {
        return std::unexpected(make_error(
            ErrorCode::internal_error,
            "transaction checkpoint " + std::string{operation} +
                " callback threw: " + exception.what()
        ));
    } catch (...) {
        return std::unexpected(make_error(
            ErrorCode::internal_error,
            "transaction checkpoint " + std::string{operation} +
                " callback threw a non-standard exception"
        ));
    }
}

} // namespace

Result<void> AuthoritativeTransactionCheckpoint::registerParticipant(
    TransactionParticipant participant
) {
    if (!validParticipantId(participant.id)) {
        return std::unexpected(make_error(
            ErrorCode::invalid_argument,
            "transaction participant id must not be empty"
        ));
    }
    if (!participant.snapshot || !participant.restore) {
        return std::unexpected(make_error(
            ErrorCode::invalid_argument,
            "transaction participant callbacks are required"
        ));
    }

    const auto [ignored, inserted] = participants_.emplace(
        participant.id,
        std::move(participant)
    );
    (void)ignored;
    if (!inserted) {
        return std::unexpected(make_error(
            ErrorCode::invalid_argument,
            "duplicate transaction participant id"
        ));
    }
    return {};
}

Result<std::vector<TransactionSnapshot>>
AuthoritativeTransactionCheckpoint::capture() const {
    std::vector<TransactionSnapshot> snapshots;
    snapshots.reserve(participants_.size());

    for (const auto& [id, participant] : participants_) {
        auto payload = invokeCheckpointCallback(
            [&participant] { return participant.snapshot(); },
            "snapshot"
        );
        if (!payload) return std::unexpected(payload.error());
        snapshots.push_back(TransactionSnapshot{id, std::move(*payload)});
    }
    return snapshots;
}

Result<void> AuthoritativeTransactionCheckpoint::restore(
    std::span<const TransactionSnapshot> snapshots
) const {
    if (snapshots.size() != participants_.size()) {
        return std::unexpected(make_error(
            ErrorCode::invalid_state,
            "transaction checkpoint participant set mismatch"
        ));
    }

    std::map<std::string, std::span<const std::byte>, Utf16OrdinalLess> payloads;
    for (const auto& snapshot : snapshots) {
        if (!validParticipantId(snapshot.participant_id)) {
            return std::unexpected(make_error(
                ErrorCode::invalid_argument,
                "transaction snapshot participant id must not be empty"
            ));
        }
        if (!participants_.contains(snapshot.participant_id)) {
            return std::unexpected(make_error(
                ErrorCode::invalid_state,
                "transaction checkpoint participant is not registered: " +
                    snapshot.participant_id
            ));
        }

        const auto [ignored, inserted] = payloads.emplace(
            snapshot.participant_id,
            std::span<const std::byte>{snapshot.payload}
        );
        (void)ignored;
        if (!inserted) {
            return std::unexpected(make_error(
                ErrorCode::invalid_argument,
                "duplicate transaction snapshot participant id"
            ));
        }
    }

    for (const auto& [id, participant] : participants_) {
        (void)participant;
        if (!payloads.contains(id)) {
            return std::unexpected(make_error(
                ErrorCode::invalid_state,
                "transaction checkpoint participant snapshot is missing: " + id
            ));
        }
    }

    std::optional<Error> first_error;
    for (auto iterator = participants_.rbegin(); iterator != participants_.rend(); ++iterator) {
        const auto payload = payloads.find(iterator->first);
        auto restored = invokeCheckpointCallback(
            [&participant = iterator->second, &payload] {
                return participant.restore(payload->second);
            },
            "restore"
        );
        if (!restored && !first_error) first_error = restored.error();
    }

    if (first_error) return std::unexpected(*first_error);
    return {};
}

} // namespace civic

