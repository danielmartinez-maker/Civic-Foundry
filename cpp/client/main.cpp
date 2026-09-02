#ifdef _WIN32

#include <civic/core/NativeEngine.hpp>
#include <civic/presentation/D3D12Backend.hpp>
#include <civic/presentation/NativeHud.hpp>
#include <civic/presentation/NativeTools.hpp>
#include <civic/presentation/NativeUi.hpp>
#include <civic/presentation/NativeWindow.hpp>
#include <civic/presentation/Win32NativeUi.hpp>

#include <imgui.h>
#include <windows.h>

#include <chrono>
#include <cstdint>
#include <string>
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
    char transit_stop_a[64]{"stop:a"};
    char transit_stop_b[64]{"stop:b"};
    int transit_mode_index{0};
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
        if (dpi_x > 0U) {
            (void)ui->model().updateDpiScale(static_cast<float>(dpi_x) / 96.0F);
        }
    }

    return ui->handleMessage(native_window, message, wparam, lparam);
}

void drawFrameworkPanel(
    Win32NativeUi& ui,
    const UiFrameState& frame,
    bool authority_cutover_gated) {
    const auto panel = ui.model().panel("framework-status");
    if (!panel || !panel->open) return;

    bool open = panel->open;
    if (ImGui::Begin(panel->title.c_str(), &open)) {
        ImGui::TextUnformatted("Civic Foundry native presentation runtime");
        ImGui::Separator();
        ImGui::Text("Snapshot revision: %llu", static_cast<unsigned long long>(frame.snapshot_revision));
        ImGui::Text("UI scale: %.2fx", static_cast<double>(frame.effective_scale));
        ImGui::TextUnformatted(
            authority_cutover_gated
                ? "Simulation authority cutover is gated. Presentation remains read-only until native domain authority is bound."
                : "Native simulation authority is queryable; command adapter binding is still required for mutations.");
    }
    ImGui::End();

    if (open != panel->open) (void)ui.model().setPanelOpen(panel->id, open);
}

