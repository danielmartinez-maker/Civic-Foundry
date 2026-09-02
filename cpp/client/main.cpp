#ifdef _WIN32

#include <civic/core/NativeEngine.hpp>
#include <civic/presentation/D3D12Backend.hpp>
#include <civic/presentation/NativeWindow.hpp>

#include <windows.h>

#include <iostream>

using namespace civic::presentation;

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
    auto window = NativeWindow::create();
    if (!window) { MessageBoxA(nullptr, window.error().c_str(), "Civic Foundry Native", MB_OK | MB_ICONERROR); return 1; }
    D3D12Backend backend{};
    if (auto initialized = backend.initialize((*window)->nativeHandle(), (*window)->clientWidth(), (*window)->clientHeight()); !initialized) {
        MessageBoxA(nullptr, initialized.error().c_str(), "Civic Foundry Native GPU Error", MB_OK | MB_ICONERROR); return 2;
    }
    auto engine = civic::NativeEngine::create({});
    if (!engine) { MessageBoxA(nullptr, engine.error().message.c_str(), "Civic Foundry Native Engine Error", MB_OK | MB_ICONERROR); return 3; }
    const auto world = (*engine)->domainHash("world");
    if (world && world->ownership == civic::DomainOwnership::unowned) {
        SetWindowTextW(static_cast<HWND>((*window)->nativeHandle()), L"Civic Foundry Native Client — presentation active / authority cutover gated");
    }
    while ((*window)->pumpMessages()) {
        for (const auto& event : (*window)->drainEvents()) {
            if (event.type == PlatformEventType::Resize && event.data1 > 0 && event.data2 > 0) {
                if (auto resized = backend.resize(static_cast<std::uint32_t>(event.data1), static_cast<std::uint32_t>(event.data2)); !resized) {
                    MessageBoxA(nullptr, resized.error().c_str(), "Civic Foundry Native Resize Error", MB_OK | MB_ICONERROR); return 4;
                }
            }
        }
        auto frame = backend.beginFrame(); if (!frame) { MessageBoxA(nullptr, frame.error().c_str(), "Civic Foundry Native Frame Error", MB_OK | MB_ICONERROR); return 5; }
        auto fence = backend.submit(*frame); if (!fence) { MessageBoxA(nullptr, fence.error().c_str(), "Civic Foundry Native Submit Error", MB_OK | MB_ICONERROR); return 6; }
        if (auto presented = backend.present(*frame); !presented) { MessageBoxA(nullptr, presented.error().c_str(), "Civic Foundry Native Present Error", MB_OK | MB_ICONERROR); return 7; }
    }
    return 0;
}

#endif
