#pragma once

#ifdef _WIN32

#include <civic/presentation/Platform.hpp>

#include <cstdint>
#include <expected>
#include <memory>
#include <string>
#include <vector>

namespace civic::presentation {

struct NativeWindowConfig {
    std::wstring title{L"Civic Foundry Native"};
    std::uint32_t width{1280};
    std::uint32_t height{720};
    bool visible{true};
};

using NativeMessageHandler = bool (*)(
    void* user_data,
    void* native_window,
    std::uint32_t message,
    std::uintptr_t wparam,
    std::intptr_t lparam) noexcept;

class NativeWindow {
public:
    ~NativeWindow();
    NativeWindow(const NativeWindow&) = delete;
    NativeWindow& operator=(const NativeWindow&) = delete;
    [[nodiscard]] static std::expected<std::unique_ptr<NativeWindow>, std::string> create(const NativeWindowConfig& config = {});
    [[nodiscard]] bool pumpMessages();
    [[nodiscard]] std::vector<PlatformEvent> drainEvents();
    void setMessageHandler(NativeMessageHandler handler, void* user_data) noexcept;
    [[nodiscard]] void* nativeHandle() const noexcept;
    [[nodiscard]] std::uint32_t clientWidth() const noexcept;
    [[nodiscard]] std::uint32_t clientHeight() const noexcept;
    [[nodiscard]] bool closed() const noexcept;
private:
    struct Impl;
    explicit NativeWindow(std::unique_ptr<Impl> impl);
    std::unique_ptr<Impl> impl_;
};

} // namespace civic::presentation

#endif