void drawCityOverview(Win32NativeUi& ui, const CityHudState& hud) {
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

        if (hud.unemployment_rate) {
            ImGui::Text("Unemployment: %.1f%%", *hud.unemployment_rate * 100.0);
        } else {
            ImGui::TextUnformatted("Unemployment: —");
        }

        if (hud.occupied_housing && hud.housing_capacity) {
            ImGui::Text(
                "Housing: %.0f / %.0f",
                *hud.occupied_housing,
                *hud.housing_capacity);
        } else {
            ImGui::TextUnformatted("Housing: —");
        }

        ImGui::Separator();
        ImGui::Text("Tool: %s", hud.current_tool.c_str());
        ImGui::Text("Overlay: %s", hud.current_overlay.c_str());
        ImGui::Text("Save: %s", saveStatusLabel(hud.save_status).data());
        ImGui::TextDisabled("— means authoritative data is not available on this presentation branch.");
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

void previewActiveTool(
    NativeToolWorkflow& tools,
    ToolEditorState& editor,
    NotificationCenter& notifications,
    double now_seconds) {
    std::expected<void, std::string> result{};
    switch (tools.activeTool()) {
        case NativeTool::Road:
            result = tools.previewRoad(
                {{static_cast<double>(editor.road_start[0]), static_cast<double>(editor.road_start[1])},
                 {static_cast<double>(editor.road_end[0]), static_cast<double>(editor.road_end[1])}},
                selectedRoadClass(editor.road_class_index));
            break;
        case NativeTool::Zone:
            result = tools.previewZone(editor.parcel_id, editor.zoning_code);
            break;
        case NativeTool::Facility:
            result = tools.previewFacility(
                {static_cast<double>(editor.facility_position[0]), static_cast<double>(editor.facility_position[1])},
                editor.facility_type);
            break;
        case NativeTool::Transit:
            result = tools.previewTransit(
                {std::string(editor.transit_stop_a), std::string(editor.transit_stop_b)},
                selectedTransitMode(editor.transit_mode_index));
            break;
        case NativeTool::Inspect:
        default:
            result = std::unexpected("Inspect has no mutating preview to confirm.");
            break;
    }

    if (!result) showNotice(notifications, result.error(), HudNoticeSeverity::Warning, now_seconds);
}

void drawToolEditor(NativeToolWorkflow& tools, ToolEditorState& editor) {
    static const char* road_classes[] = {"Local", "Collector", "Arterial", "Avenue", "Expressway", "Highway"};
    static const char* transit_modes[] = {"Bus", "BRT", "Tram", "Metro", "Rail"};

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
        case NativeTool::Transit:
            ImGui::InputText("First stop", editor.transit_stop_a, sizeof(editor.transit_stop_a));
            ImGui::InputText("Second stop", editor.transit_stop_b, sizeof(editor.transit_stop_b));
            ImGui::Combo("Mode", &editor.transit_mode_index, transit_modes, 5);
            break;
        case NativeTool::Inspect:
        default:
            ImGui::TextUnformatted("Inspect reads presentation selections and submits no simulation command.");
            break;
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
        ImGui::SameLine();
        if (ImGui::Button("Road##tool")) tools.activate(NativeTool::Road);
        ImGui::SameLine();
        if (ImGui::Button("Zone##tool")) tools.activate(NativeTool::Zone);
        ImGui::SameLine();
        if (ImGui::Button("Facility##tool")) tools.activate(NativeTool::Facility);
        ImGui::SameLine();
        if (ImGui::Button("Transit##tool")) tools.activate(NativeTool::Transit);

        ImGui::Separator();
        ImGui::Text("Active tool: %s", nativeToolLabel(tools.activeTool()).data());
        drawToolEditor(tools, editor);

        if (tools.activeTool() != NativeTool::Inspect) {
            if (ImGui::Button("Preview")) previewActiveTool(tools, editor, notifications, now_seconds);
        }

        const auto& preview = tools.preview();
        if (preview.valid) {
            ImGui::Separator();
            ImGui::Text("Preview: %s", preview.tool_id.c_str());
            ImGui::Text("Geometry points: %llu", static_cast<unsigned long long>(preview.geometry.size()));
            ImGui::TextDisabled("Preview is presentation-only. No authoritative state has changed.");

            if (ImGui::Button("Confirm")) {
                const auto committed = tools.commit(controller);
                if (committed) {
                    showNotice(notifications, "Authoritative tool command accepted.", HudNoticeSeverity::Success, now_seconds);
                } else {
                    showNotice(notifications, committed.error(), HudNoticeSeverity::Warning, now_seconds, 6.0);
                }
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

void drawNotification(const NotificationCenter& notifications, double now_seconds) {
    const auto notice = notifications.current(now_seconds);
    if (!notice) return;

    const auto* viewport = ImGui::GetMainViewport();
    ImGui::SetNextWindowPos(
        ImVec2(viewport->WorkPos.x + viewport->WorkSize.x * 0.5F, viewport->WorkPos.y + 12.0F),
        ImGuiCond_Always,
        ImVec2(0.5F, 0.0F));
    ImGui::SetNextWindowBgAlpha(0.94F);
    constexpr ImGuiWindowFlags flags =
        ImGuiWindowFlags_NoDecoration |
        ImGuiWindowFlags_AlwaysAutoResize |
        ImGuiWindowFlags_NoSavedSettings |
        ImGuiWindowFlags_NoDocking |
        ImGuiWindowFlags_NoNav;
    if (ImGui::Begin("##native-hud-notification", nullptr, flags)) {
        ImGui::Text("[%s] %s", hudNoticeSeverityLabel(notice->severity).data(), notice->message.c_str());
    }
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
            } else {
                showNotice(notifications, changed.error(), HudNoticeSeverity::Warning, now_seconds, 6.0);
            }
            break;
        }
        case HudShortcutAction::None:
        default:
            break;
    }
    hud.current_tool = std::string(nativeToolId(tools.activeTool()));
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
    double now_seconds) {
    ImGui::DockSpaceOverViewport(
        0,
        ImGui::GetMainViewport(),
        ImGuiDockNodeFlags_PassthruCentralNode);

    hud.current_tool = std::string(nativeToolId(tools.activeTool()));
    drawCityOverview(ui, hud);
    drawToolPalette(ui, tools, editor, controller, notifications, now_seconds);
    drawFrameworkPanel(ui, frame, authority_cutover_gated);
    drawNotification(notifications, now_seconds);
}

} // namespace

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
    auto window = NativeWindow::create();
    if (!window) return showError("Civic Foundry Native", window.error(), 1);

    D3D12Backend backend{};
    if (auto initialized = backend.initialize((*window)->nativeHandle(), (*window)->clientWidth(), (*window)->clientHeight()); !initialized) {
        return showError("Civic Foundry Native GPU Error", initialized.error(), 2);
    }

    auto engine = civic::NativeEngine::create({});
    if (!engine) return showError("Civic Foundry Native Engine Error", engine.error().message, 3);

    const auto world = (*engine)->domainHash("world");
    const bool authority_cutover_gated = !world || world->ownership == civic::DomainOwnership::unowned;
    if (authority_cutover_gated) {
        SetWindowTextW(
            static_cast<HWND>((*window)->nativeHandle()),
            L"Civic Foundry Native Client — presentation active / authority cutover gated");
    }

    const auto native_context = backend.nativeUiContext();
    Win32NativeUiConfig ui_config{};
    ui_config.window = (*window)->nativeHandle();
    ui_config.d3d12_device = native_context.device;
    ui_config.d3d12_command_queue = native_context.command_queue;
    ui_config.frames_in_flight = native_context.frames_in_flight;
    ui_config.rtv_format = native_context.rtv_format;
    auto native_ui = Win32NativeUi::create(ui_config);
    if (!native_ui) return showError("Civic Foundry Native UI Error", native_ui.error(), 4);

    Win32NativeUi ui = std::move(*native_ui);
    const UiPanelState panels[] = {
        {"city-overview", "City Overview", true, true},
        {"tool-palette", "Tools", true, true},
        {"framework-status", "Native Presentation", true, true},
    };
    for (const auto& panel : panels) {
        if (auto registered = ui.model().registerPanel(panel); !registered) {
            return showError("Civic Foundry Native UI Error", registered.error(), 5);
        }
    }
    (*window)->setMessageHandler(&forwardNativeUiMessage, &ui);

    FrameSnapshot presentation_snapshot{};
    PresentationSettings presentation_settings{};
    CityHudState hud{};
    NotificationCenter notifications{};
    NativeToolWorkflow tools{};
    ToolEditorState editor{};
    NativeClientCommandSink command_sink(authority_cutover_gated);
    NativeUiController controller(command_sink);
    const auto client_start = SteadyClock::now();

    while ((*window)->pumpMessages()) {
        const auto events = (*window)->drainEvents();
        for (const auto& event : events) {
            if (event.type == PlatformEventType::Resize && event.data1 > 0 && event.data2 > 0) {
                if (auto resized = backend.resize(static_cast<std::uint32_t>(event.data1), static_cast<std::uint32_t>(event.data2)); !resized) {
                    return showError("Civic Foundry Native Resize Error", resized.error(), 6);
                }
            }
        }

        hud.simulation_tick = (*engine)->tick();
        hud.current_tool = std::string(nativeToolId(tools.activeTool()));
        presentation_snapshot.simulation_tick = hud.simulation_tick;
        presentation_snapshot.tool_preview = tools.preview();

        auto frame = backend.beginFrame();
        if (!frame) return showError("Civic Foundry Native Frame Error", frame.error(), 7);

        auto ui_frame = ui.beginFrame(presentation_snapshot, presentation_settings);
        if (!ui_frame) return showError("Civic Foundry Native UI Frame Error", ui_frame.error(), 8);

        const double now_seconds = elapsedSeconds(client_start);
        const ShortcutContext shortcut_context{
            .ui_keyboard_capture = ui.wantsKeyboardCapture(),
            .editable_control_active = ui.wantsTextInput(),
        };
        for (const auto& event : events) {
            if (event.type != PlatformEventType::KeyDown) continue;
            applyShortcut(
                resolveHudShortcut(event.data1, shortcut_context),
                tools,
                hud,
                controller,
                notifications,
                now_seconds);
        }

        presentation_snapshot.tool_preview = tools.preview();
        drawNativeHud(
            ui,
            *ui_frame,
            authority_cutover_gated,
            hud,
            tools,
            editor,
            controller,
            notifications,
            now_seconds);

        const auto active_context = backend.nativeUiContext();
        if (auto rendered = ui.render(active_context.command_list); !rendered) {
            return showError("Civic Foundry Native UI Render Error", rendered.error(), 9);
        }

        auto fence = backend.submit(*frame);
        if (!fence) return showError("Civic Foundry Native Submit Error", fence.error(), 10);
        if (auto presented = backend.present(*frame); !presented) {
            return showError("Civic Foundry Native Present Error", presented.error(), 11);
        }
    }

    return 0;
}

#endif
