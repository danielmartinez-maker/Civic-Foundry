#ifdef _WIN32

#include <civic/core/NativeEngine.hpp>
#include <civic/presentation/D3D12Backend.hpp>
#include <civic/presentation/NativeWindow.hpp>
#include <civic/presentation/Win32NativeUi.hpp>

#include <imgui.h>
#include <windows.h>

#include <cstdint>
#include <string>
#include <utility>

using namespace civic::presentation;

namespace {

int showError(const char* title, const std::string& message, int exit_code) {
    MessageBoxA(nullptr, message.c_str(), title, MB_OK | MB_ICONERROR);
    return exit_code;
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

void drawFrameworkShell(
    Win32NativeUi& ui,
    const UiFrameState& frame,
    bool authority_cutover_gated) {
    ImGui::DockSpaceOverViewport(
        0,
        ImGui::GetMainViewport(),
        ImGuiDockNodeFlags_PassthruCentralNode);

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
                ? "Simulation authority cutover is gated; this panel is presentation-only."
                : "Native simulation authority is available to presentation queries.");
    }
    ImGui::End();

    if (open != panel->open) (void)ui.model().setPanelOpen(panel->id, open);
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
    if (auto registered = ui.model().registerPanel({"framework-status", "Native Presentation", true, true}); !registered) {
        return showError("Civic Foundry Native UI Error", registered.error(), 5);
    }
    (*window)->setMessageHandler(&forwardNativeUiMessage, &ui);

    FrameSnapshot presentation_snapshot{};
    PresentationSettings presentation_settings{};

    while ((*window)->pumpMessages()) {
        for (const auto& event : (*window)->drainEvents()) {
            if (event.type == PlatformEventType::Resize && event.data1 > 0 && event.data2 > 0) {
                if (auto resized = backend.resize(static_cast<std::uint32_t>(event.data1), static_cast<std::uint32_t>(event.data2)); !resized) {
                    return showError("Civic Foundry Native Resize Error", resized.error(), 6);
                }
            }
        }

        presentation_snapshot.simulation_tick = (*engine)->tick();

        auto frame = backend.beginFrame();
        if (!frame) return showError("Civic Foundry Native Frame Error", frame.error(), 7);

        auto ui_frame = ui.beginFrame(presentation_snapshot, presentation_settings);
        if (!ui_frame) return showError("Civic Foundry Native UI Frame Error", ui_frame.error(), 8);
        drawFrameworkShell(ui, *ui_frame, authority_cutover_gated);

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
