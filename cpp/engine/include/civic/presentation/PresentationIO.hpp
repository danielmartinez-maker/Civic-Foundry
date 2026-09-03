#pragma once

#include <civic/presentation/Presentation.hpp>

#include <expected>
#include <filesystem>
#include <functional>
#include <string>
#include <string_view>

namespace civic::presentation {

struct LoadedSavePayload {
    std::string payload;
    bool used_backup{false};
};

class SaveFileWorkflow {
public:
    [[nodiscard]] std::expected<void, std::string> writeAtomic(
        const std::filesystem::path& target,
        std::string_view payload) const;
    [[nodiscard]] std::expected<LoadedSavePayload, std::string> readValidated(
        const std::filesystem::path& target,
        const std::function<bool(std::string_view)>& validator) const;
};

class SettingsStore {
public:
    explicit SettingsStore(std::filesystem::path path) : path_(std::move(path)) {}
    [[nodiscard]] std::expected<PresentationSettings, std::string> load() const;
    [[nodiscard]] std::expected<void, std::string> save(const PresentationSettings& settings) const;
    [[nodiscard]] const std::filesystem::path& path() const noexcept { return path_; }
private:
    std::filesystem::path path_;
};

} // namespace civic::presentation
