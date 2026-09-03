#ifdef _WIN32

#include <civic/core/NativeEngine.hpp>
#include <civic/persistence/SaveV9.hpp>
#include <civic/presentation/Audio.hpp>
#include <civic/presentation/D3D12Backend.hpp>
#include <civic/presentation/MiniaturePresentation.hpp>
#include <civic/presentation/NativeHud.hpp>
#include <civic/presentation/NativePanels.hpp>
#include <civic/presentation/NativeRenderer.hpp>
#include <civic/presentation/NativeTools.hpp>
#include <civic/presentation/NativeUi.hpp>
#include <civic/presentation/NativeWindow.hpp>
#include <civic/presentation/PresentationIO.hpp>
#include <civic/presentation/PresentationInvalidation.hpp>
#include <civic/presentation/ReleaseGates.hpp>
#include <civic/presentation/RenderPipeline.hpp>
#include <civic/presentation/SceneGeometry.hpp>
#include <civic/presentation/Win32NativeUi.hpp>
#include <civic/presentation/XAudio2Output.hpp>

#include <imgui.h>
#include <windows.h>

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

using namespace civic::presentation;

namespace {

using SteadyClock = std::chrono::steady_clock;

struct ToolEditorState {
    float road_start[2]{1.0F, 1.0F};
    float road_end[2]{4.0F, 1.0F};
    int road_class_index{0};
    char parcel_id[64]{"parcel:1"};
    char zoning_code[32]{"R-1"};
    float facility_position[2]{2.0F, 2.0F};
    char facility_type[64]{"clinic"};
    float utility_position[2]{3.0F, 3.0F};
    char utility_type[64]{"power"};
    float service_position[2]{4.0F, 4.0F};
    char service_type[64]{"fire"};
    float transit_stop_position[2]{5.0F, 5.0F};
    int transit_stop_kind_index{0};
    char transit_stop_a[64]{"stop:a"};
    char transit_stop_b[64]{"stop:b"};
    int transit_mode_index{0};
    float bulldoze_position[2]{6.0F, 6.0F};
};

struct PointerGestureState {
    Point2 down{};
    bool moved{};
};

class NativeClientCommandSink final : public ICommandSink {
public:
    explicit NativeClientCommandSink(bool authority_cutover_gated) noexcept
        : authority_cutover_gated_(authority_cutover_gated) {}

