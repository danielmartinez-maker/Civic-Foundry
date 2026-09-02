#ifdef _WIN32
#include <civic/presentation/D3D12Backend.hpp>
#include <civic/presentation/NativeWindow.hpp>
#include <iostream>
using namespace civic::presentation;
int main() {
    NativeWindowConfig config{}; config.title = L"Civic Foundry D3D12 Smoke"; config.width = 320; config.height = 180; config.visible = false;
    auto window = NativeWindow::create(config); if (!window) { std::cerr << window.error(); return 1; }
    D3D12Backend backend{}; if (auto result = backend.initialize((*window)->nativeHandle(), 320, 180); !result) { std::cerr << result.error(); return 2; }
    auto frame = backend.beginFrame(); if (!frame) { std::cerr << frame.error(); return 3; }
    auto fence = backend.submit(*frame); if (!fence) { std::cerr << fence.error(); return 4; }
    if (auto result = backend.present(*frame); !result) { std::cerr << result.error(); return 5; }
    if (auto result = backend.waitForFence(*fence); !result) { std::cerr << result.error(); return 6; }
    return 0;
}
#endif
