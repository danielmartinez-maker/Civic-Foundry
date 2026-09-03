#include <civic/presentation/PresentationIO.hpp>

#include <json-c/json.h>

#include <algorithm>
#include <cerrno>
#include <cstring>
#include <fstream>
#include <iterator>
#include <system_error>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#else
#include <fcntl.h>
#include <unistd.h>
#endif

namespace civic::presentation {
namespace {

std::string systemMessage(const char* prefix) {
#ifdef _WIN32
    return std::string(prefix) + " (win32=" + std::to_string(GetLastError()) + ")";
#else
    return std::string(prefix) + ": " + std::strerror(errno);
#endif
}

std::expected<void, std::string> durableWrite(const std::filesystem::path& path, std::string_view payload) {
#ifdef _WIN32
    const HANDLE file = CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return std::unexpected(systemMessage("failed to create temporary save"));
    std::size_t offset = 0;
    while (offset < payload.size()) {
        const auto remaining = payload.size() - offset;
        const DWORD chunk = static_cast<DWORD>(std::min<std::size_t>(remaining, 1U << 20U));
        DWORD written = 0;
        if (!WriteFile(file, payload.data() + offset, chunk, &written, nullptr) || written != chunk) {
            const auto error = systemMessage("failed to write temporary save");
            CloseHandle(file);
            DeleteFileW(path.c_str());
            return std::unexpected(error);
        }
        offset += written;
    }
    if (!FlushFileBuffers(file)) {
        const auto error = systemMessage("failed to flush temporary save");
        CloseHandle(file);
        DeleteFileW(path.c_str());
        return std::unexpected(error);
    }
    if (!CloseHandle(file)) return std::unexpected(systemMessage("failed to close temporary save"));
    return {};
#else
    const int fd = ::open(path.c_str(), O_CREAT | O_TRUNC | O_WRONLY, 0644);
    if (fd < 0) return std::unexpected(systemMessage("failed to create temporary save"));
    std::size_t offset = 0;
    while (offset < payload.size()) {
        const ssize_t written = ::write(fd, payload.data() + offset, payload.size() - offset);
        if (written < 0) {
            const auto error = systemMessage("failed to write temporary save");
            ::close(fd);
            ::unlink(path.c_str());
            return std::unexpected(error);
        }
        offset += static_cast<std::size_t>(written);
    }
    if (::fsync(fd) != 0) {
        const auto error = systemMessage("failed to flush temporary save");
        ::close(fd);
        ::unlink(path.c_str());
        return std::unexpected(error);
    }
    if (::close(fd) != 0) return std::unexpected(systemMessage("failed to close temporary save"));
    return {};
#endif
}

std::expected<std::string, std::string> readFile(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) return std::unexpected("failed to open save file: " + path.string());
    return std::string((std::istreambuf_iterator<char>(input)), std::istreambuf_iterator<char>());
}

bool readNumber(json_object* root, const char* key, float& output) {
    json_object* value = nullptr;
    if (!json_object_object_get_ex(root, key, &value) ||
        !(json_object_is_type(value, json_type_double) || json_object_is_type(value, json_type_int))) return false;
    output = static_cast<float>(json_object_get_double(value));
    return true;
}

bool readBool(json_object* root, const char* key, bool& output) {
    json_object* value = nullptr;
    if (!json_object_object_get_ex(root, key, &value) || !json_object_is_type(value, json_type_boolean)) return false;
    output = json_object_get_boolean(value) != 0;
    return true;
}

bool readOptionalBool(json_object* root, const char* key, bool& output) {
    json_object* value = nullptr;
    if (!json_object_object_get_ex(root, key, &value)) return true;
    if (!json_object_is_type(value, json_type_boolean)) return false;
    output = json_object_get_boolean(value) != 0;
    return true;
}

bool readOptionalInt(json_object* root, const char* key, int& output) {
    json_object* value = nullptr;
    if (!json_object_object_get_ex(root, key, &value)) return true;
    if (!json_object_is_type(value, json_type_int)) return false;
    output = json_object_get_int(value);
    return true;
}

bool readOptionalSeverity(json_object* root, AlertSeverity& output) {
    int value = static_cast<int>(output);
    if (!readOptionalInt(root, "minimumAlertSeverity", value)) return false;
    if (value < static_cast<int>(AlertSeverity::Info) || value > static_cast<int>(AlertSeverity::Error)) return false;
    output = static_cast<AlertSeverity>(value);
    return true;
}

bool readOptionalKeyBindings(json_object* root, KeyBindings& bindings) {
    json_object* keybindings = nullptr;
    if (!json_object_object_get_ex(root, "keybindings", &keybindings)) return true;
    if (!json_object_is_type(keybindings, json_type_object)) return false;
    return
        readOptionalInt(keybindings, "inspect", bindings.inspect) &&
        readOptionalInt(keybindings, "road", bindings.road) &&
        readOptionalInt(keybindings, "zone", bindings.zone) &&
        readOptionalInt(keybindings, "facility", bindings.facility) &&
        readOptionalInt(keybindings, "transit", bindings.transit) &&
        readOptionalInt(keybindings, "cancel", bindings.cancel) &&
        readOptionalInt(keybindings, "speedPause", bindings.speed_pause) &&
        readOptionalInt(keybindings, "speedNormal", bindings.speed_normal) &&
        readOptionalInt(keybindings, "speedFast", bindings.speed_fast) &&
        readOptionalInt(keybindings, "speedVeryFast", bindings.speed_very_fast);
}

void writeKeyBindings(json_object* root, const KeyBindings& bindings) {
    json_object* keybindings = json_object_new_object();
    if (!keybindings) return;
    json_object_object_add(keybindings, "inspect", json_object_new_int(bindings.inspect));
    json_object_object_add(keybindings, "road", json_object_new_int(bindings.road));
    json_object_object_add(keybindings, "zone", json_object_new_int(bindings.zone));
    json_object_object_add(keybindings, "facility", json_object_new_int(bindings.facility));
    json_object_object_add(keybindings, "transit", json_object_new_int(bindings.transit));
    json_object_object_add(keybindings, "cancel", json_object_new_int(bindings.cancel));
    json_object_object_add(keybindings, "speedPause", json_object_new_int(bindings.speed_pause));
    json_object_object_add(keybindings, "speedNormal", json_object_new_int(bindings.speed_normal));
    json_object_object_add(keybindings, "speedFast", json_object_new_int(bindings.speed_fast));
    json_object_object_add(keybindings, "speedVeryFast", json_object_new_int(bindings.speed_very_fast));
    json_object_object_add(root, "keybindings", keybindings);
}

} // namespace

