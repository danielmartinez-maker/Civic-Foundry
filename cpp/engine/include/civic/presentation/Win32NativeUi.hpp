#pragma once

#include <civic/presentation/NativeUiRuntime.hpp>

#include <cstdint>
#include <expected>
#include <memory>
#include <string>

namespace civic::presentation {

#ifdef _WIN32

struct Win32NativeUiConfig {
    void* window{};
    void* d3d12_device{};
    void* d3d12_command_queue{};
    std::uint32_t frames_in_flight{2};
    std::uint32_t descriptor_capacity{64};
    std::uint32_t rtv_format{87}; // DXGI_FORMAT_B8G8R8A8_UNORM
};

class Win32NativeUi final {
public:
    ~Win32NativeUi();
    Win32NativeUi(Win32NativeUi&&) noexcept;
    Win32NativeUi& operator=(Win32NativeUi&&) noexcept;
    Win32NativeUi(const Win32NativeUi&) = delete;
    Win32NativeUi& operator=(const Win32NativeUi&) = delete;

    [[nodiscard]] static std::expected<Win32NativeUi, std::string> create(const Win32NativeUiConfig& config);

    [[nodiscard]] std::expected<UiFrameState, std::string> beginFrame(
        const FrameSnapshot& snapshot,
        PresentationSettings settings);
    [[nodiscard]] std::expected<void, std::string> render(void* d3d12_graphics_command_list);

    [[nodiscard]] bool handleMessage(
        void* window,
        std::uint32_t message,
        std::uintptr_t wparam,
        std::intptr_t lparam) noexcept;
    [[nodiscard]] bool wantsKeyboardCapture() const noexcept;
    [[nodiscard]] bool wantsMouseCapture() const noexcept;
    [[nodiscard]] NativeUiRuntimeModel& model() noexcept;
    [[nodiscard]] const NativeUiRuntimeModel& model() const noexcept;

private:
    struct Impl;
    explicit Win32NativeUi(std::unique_ptr<Impl> impl) noexcept;
    std::unique_ptr<Impl> impl_;
};

#endif

} // namespace civic::presentation
