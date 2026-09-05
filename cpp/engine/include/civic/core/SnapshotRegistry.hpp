#pragma once

#include <functional>
#include <map>
#include <string>
#include <string_view>
#include <vector>

#include <civic/core/Error.hpp>
#include <civic/core/Utf16Ordinal.hpp>

namespace civic {

using SnapshotProvider = std::function<Result<std::string>()>;

class SnapshotRegistry final {
public:
    [[nodiscard]] Result<void> registerProvider(std::string id, SnapshotProvider provider);
    [[nodiscard]] Result<std::string> capture(std::string_view id) const;
    [[nodiscard]] Result<std::map<std::string, std::string, Utf16OrdinalLess>> captureAll() const;
    [[nodiscard]] std::vector<std::string> listIds() const;

private:
    std::map<std::string, SnapshotProvider, Utf16OrdinalLess> providers_;
};

} // namespace civic