std::expected<void, std::string> SaveFileWorkflow::writeAtomic(
    const std::filesystem::path& target,
    std::string_view payload) const {
    if (target.empty()) return std::unexpected("save target path is empty");
    std::error_code ec;
    if (!target.parent_path().empty()) std::filesystem::create_directories(target.parent_path(), ec);
    if (ec) return std::unexpected("failed to create save directory: " + ec.message());

    auto temporary = target;
    temporary += ".tmp";
    auto backup = target;
    backup += ".bak";
    if (auto written = durableWrite(temporary, payload); !written) return written;

#ifdef _WIN32
    const bool target_exists = std::filesystem::exists(target, ec) && !ec;
    if (target_exists) {
        DeleteFileW(backup.c_str());
        if (!ReplaceFileW(target.c_str(), temporary.c_str(), backup.c_str(), REPLACEFILE_IGNORE_MERGE_ERRORS, nullptr, nullptr)) {
            DeleteFileW(temporary.c_str());
            return std::unexpected(systemMessage("failed to atomically replace save"));
        }
    } else if (!MoveFileExW(temporary.c_str(), target.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
        DeleteFileW(temporary.c_str());
        return std::unexpected(systemMessage("failed to atomically install save"));
    }
#else
    const bool target_exists = std::filesystem::exists(target, ec) && !ec;
    if (target_exists) {
        std::error_code remove_error;
        std::filesystem::remove(backup, remove_error);
        if (::rename(target.c_str(), backup.c_str()) != 0) {
            ::unlink(temporary.c_str());
            return std::unexpected(systemMessage("failed to preserve previous save backup"));
        }
    }
    if (::rename(temporary.c_str(), target.c_str()) != 0) {
        const auto install_error = systemMessage("failed to atomically replace save");
        ::unlink(temporary.c_str());
        if (target_exists) (void)::rename(backup.c_str(), target.c_str());
        return std::unexpected(install_error);
    }
    if (!target.parent_path().empty()) {
        const int dir = ::open(target.parent_path().c_str(), O_RDONLY | O_DIRECTORY);
        if (dir >= 0) { (void)::fsync(dir); (void)::close(dir); }
    }
#endif
    return {};
}

std::expected<LoadedSavePayload, std::string> SaveFileWorkflow::readValidated(
    const std::filesystem::path& target,
    const std::function<bool(std::string_view)>& validator) const {
    if (target.empty()) return std::unexpected("save target path is empty");
    if (!validator) return std::unexpected("save validator is required");

    auto backup = target;
    backup += ".bak";
    std::string primary_error = "primary save is unavailable";
    if (auto primary = readFile(target); primary) {
        if (validator(*primary)) return LoadedSavePayload{.payload = std::move(*primary), .used_backup = false};
        primary_error = "primary save failed validation";
    } else {
        primary_error = primary.error();
    }

    if (auto fallback = readFile(backup); fallback) {
        if (validator(*fallback)) return LoadedSavePayload{.payload = std::move(*fallback), .used_backup = true};
        return std::unexpected(primary_error + "; backup save also failed validation");
    }
    return std::unexpected(primary_error + "; no valid backup is available");
}

std::expected<PresentationSettings, std::string> SettingsStore::load() const {
    std::error_code ec;
    if (!std::filesystem::exists(path_, ec)) return PresentationSettings{};
    std::ifstream input(path_, std::ios::binary);
    if (!input) return std::unexpected("failed to open presentation settings");
    const std::string text((std::istreambuf_iterator<char>(input)), {});
    json_tokener* tokener = json_tokener_new();
    if (!tokener) return std::unexpected("failed to allocate settings parser");
    json_object* root = json_tokener_parse_ex(tokener, text.data(), static_cast<int>(text.size()));
    const auto parse_error = json_tokener_get_error(tokener);
    json_tokener_free(tokener);
    if (!root || parse_error != json_tokener_success || !json_object_is_type(root, json_type_object)) {
        if (root) json_object_put(root);
        return std::unexpected("presentation settings are corrupt");
    }
    PresentationSettings settings{};
    const bool valid =
        readNumber(root, "masterVolume", settings.master_volume) &&
        readNumber(root, "musicVolume", settings.music_volume) &&
        readNumber(root, "uiScale", settings.ui_scale) &&
        readNumber(root, "cameraSensitivity", settings.camera_sensitivity) &&
        readNumber(root, "cameraSmoothing", settings.camera_smoothing) &&
        readNumber(root, "tiltShiftStrength", settings.tilt_shift_strength) &&
        readNumber(root, "inputSensitivity", settings.input_sensitivity) &&
        readBool(root, "reducedMotion", settings.reduced_motion) &&
        readBool(root, "colorIndependentCues", settings.color_independent_cues) &&
        readOptionalBool(root, "visualEffects", settings.visual_effects) &&
        readOptionalBool(root, "highContrast", settings.high_contrast) &&
        readOptionalSeverity(root, settings.minimum_alert_severity) &&
        readOptionalKeyBindings(root, settings.keybindings);
    json_object_put(root);
    if (!valid) return std::unexpected("presentation settings schema is invalid");
    return normalizeSettings(settings);
}

std::expected<void, std::string> SettingsStore::save(const PresentationSettings& requested) const {
    const auto settings = normalizeSettings(requested);
    json_object* root = json_object_new_object();
    if (!root) return std::unexpected("failed to allocate settings object");
    json_object_object_add(root, "masterVolume", json_object_new_double(settings.master_volume));
    json_object_object_add(root, "musicVolume", json_object_new_double(settings.music_volume));
    json_object_object_add(root, "uiScale", json_object_new_double(settings.ui_scale));
    json_object_object_add(root, "cameraSensitivity", json_object_new_double(settings.camera_sensitivity));
    json_object_object_add(root, "cameraSmoothing", json_object_new_double(settings.camera_smoothing));
    json_object_object_add(root, "tiltShiftStrength", json_object_new_double(settings.tilt_shift_strength));
    json_object_object_add(root, "inputSensitivity", json_object_new_double(settings.input_sensitivity));
    json_object_object_add(root, "reducedMotion", json_object_new_boolean(settings.reduced_motion));
    json_object_object_add(root, "colorIndependentCues", json_object_new_boolean(settings.color_independent_cues));
    json_object_object_add(root, "visualEffects", json_object_new_boolean(settings.visual_effects));
    json_object_object_add(root, "highContrast", json_object_new_boolean(settings.high_contrast));
    json_object_object_add(root, "minimumAlertSeverity", json_object_new_int(static_cast<int>(settings.minimum_alert_severity)));
    writeKeyBindings(root, settings.keybindings);
    const char* serialized = json_object_to_json_string_ext(root, JSON_C_TO_STRING_PRETTY);
    const std::string text = serialized ? serialized : "";
    json_object_put(root);
    if (text.empty()) return std::unexpected("failed to serialize presentation settings");
    return SaveFileWorkflow{}.writeAtomic(path_, text);
}

} // namespace civic::presentation