    std::expected<void, std::string> submit(const AuthoritativeCommand&) override {
        if (authority_cutover_gated_) {
            return std::unexpected("Authoritative domain cutover is gated; preview retained and no simulation state changed.");
        }
        return std::unexpected("Native authoritative domain command adapter is not bound; preview retained and no simulation state changed.");
    }

private:
    bool authority_cutover_gated_{};
};

int showError(const char* title, const std::string& message, int exit_code) {
    MessageBoxA(nullptr, message.c_str(), title, MB_OK | MB_ICONERROR);
    return exit_code;
}

double elapsedSeconds(SteadyClock::time_point start) noexcept {
    return std::chrono::duration<double>(SteadyClock::now() - start).count();
}

std::filesystem::path civicUserRoot() {
    wchar_t buffer[32768]{};
    const DWORD length = GetEnvironmentVariableW(
        L"LOCALAPPDATA",
        buffer,
        static_cast<DWORD>(sizeof(buffer) / sizeof(buffer[0])));
    if (length > 0U && length < sizeof(buffer) / sizeof(buffer[0])) {
        return std::filesystem::path(buffer) / L"Civic Foundry";
    }
    std::error_code ec;
    auto current = std::filesystem::current_path(ec);
    if (ec) current = std::filesystem::path(L".");
    return current / L"Civic Foundry";
}

void showNotice(
    NotificationCenter& notifications,
    std::string message,
    HudNoticeSeverity severity,
    double now_seconds,
    double ttl_seconds = 4.0) {
    (void)notifications.show(std::move(message), severity, now_seconds, ttl_seconds);
}

bool forwardNativeUiMessage(
    void* user_data,
    void* native_window,
    std::uint32_t message,
    std::uintptr_t wparam,
    std::intptr_t lparam) noexcept {
    auto* ui = static_cast<Win32NativeUi*>(user_data);
    if (!ui) return false;
    if (message == WM_DPICHANGED) {
        const auto dpi_x = static_cast<std::uint32_t>(wparam & 0xffffU);
        if (dpi_x > 0U) (void)ui->model().updateDpiScale(static_cast<float>(dpi_x) / 96.0F);
    }
    return ui->handleMessage(native_window, message, wparam, lparam);
}

void drawFrameworkPanel(
    Win32NativeUi& ui,
    const UiFrameState& frame,
    bool authority_cutover_gated,
    const NativeRendererStats& renderer_stats) {
    const auto panel = ui.model().panel("framework-status");
    if (!panel || !panel->open) return;
    bool open = panel->open;
    if (ImGui::Begin(panel->title.c_str(), &open)) {
        ImGui::TextUnformatted("Civic Foundry native presentation runtime");
        ImGui::Separator();
        ImGui::Text("Snapshot revision: %llu", static_cast<unsigned long long>(frame.snapshot_revision));
        ImGui::Text("UI scale: %.2fx", static_cast<double>(frame.effective_scale));
        ImGui::Text("GPU scene uploads: %llu", static_cast<unsigned long long>(renderer_stats.geometry_uploads));
        ImGui::Text("GPU draw calls: %llu", static_cast<unsigned long long>(renderer_stats.draw_calls));
        ImGui::Text("Accessibility: %s contrast, %s motion",
            frame.high_contrast ? "high" : "standard",
            frame.reduced_motion ? "reduced" : "standard");
        ImGui::TextDisabled("World controls: drag to pan, wheel to zoom, Q/E to rotate, Inspect + click to select.");
        ImGui::Separator();
        ImGui::TextWrapped(
            "%s",
            authority_cutover_gated
                ? "Simulation authority cutover is gated. Native presentation is active and remains read-only until the required domain authority branches are consolidated."
                : "Native simulation authority is queryable; command adapter binding is still required for mutations.");
    }
    ImGui::End();
    if (open != panel->open) (void)ui.model().setPanelOpen(panel->id, open);
}

void saveCity(
    civic::NativeEngine& engine,
    SaveFileWorkflow& workflow,
    const std::filesystem::path& save_path,
    CityHudState& hud,
    NotificationCenter& notifications,
    double now_seconds) {
    hud.save_status = SaveStatus::Saving;
    const auto payload = engine.saveV9();
    if (!payload) {
        hud.save_status = SaveStatus::Error;
        showNotice(notifications, "Save failed: " + payload.error().message, HudNoticeSeverity::Error, now_seconds, 7.0);
        return;
    }
    const auto written = workflow.writeAtomic(save_path, *payload);
    if (!written) {
        hud.save_status = SaveStatus::Error;
        showNotice(notifications, "Save failed: " + written.error(), HudNoticeSeverity::Error, now_seconds, 7.0);
        return;
    }
    hud.save_status = SaveStatus::Saved;
    showNotice(notifications, "City saved atomically.", HudNoticeSeverity::Success, now_seconds);
}

void loadCity(
    civic::NativeEngine& engine,
    SaveFileWorkflow& workflow,
    const std::filesystem::path& save_path,
    CityHudState& hud,
    NotificationCenter& notifications,
    double now_seconds) {
    const auto loaded = workflow.readValidated(save_path, [](std::string_view payload) {
        return civic::parseSaveV9(payload).has_value();
    });
    if (!loaded) {
        hud.save_status = SaveStatus::Error;
        showNotice(notifications, "Load failed: " + loaded.error(), HudNoticeSeverity::Error, now_seconds, 8.0);
        return;
    }
    const auto restored = engine.loadV9(loaded->payload);
    if (!restored) {
        hud.save_status = SaveStatus::Error;
        showNotice(notifications, "Load failed: " + restored.error().message, HudNoticeSeverity::Error, now_seconds, 8.0);
        return;
    }
    hud.save_status = SaveStatus::Clean;
    showNotice(
        notifications,
        loaded->used_backup ? "Primary save was invalid; loaded the last known-good backup." : "City loaded.",
        loaded->used_backup ? HudNoticeSeverity::Warning : HudNoticeSeverity::Success,
        now_seconds,
        loaded->used_backup ? 8.0 : 4.0);
}

void drawCityOverview(
    Win32NativeUi& ui,
    CityHudState& hud,
    civic::NativeEngine& engine,
    SaveFileWorkflow& save_workflow,
    const std::filesystem::path& save_path,
    NotificationCenter& notifications,
    double now_seconds) {
    const auto panel = ui.model().panel("city-overview");
    if (!panel || !panel->open) return;
    bool open = panel->open;
    if (ImGui::Begin(panel->title.c_str(), &open)) {
        ImGui::TextUnformatted(hud.city_name.c_str());
        ImGui::Separator();
        ImGui::Text("Tick: %llu", static_cast<unsigned long long>(hud.simulation_tick));
        ImGui::Text("Speed: %dx", hud.simulation_speed);
        const auto treasury = formatHudCurrency(hud.treasury);
        const auto population = formatHudCount(hud.population);
        ImGui::Text("Treasury: %s", treasury.c_str());
        ImGui::Text("Population: %s", population.c_str());
        if (hud.unemployment_rate) ImGui::Text("Unemployment: %.1f%%", *hud.unemployment_rate * 100.0);
        else ImGui::TextUnformatted("Unemployment: —");
        if (hud.occupied_housing && hud.housing_capacity) ImGui::Text("Housing: %.0f / %.0f", *hud.occupied_housing, *hud.housing_capacity);
        else ImGui::TextUnformatted("Housing: —");
        ImGui::Separator();
        ImGui::Text("Tool: %s", hud.current_tool.c_str());
        ImGui::Text("Overlay: %s", hud.current_overlay.c_str());
        ImGui::Text("Save: %s", saveStatusLabel(hud.save_status).data());
        if (ImGui::Button("Save City")) saveCity(engine, save_workflow, save_path, hud, notifications, now_seconds);
        ImGui::SameLine();
        if (ImGui::Button("Load City")) loadCity(engine, save_workflow, save_path, hud, notifications, now_seconds);
        ImGui::TextDisabled("— means authoritative data is not available on the current native authority branch.");
    }
    ImGui::End();
    if (open != panel->open) (void)ui.model().setPanelOpen(panel->id, open);
}

RoadClass selectedRoadClass(int index) noexcept {
    switch (index) {
        case 1: return RoadClass::Collector;
        case 2: return RoadClass::Arterial;
        case 3: return RoadClass::Avenue;
        case 4: return RoadClass::Expressway;
        case 5: return RoadClass::Highway;
        case 0:
        default: return RoadClass::Local;
    }
}

VehicleKind selectedTransitMode(int index) noexcept {
    switch (index) {
        case 1: return VehicleKind::Brt;
        case 2: return VehicleKind::Tram;
        case 3: return VehicleKind::Metro;
        case 4: return VehicleKind::Rail;
        case 0:
        default: return VehicleKind::Bus;
    }
}

TransitStopKind selectedTransitStopKind(int index) noexcept {
    return index == 1 ? TransitStopKind::MetroStation : TransitStopKind::BusStop;
}

void previewActiveTool(NativeToolWorkflow& tools, ToolEditorState& editor, NotificationCenter& notifications, double now_seconds) {
    std::expected<void, std::string> result{};
    switch (tools.activeTool()) {
        case NativeTool::Road:
            result = tools.previewRoad(
                {{static_cast<double>(editor.road_start[0]), static_cast<double>(editor.road_start[1])},
                 {static_cast<double>(editor.road_end[0]), static_cast<double>(editor.road_end[1])}},
                selectedRoadClass(editor.road_class_index));
            break;
        case NativeTool::Zone: result = tools.previewZone(editor.parcel_id, editor.zoning_code); break;
        case NativeTool::Facility:
            result = tools.previewFacility(
                {static_cast<double>(editor.facility_position[0]), static_cast<double>(editor.facility_position[1])},
                editor.facility_type);
            break;
        case NativeTool::Utility:
            result = tools.previewUtility(
                {static_cast<double>(editor.utility_position[0]), static_cast<double>(editor.utility_position[1])},
                editor.utility_type);
            break;
        case NativeTool::Service:
            result = tools.previewService(
                {static_cast<double>(editor.service_position[0]), static_cast<double>(editor.service_position[1])},
                editor.service_type);
            break;
        case NativeTool::TransitStop:
            result = tools.previewTransitStop(
                {static_cast<double>(editor.transit_stop_position[0]), static_cast<double>(editor.transit_stop_position[1])},
                selectedTransitStopKind(editor.transit_stop_kind_index));
            break;
        case NativeTool::Transit:
            result = tools.previewTransit(
                {std::string(editor.transit_stop_a), std::string(editor.transit_stop_b)},
                selectedTransitMode(editor.transit_mode_index));
            break;
        case NativeTool::Bulldoze:
            result = tools.previewBulldoze(
                {static_cast<double>(editor.bulldoze_position[0]), static_cast<double>(editor.bulldoze_position[1])});
            break;
        case NativeTool::Inspect:
        default: result = std::unexpected("Inspect has no mutating preview to confirm."); break;
    }
    if (!result) showNotice(notifications, result.error(), HudNoticeSeverity::Warning, now_seconds);
}

void drawToolEditor(NativeToolWorkflow& tools, ToolEditorState& editor) {
    static const char* road_classes[] = {"Local", "Collector", "Arterial", "Avenue", "Expressway", "Highway"};
    static const char* transit_modes[] = {"Bus", "BRT", "Tram", "Metro", "Rail"};
    static const char* transit_stop_kinds[] = {"Transit Stop", "Metro Station"};
    switch (tools.activeTool()) {
        case NativeTool::Road:
            ImGui::InputFloat2("Start", editor.road_start);
            ImGui::InputFloat2("End", editor.road_end);
            ImGui::Combo("Road class", &editor.road_class_index, road_classes, 6);
            break;
        case NativeTool::Zone:
            ImGui::InputText("Parcel ID", editor.parcel_id, sizeof(editor.parcel_id));
            ImGui::InputText("Zoning code", editor.zoning_code, sizeof(editor.zoning_code));
            break;
        case NativeTool::Facility:
            ImGui::InputFloat2("Position", editor.facility_position);
            ImGui::InputText("Facility type", editor.facility_type, sizeof(editor.facility_type));
            break;
        case NativeTool::Utility:
            ImGui::InputFloat2("Position##utility", editor.utility_position);
            ImGui::InputText("Utility type", editor.utility_type, sizeof(editor.utility_type));
            ImGui::TextDisabled("Current Alpha utility types include power and water.");
            break;
        case NativeTool::Service:
            ImGui::InputFloat2("Position##service", editor.service_position);
            ImGui::InputText("Service type", editor.service_type, sizeof(editor.service_type));
            ImGui::TextDisabled("Examples: fire, police, clinic, school, landfill, recycling.");
            break;
        case NativeTool::TransitStop:
            ImGui::InputFloat2("Position##transit-stop", editor.transit_stop_position);
            ImGui::Combo("Stop type", &editor.transit_stop_kind_index, transit_stop_kinds, 2);
            break;
        case NativeTool::Transit:
            ImGui::InputText("First stop", editor.transit_stop_a, sizeof(editor.transit_stop_a));
            ImGui::InputText("Second stop", editor.transit_stop_b, sizeof(editor.transit_stop_b));
            ImGui::Combo("Mode", &editor.transit_mode_index, transit_modes, 5);
            break;
        case NativeTool::Bulldoze:
            ImGui::InputFloat2("Position##bulldoze", editor.bulldoze_position);
            ImGui::TextDisabled("Bulldoze preview remains presentation-only until confirmation.");
            break;
        case NativeTool::Inspect:
        default: ImGui::TextUnformatted("Inspect reads presentation selections and submits no simulation command."); break;
    }
}

void drawToolPalette(
    Win32NativeUi& ui,
    NativeToolWorkflow& tools,
    ToolEditorState& editor,
    NativeUiController& controller,
    NotificationCenter& notifications,
    double now_seconds) {
    const auto panel = ui.model().panel("tool-palette");
    if (!panel || !panel->open) return;
    bool open = panel->open;
    if (ImGui::Begin(panel->title.c_str(), &open)) {
        if (ImGui::Button("Inspect##tool")) tools.activate(NativeTool::Inspect);
        ImGui::SameLine(); if (ImGui::Button("Road##tool")) tools.activate(NativeTool::Road);
        ImGui::SameLine(); if (ImGui::Button("Zone##tool")) tools.activate(NativeTool::Zone);
        ImGui::SameLine(); if (ImGui::Button("Facility##tool")) tools.activate(NativeTool::Facility);
        if (ImGui::Button("Utility##tool")) tools.activate(NativeTool::Utility);
        ImGui::SameLine(); if (ImGui::Button("Service##tool")) tools.activate(NativeTool::Service);
        ImGui::SameLine(); if (ImGui::Button("Transit Stop##tool")) tools.activate(NativeTool::TransitStop);
        ImGui::SameLine(); if (ImGui::Button("Transit##tool")) tools.activate(NativeTool::Transit);
        ImGui::SameLine(); if (ImGui::Button("Bulldoze##tool")) tools.activate(NativeTool::Bulldoze);
        ImGui::Separator();
        ImGui::Text("Active tool: %s", nativeToolLabel(tools.activeTool()).data());
        drawToolEditor(tools, editor);
        if (tools.activeTool() != NativeTool::Inspect && ImGui::Button("Preview")) previewActiveTool(tools, editor, notifications, now_seconds);
        const auto& preview = tools.preview();
        if (preview.valid) {
            ImGui::Separator();
            ImGui::Text("Preview: %s", preview.tool_id.c_str());
            ImGui::Text("Geometry points: %llu", static_cast<unsigned long long>(preview.geometry.size()));
            ImGui::TextDisabled("Preview is presentation-only. No authoritative state has changed.");
            if (ImGui::Button("Confirm")) {
                const auto committed = tools.commit(controller);
                if (committed) showNotice(notifications, "Authoritative tool command accepted.", HudNoticeSeverity::Success, now_seconds);
                else showNotice(notifications, committed.error(), HudNoticeSeverity::Warning, now_seconds, 6.0);
            }
            ImGui::SameLine();
            if (ImGui::Button("Cancel")) {
                tools.cancel();
                showNotice(notifications, "Tool preview cancelled.", HudNoticeSeverity::Info, now_seconds);
            }
        } else if (!preview.invalid_reason.empty()) {
            ImGui::Text("Preview invalid: %s", preview.invalid_reason.c_str());
        }
    }
    ImGui::End();
    if (open != panel->open) (void)ui.model().setPanelOpen(panel->id, open);
}

NativePanelSnapshot buildNativePanelSnapshot(const FrameSnapshot& snapshot, bool authority_cutover_gated) {
    NativePanelSnapshot panels{};
    panels.revision = snapshot.revision;
    if (snapshot.selection.active) {
        panels.inspector = InspectorSnapshot{
            .entity = snapshot.selection.entity,
            .title = "Selected entity",
            .fields = {{"Entity ID", snapshot.selection.entity.id}},
        };
    }
    const std::string status = authority_cutover_gated
        ? "Awaiting consolidated native authoritative query data"
        : "Native query adapter not yet bound";
    panels.management = {
        {"urban-fabric", "Urban Fabric", {{"Status", status}}, {}},
        {"transportation-transit", "Transportation & Transit", {{"Status", status}}, {}},
        {"economy-housing", "Economy & Housing", {{"Status", status}}, {}},
        {"services-utilities-government", "Services, Utilities & Government", {{"Status", status}}, {}},
        {"analytics", "Analytics & Why?", {{"Status", status}}, {}},
    };
    return panels;
}

void drawInspectorPanel(Win32NativeUi& ui, const NativePanelSnapshot& panels) {
    const auto panel = ui.model().panel("inspector");
    if (!panel || !panel->open) return;
    bool open = panel->open;
    if (ImGui::Begin(panel->title.c_str(), &open)) {
        if (!panels.inspector) ImGui::TextUnformatted("No presentation selection.");
        else {
            ImGui::TextUnformatted(panels.inspector->title.c_str());
            ImGui::Separator();
            for (const auto& field : panels.inspector->fields) ImGui::Text("%s: %s", field.label.c_str(), field.value.c_str());
        }
    }
    ImGui::End();
    if (open != panel->open) (void)ui.model().setPanelOpen(panel->id, open);
}

void drawManagementPanel(Win32NativeUi& ui, const NativePanelSnapshot& panels, std::string_view panel_id) {
    const auto ui_panel = ui.model().panel(panel_id);
    if (!ui_panel || !ui_panel->open) return;
    bool open = ui_panel->open;
    if (ImGui::Begin(ui_panel->title.c_str(), &open)) {
        const auto* data = findManagementPanel(panels, panel_id);
        if (!data) ImGui::TextUnformatted("No query snapshot is available for this panel.");
        else {
            for (const auto& field : data->fields) ImGui::Text("%s: %s", field.label.c_str(), field.value.c_str());
            if (!data->diagnostics.empty()) ImGui::Separator();
            for (const auto& diagnostic : data->diagnostics) {
                const auto trend = classifyTrend(diagnostic);
                ImGui::Text("%s: %.3f %s [%s]", diagnostic.label.c_str(), diagnostic.current_value, diagnostic.unit.c_str(), trendCue(trend).data());
                if (!diagnostic.history.empty()) {
                    std::vector<float> values;
                    values.reserve(diagnostic.history.size());
                    for (const auto& sample : diagnostic.history) values.push_back(static_cast<float>(sample.value));
                    ImGui::PlotLines(("##history-" + diagnostic.id).c_str(), values.data(), static_cast<int>(values.size()), 0, nullptr, FLT_MAX, FLT_MAX, ImVec2(0.0F, 60.0F));
                }
                if (!diagnostic.contributors.empty() && ImGui::TreeNode(("Why?##" + diagnostic.id).c_str())) {
                    for (const auto& contributor : diagnostic.contributors) {
                        ImGui::BulletText("%s: %+.3f — %s", contributor.label.c_str(), contributor.contribution, contributor.detail.c_str());
                    }
                    ImGui::TreePop();
                }
            }
            if (data->diagnostics.empty()) ImGui::TextDisabled("Historical series and causal traces appear here when the native analytics snapshot is bound.");
        }
    }
    ImGui::End();
    if (open != ui_panel->open) (void)ui.model().setPanelOpen(ui_panel->id, open);
}

void drawSettingsPanel(
    Win32NativeUi& ui,
    PresentationSettings& settings,
    SettingsStore& store,
    NotificationCenter& notifications,
    double now_seconds) {
    const auto panel = ui.model().panel("settings");
    if (!panel || !panel->open) return;
    bool open = panel->open;
    if (ImGui::Begin(panel->title.c_str(), &open)) {
        ImGui::SliderFloat("Master volume", &settings.master_volume, 0.0F, 1.0F);
        ImGui::SliderFloat("Music volume", &settings.music_volume, 0.0F, 1.0F);
        ImGui::SliderFloat("UI scale", &settings.ui_scale, 0.75F, 2.0F);
        ImGui::SliderFloat("Camera sensitivity", &settings.camera_sensitivity, 0.25F, 3.0F);
        ImGui::SliderFloat("Camera smoothing", &settings.camera_smoothing, 0.0F, 1.0F);
        ImGui::SliderFloat("Tilt-shift strength", &settings.tilt_shift_strength, 0.0F, 1.0F);
        ImGui::SliderFloat("Input sensitivity", &settings.input_sensitivity, 0.25F, 3.0F);
        ImGui::Checkbox("Visual effects", &settings.visual_effects);
        ImGui::Checkbox("Reduced motion", &settings.reduced_motion);
        ImGui::Checkbox("Color-independent cues", &settings.color_independent_cues);
        ImGui::Checkbox("High contrast", &settings.high_contrast);
        const char* severity_labels[] = {"Info", "Success", "Warning", "Error"};
        int severity = static_cast<int>(settings.minimum_alert_severity);
        if (ImGui::Combo("Minimum alert severity", &severity, severity_labels, 4)) {
            settings.minimum_alert_severity = static_cast<AlertSeverity>(std::clamp(severity, 0, 3));
        }
        if (ImGui::CollapsingHeader("Key bindings")) {
            ImGui::InputInt("Inspect key", &settings.keybindings.inspect);
            ImGui::InputInt("Road key", &settings.keybindings.road);
            ImGui::InputInt("Zone key", &settings.keybindings.zone);
            ImGui::InputInt("Facility key", &settings.keybindings.facility);
            ImGui::InputInt("Transit key", &settings.keybindings.transit);
            ImGui::InputInt("Cancel key", &settings.keybindings.cancel);
            ImGui::InputInt("Pause key", &settings.keybindings.speed_pause);
            ImGui::InputInt("Normal speed key", &settings.keybindings.speed_normal);
            ImGui::InputInt("Fast speed key", &settings.keybindings.speed_fast);
            ImGui::InputInt("Very fast speed key", &settings.keybindings.speed_very_fast);
        }
        if (ImGui::Button("Save Settings")) {
            settings = normalizeSettings(settings);
            const auto saved = store.save(settings);
            if (saved) showNotice(notifications, "Presentation settings saved.", HudNoticeSeverity::Success, now_seconds);
            else showNotice(notifications, "Settings save failed: " + saved.error(), HudNoticeSeverity::Error, now_seconds, 7.0);
        }
        ImGui::TextDisabled("User/machine settings are stored separately from deterministic city state.");
    }
    ImGui::End();
    if (open != panel->open) (void)ui.model().setPanelOpen(panel->id, open);
}

void drawNotification(const NotificationCenter& notifications, double now_seconds, const PresentationSettings& settings) {
    const auto notice = notifications.current(now_seconds);
    if (!notice || !hudNoticeMeetsMinimum(notice->severity, settings.minimum_alert_severity)) return;
    const auto* viewport = ImGui::GetMainViewport();
    ImGui::SetNextWindowPos(ImVec2(viewport->WorkPos.x + viewport->WorkSize.x * 0.5F, viewport->WorkPos.y + 12.0F), ImGuiCond_Always, ImVec2(0.5F, 0.0F));
    ImGui::SetNextWindowBgAlpha(0.94F);
    constexpr ImGuiWindowFlags flags = ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_AlwaysAutoResize | ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoDocking | ImGuiWindowFlags_NoNav;
    if (ImGui::Begin("##native-hud-notification", nullptr, flags)) ImGui::Text("[%s] %s", hudNoticeSeverityLabel(notice->severity).data(), notice->message.c_str());
    ImGui::End();
}

void applyShortcut(
    HudShortcutAction action,
    NativeToolWorkflow& tools,
    CityHudState& hud,
    NativeUiController& controller,
    NotificationCenter& notifications,
    double now_seconds) {
    switch (action) {
        case HudShortcutAction::InspectTool: tools.activate(NativeTool::Inspect); break;
        case HudShortcutAction::RoadTool: tools.activate(NativeTool::Road); break;
        case HudShortcutAction::ZoneTool: tools.activate(NativeTool::Zone); break;
        case HudShortcutAction::FacilityTool: tools.activate(NativeTool::Facility); break;
        case HudShortcutAction::TransitTool: tools.activate(NativeTool::Transit); break;
        case HudShortcutAction::CancelTool:
            tools.cancel();
            showNotice(notifications, "Tool preview cancelled.", HudNoticeSeverity::Info, now_seconds);
            break;
        case HudShortcutAction::SpeedPause:
        case HudShortcutAction::SpeedNormal:
        case HudShortcutAction::SpeedFast:
        case HudShortcutAction::SpeedVeryFast: {
            int speed = 1;
            if (action == HudShortcutAction::SpeedPause) speed = 0;
            if (action == HudShortcutAction::SpeedFast) speed = 2;
            if (action == HudShortcutAction::SpeedVeryFast) speed = 4;
            const auto changed = controller.setSimulationSpeed(speed);
            if (changed) {
                hud.simulation_speed = speed;
                showNotice(notifications, "Simulation speed command accepted.", HudNoticeSeverity::Success, now_seconds);
            } else showNotice(notifications, changed.error(), HudNoticeSeverity::Warning, now_seconds, 6.0);
            break;
        }
        case HudShortcutAction::None:
        default: break;
    }
    hud.current_tool = std::string(nativeToolId(tools.activeTool()));
}

bool applyCameraAndPickingInput(
    const std::vector<PlatformEvent>& events,
    bool mouse_captured,
    IsometricCamera& camera,
    InputState& pointer,
    PointerGestureState& gesture,
    const PresentationSettings& settings,
    NativeTool active_tool,
    const PickingIndex& picking,
    FrameSnapshot& snapshot) {
    bool presentation_changed = false;
    for (const auto& event : events) {
        switch (event.type) {
            case PlatformEventType::FocusLost:
                pointer.lostFocus();
                gesture.moved = false;
                break;
            case PlatformEventType::PointerCancel:
                pointer.pointerCancel(pointer.activePointerId());
                gesture.moved = false;
                break;
            case PlatformEventType::PointerDown:
                if (!mouse_captured) {
                    gesture.down = {event.x, event.y};
                    gesture.moved = false;
                    pointer.pointerDown(0, gesture.down);
                }
                break;
            case PlatformEventType::PointerMove: {
                const auto previous = pointer.pointerPosition();
                if (pointer.dragging()) {
                    const double total_dx = event.x - gesture.down.x;
                    const double total_dy = event.y - gesture.down.y;
                    if (std::hypot(total_dx, total_dy) > 4.0) gesture.moved = true;
                    pointer.pointerMove(pointer.activePointerId(), {event.x, event.y});
                    const double sensitivity = static_cast<double>(settings.camera_sensitivity * settings.input_sensitivity);
                    camera.pan((event.x - previous.x) * sensitivity, (event.y - previous.y) * sensitivity);
                    presentation_changed = true;
                }
                break;
            }
            case PlatformEventType::PointerUp: {
                const bool was_dragging = pointer.dragging();
                pointer.pointerUp(pointer.activePointerId());
                if (was_dragging && !gesture.moved && !mouse_captured && active_tool == NativeTool::Inspect) {
                    const auto world = camera.canvasToWorld(event.x, event.y, snapshot.world);
                    const auto picked = world ? picking.pickWorld(*world, 0.35 / std::max(0.45, camera.zoom())) : std::nullopt;
                    const SelectionState next = picked ? SelectionState{true, *picked} : SelectionState{};
                    if (!(next.active == snapshot.selection.active && (!next.active || next.entity == snapshot.selection.entity))) {
                        snapshot.selection = next;
                        presentation_changed = true;
                    }
                }
                gesture.moved = false;
                break;
            }
            case PlatformEventType::Wheel:
                if (!mouse_captured) {
                    const double exponent = event.wheel * static_cast<double>(settings.input_sensitivity);
                    camera.zoomBy(std::pow(1.12, exponent), event.x, event.y);
                    presentation_changed = true;
                }
                break;
            default: break;
        }
    }
    return presentation_changed;
}

void drawNativeHud(
    Win32NativeUi& ui,
    const UiFrameState& frame,
    bool authority_cutover_gated,
    CityHudState& hud,
    NativeToolWorkflow& tools,
    ToolEditorState& editor,
    NativeUiController& controller,
    NotificationCenter& notifications,
    const NativePanelSnapshot& panels,
    PresentationSettings& settings,
    SettingsStore& settings_store,
    civic::NativeEngine& engine,
    SaveFileWorkflow& save_workflow,
    const std::filesystem::path& save_path,
    const NativeRendererStats& renderer_stats,
    double now_seconds) {
    ImGui::DockSpaceOverViewport(0, ImGui::GetMainViewport(), ImGuiDockNodeFlags_PassthruCentralNode);
    hud.current_tool = std::string(nativeToolId(tools.activeTool()));
    drawCityOverview(ui, hud, engine, save_workflow, save_path, notifications, now_seconds);
    drawToolPalette(ui, tools, editor, controller, notifications, now_seconds);
    drawInspectorPanel(ui, panels);
    drawManagementPanel(ui, panels, "urban-fabric");
    drawManagementPanel(ui, panels, "transportation-transit");
    drawManagementPanel(ui, panels, "economy-housing");
    drawManagementPanel(ui, panels, "services-utilities-government");
    drawManagementPanel(ui, panels, "analytics");
    drawSettingsPanel(ui, settings, settings_store, notifications, now_seconds);
    drawFrameworkPanel(ui, frame, authority_cutover_gated, renderer_stats);
    drawNotification(notifications, now_seconds, settings);
}

} // namespace

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
    auto window = NativeWindow::create();
    if (!window) return showError("Civic Foundry Native", window.error(), 1);

    D3D12Backend backend{};
    if (auto initialized = backend.initialize((*window)->nativeHandle(), (*window)->clientWidth(), (*window)->clientHeight()); !initialized) {
        return showError("Civic Foundry Native GPU Error", initialized.error(), 2);
    }

    NativeRenderer renderer(backend);
    if (auto initialized = renderer.initialize(); !initialized) {
        return showError("Civic Foundry Native Renderer Error", initialized.error(), 3);
    }

    auto engine = civic::NativeEngine::create({});
    if (!engine) return showError("Civic Foundry Native Engine Error", engine.error().message, 4);

    std::array<DomainAuthorityEvidence, kAlphaGameplayAuthorityDomains.size()> authority_evidence{};
    for (std::size_t index = 0; index < kAlphaGameplayAuthorityDomains.size(); ++index) {
        const auto domain = kAlphaGameplayAuthorityDomains[index];
        const auto hash = (*engine)->domainHash(domain);
        authority_evidence[index] = DomainAuthorityEvidence{
            .domain = domain,
            .owned = hash && hash->ownership == civic::DomainOwnership::owned,
        };
    }
    const bool authority_cutover_gated = !alphaGameplayAuthorityReady(authority_evidence);
    if (authority_cutover_gated) {
        SetWindowTextW(static_cast<HWND>((*window)->nativeHandle()), L"Civic Foundry Native Client — presentation active / authority cutover gated");
    }

    const auto native_context = backend.nativeUiContext();
    Win32NativeUiConfig ui_config{};
    ui_config.window = (*window)->nativeHandle();
    ui_config.d3d12_device = native_context.device;
    ui_config.d3d12_command_queue = native_context.command_queue;
    ui_config.frames_in_flight = native_context.frames_in_flight;
    ui_config.rtv_format = native_context.rtv_format;
    auto native_ui = Win32NativeUi::create(ui_config);
    if (!native_ui) return showError("Civic Foundry Native UI Error", native_ui.error(), 5);

    Win32NativeUi ui = std::move(*native_ui);
    const UiPanelState panels[] = {
        {"city-overview", "City Overview", true, true},
        {"tool-palette", "Tools", true, true},
        {"inspector", "Inspector", true, true},
        {"urban-fabric", "Urban Fabric", false, true},
        {"transportation-transit", "Transportation & Transit", false, true},
        {"economy-housing", "Economy & Housing", false, true},
        {"services-utilities-government", "Services, Utilities & Government", false, true},
        {"analytics", "Analytics & Why?", false, true},
        {"settings", "Settings & Accessibility", false, true},
        {"framework-status", "Native Presentation", true, true},
    };
    for (const auto& panel : panels) {
        if (auto registered = ui.model().registerPanel(panel); !registered) return showError("Civic Foundry Native UI Error", registered.error(), 6);
    }
    (*window)->setMessageHandler(&forwardNativeUiMessage, &ui);

    const auto user_root = civicUserRoot();
    SettingsStore settings_store(user_root / L"settings.json");
    PresentationSettings presentation_settings{};
    if (const auto loaded_settings = settings_store.load(); loaded_settings) presentation_settings = *loaded_settings;
    presentation_settings = normalizeSettings(presentation_settings);
    const auto save_path = user_root / L"saves" / L"quick-save.cf9";
    SaveFileWorkflow save_workflow{};

    std::optional<XAudio2Output> audio_output;
    std::unique_ptr<NativeAudioRuntime> audio_runtime;
    std::string audio_initialization_error;
    if (auto created_audio = XAudio2Output::create(); created_audio) {
        audio_output.emplace(std::move(*created_audio));
        audio_runtime = std::make_unique<NativeAudioRuntime>(*audio_output);
    } else audio_initialization_error = created_audio.error();

    FrameSnapshot presentation_snapshot{};
    presentation_snapshot.world = {1U, 1U};
    CityHudState hud{};
    NotificationCenter notifications{};
    NativeToolWorkflow tools{};
    ToolEditorState editor{};
    NativeClientCommandSink command_sink(authority_cutover_gated);
    NativeUiController controller(command_sink);
    IsometricCamera camera{};
    InputState pointer_input{};
    PointerGestureState pointer_gesture{};
    PickingIndex picking_index{};
    PresentationInvalidationTracker invalidation_tracker{};
    RenderPacketBuilder packet_builder{};
    SceneGeometryBuilder geometry_builder{};
    std::optional<SceneGeometry> cached_geometry;
    CameraState cached_camera{};
    PixelViewport cached_viewport{};
    const auto client_start = SteadyClock::now();
    bool audio_error_reported = false;

    while ((*window)->pumpMessages()) {
        const auto events = (*window)->drainEvents();
        for (const auto& event : events) {
            if (event.type == PlatformEventType::Resize && event.data1 > 0 && event.data2 > 0) {
                if (auto resized = backend.resize(static_cast<std::uint32_t>(event.data1), static_cast<std::uint32_t>(event.data2)); !resized) {
                    return showError("Civic Foundry Native Resize Error", resized.error(), 7);
                }
            }
        }

        hud.simulation_tick = (*engine)->tick();
        hud.current_tool = std::string(nativeToolId(tools.activeTool()));
        presentation_snapshot.revision = hud.simulation_tick;
        presentation_snapshot.simulation_tick = hud.simulation_tick;
        presentation_snapshot.tool_preview = tools.preview();
        const auto record_changes = invalidation_tracker.syncRecords(presentation_snapshot);
        const bool world_changed = invalidation_tracker.syncWorld(presentation_snapshot.world);
        if (pickingNeedsRebuild(record_changes, world_changed)) {
            picking_index.rebuild(presentation_snapshot);
        }

        auto frame = backend.beginFrame();
        if (!frame) return showError("Civic Foundry Native Frame Error", frame.error(), 8);
        auto ui_frame = ui.beginFrame(presentation_snapshot, presentation_settings);
        if (!ui_frame) return showError("Civic Foundry Native UI Frame Error", ui_frame.error(), 9);

        const double now_seconds = elapsedSeconds(client_start);
        if (!audio_initialization_error.empty() && !audio_error_reported) {
            showNotice(notifications, "Native audio unavailable: " + audio_initialization_error, HudNoticeSeverity::Warning, now_seconds, 7.0);
            audio_error_reported = true;
        }

        const auto viewport = PixelViewport{(*window)->clientWidth(), (*window)->clientHeight()};
        const ShortcutContext shortcut_context{
            .ui_keyboard_capture = ui.wantsKeyboardCapture(),
            .editable_control_active = ui.wantsTextInput(),
        };
        for (const auto& event : events) {
            if (event.type != PlatformEventType::KeyDown) continue;
            if (!shortcut_context.ui_keyboard_capture && !shortcut_context.editable_control_active && (event.data1 == 'Q' || event.data1 == 'E')) {
                const int direction = event.data1 == 'Q' ? -1 : 1;
                camera.rotateAroundCanvasPoint(
                    direction,
                    presentation_snapshot.world,
                    {static_cast<double>(viewport.width) * 0.5, static_cast<double>(viewport.height) * 0.5});
                continue;
            }
            applyShortcut(
                resolveHudShortcut(event.data1, shortcut_context, presentation_settings.keybindings),
                tools,
                hud,
                controller,
                notifications,
                now_seconds);
        }
        (void)applyCameraAndPickingInput(
            events,
            ui.wantsMouseCapture(),
            camera,
            pointer_input,
            pointer_gesture,
            presentation_settings,
            tools.activeTool(),
            picking_index,
            presentation_snapshot);

        presentation_snapshot.tool_preview = tools.preview();
        const bool selection_changed = invalidation_tracker.syncSelection(presentation_snapshot.selection);
        const bool preview_changed = invalidation_tracker.syncToolPreview(presentation_snapshot.tool_preview);
        const auto camera_state = camera.state();
        const bool camera_changed =
            camera_state.zoom != cached_camera.zoom ||
            camera_state.quarter_turns != cached_camera.quarter_turns ||
            camera_state.pan_x != cached_camera.pan_x ||
            camera_state.pan_y != cached_camera.pan_y;
        const bool viewport_changed = viewport.width != cached_viewport.width || viewport.height != cached_viewport.height;
        const bool scene_changed = geometryNeedsRebuild(record_changes, world_changed, selection_changed, preview_changed);
        if (!cached_geometry || scene_changed || camera_changed || viewport_changed) {
            const auto packet = packet_builder.build(
                presentation_snapshot,
                {0.0, 0.0, static_cast<double>(presentation_snapshot.world.width), static_cast<double>(presentation_snapshot.world.height)});
            cached_geometry = geometry_builder.build(packet, camera, presentation_snapshot.world, viewport);
            cached_camera = camera_state;
            cached_viewport = viewport;
        }

        const auto treatment = deriveMiniatureTreatment(presentation_settings, viewport);
        if (auto rendered = renderer.render(*cached_geometry, *frame, treatment); !rendered) {
            return showError("Civic Foundry Native Scene Render Error", rendered.error(), 10);
        }

        if (audio_runtime) {
            if (auto audio = audio_runtime->update(presentation_snapshot, presentation_settings); !audio) {
                showNotice(notifications, "Native audio update failed: " + audio.error(), HudNoticeSeverity::Warning, now_seconds, 7.0);
                audio_runtime.reset();
            }
        }

        const auto panel_snapshot = buildNativePanelSnapshot(presentation_snapshot, authority_cutover_gated);
        drawNativeHud(
            ui, *ui_frame, authority_cutover_gated, hud, tools, editor, controller, notifications,
            panel_snapshot, presentation_settings, settings_store, **engine, save_workflow, save_path,
            renderer.stats(), now_seconds);

        const auto active_context = backend.nativeUiContext();
        if (auto rendered = ui.render(active_context.command_list); !rendered) return showError("Civic Foundry Native UI Render Error", rendered.error(), 11);
        auto fence = backend.submit(*frame);
        if (!fence) return showError("Civic Foundry Native Submit Error", fence.error(), 12);
        if (auto presented = backend.present(*frame); !presented) return showError("Civic Foundry Native Present Error", presented.error(), 13);
    }

    return 0;
}

#endif