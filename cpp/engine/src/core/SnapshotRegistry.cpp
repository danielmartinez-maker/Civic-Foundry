#include <civic/core/SnapshotRegistry.hpp>

#include <utility>

namespace civic {

Result<void> SnapshotRegistry::registerProvider(std::string id, SnapshotProvider provider) {
    if (!utf16_detail::validUtf8AndHasNonEcmaTrimCodePoint(id)) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, "snapshot provider id must not be empty"));
    }
    if (providers_.contains(id)) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, "duplicate snapshot provider: " + id));
    }
    providers_.emplace(std::move(id), std::move(provider));
    return {};
}

Result<std::string> SnapshotRegistry::capture(std::string_view id) const {
    const auto provider = providers_.find(id);
    if (provider == providers_.end()) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, "unknown snapshot provider: " + std::string{id}));
    }
    return provider->second();
}

Result<std::map<std::string, std::string, Utf16OrdinalLess>> SnapshotRegistry::captureAll() const {
    std::map<std::string, std::string, Utf16OrdinalLess> output;
    // Freeze the provider set before invoking providers so capture-all matches the TypeScript registry semantics.
    const auto ids = listIds();
    for (const auto& id : ids) {
        auto captured = capture(id);
        if (!captured) return std::unexpected(captured.error());
        output.emplace(id, std::move(*captured));
    }
    return output;
}

std::vector<std::string> SnapshotRegistry::listIds() const {
    std::vector<std::string> ids;
    ids.reserve(providers_.size());
    for (const auto& [id, provider] : providers_) {
        (void)provider;
        ids.push_back(id);
    }
    return ids;
}

} // namespace civic
