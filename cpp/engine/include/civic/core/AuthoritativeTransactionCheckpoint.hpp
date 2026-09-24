#pragma once

#include <cstddef>
#include <functional>
#include <map>
#include <span>
#include <string>
#include <vector>

#include <civic/core/Error.hpp>
#include <civic/core/Utf16Ordinal.hpp>

namespace civic {

struct TransactionSnapshot final {
    std::string participant_id;
    std::vector<std::byte> payload;
};

struct TransactionParticipant final {
    std::string id;
    std::function<Result<std::vector<std::byte>>()> snapshot;
    std::function<Result<void>(std::span<const std::byte>)> restore;
};

class AuthoritativeTransactionCheckpoint final {
public:
    [[nodiscard]] Result<void> registerParticipant(TransactionParticipant participant);
    [[nodiscard]] Result<std::vector<TransactionSnapshot>> capture() const;
    [[nodiscard]] Result<void> restore(std::span<const TransactionSnapshot> snapshots) const;

private:
    std::map<std::string, TransactionParticipant, Utf16OrdinalLess> participants_;
};

} // namespace civic
