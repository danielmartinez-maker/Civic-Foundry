#include <civic/core/AuthoritativeTransactionCheckpoint.hpp>

#include <optional>
#include <utility>

namespace civic {

Result<void> AuthoritativeTransactionCheckpoint::registerParticipant(TransactionParticipant participant) {
    if (participant.id.empty()) {
        return std::unexpected(make_error(
            ErrorCode::invalid_argument,
            "transaction participant id must not be empty"
        ));
    }
    if (!participant.snapshot) {
        return std::unexpected(make_error(
            ErrorCode::invalid_argument,
            "transaction participant snapshot callback is required: " + participant.id
        ));
    }
    if (!participant.restore) {
        return std::unexpected(make_error(
            ErrorCode::invalid_argument,
            "transaction participant restore callback is required: " + participant.id
        ));
    }
    if (participants_.contains(participant.id)) {
        return std::unexpected(make_error(
            ErrorCode::invalid_argument,
            "duplicate transaction participant: " + participant.id
        ));
    }

    participants_.emplace(participant.id, std::move(participant));
    return {};
}

Result<std::vector<TransactionSnapshot>> AuthoritativeTransactionCheckpoint::capture() const {
    std::vector<TransactionSnapshot> snapshots;
    snapshots.reserve(participants_.size());

    for (const auto& [id, participant] : participants_) {
        auto payload = participant.snapshot();
        if (!payload) return std::unexpected(payload.error());
        snapshots.push_back(TransactionSnapshot{id, std::move(*payload)});
    }

    return snapshots;
}

Result<void> AuthoritativeTransactionCheckpoint::restore(
    std::span<const TransactionSnapshot> snapshots
) const {
    for (auto iterator = snapshots.rbegin(); iterator != snapshots.rend(); ++iterator) {
        if (!participants_.contains(iterator->participant_id)) {
            return std::unexpected(make_error(
                ErrorCode::invalid_state,
                "missing transaction participant during restore: " + iterator->participant_id
            ));
        }
    }

    std::optional<Error> first_failure;
    for (auto iterator = snapshots.rbegin(); iterator != snapshots.rend(); ++iterator) {
        const auto& participant = participants_.at(iterator->participant_id);
        const auto restored = participant.restore(iterator->payload);
        if (!restored && !first_failure) first_failure = restored.error();
    }

    if (first_failure) return std::unexpected(*first_failure);
    return {};
}

} // namespace civic
