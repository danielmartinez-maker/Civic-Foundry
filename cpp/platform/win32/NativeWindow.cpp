#ifdef _WIN32

#include <civic/presentation/NativeWindow.hpp>

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <windowsx.h>

#include <algorithm>
#include <utility>

namespace civic::presentation {
namespace {
constexpr wchar_t kWindowClass[] = L"CivicFoundryNativeWindow";

std::string win32Error(const char* prefix) {
    return std::string(prefix) + " (win32=" + std::to_string(GetLastError()) + ")";
}
}

struct NativeWindow::Impl {
    HWND hwnd{};
    HINSTANCE instance{};
    PlatformEventQueue events;
    std::uint32_t width{};
    std::uint32_t height{};
    bool closed{};

    static LRESULT CALLBACK windowProc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
        Impl* self = reinterpret_cast<Impl*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
        if (message == WM_NCCREATE) {
            const auto* create = reinterpret_cast<const CREATESTRUCTW*>(lparam);
            self = static_cast<Impl*>(create->lpCreateParams);
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(self));
            self->hwnd = hwnd;
        }
        if (!self) return DefWindowProcW(hwnd, message, wparam, lparam);
        switch (message) {
            case WM_CLOSE:
                self->events.push({PlatformEventType::Close});
                self->closed = true;
                DestroyWindow(hwnd);
                return 0;
            case WM_DESTROY:
                self->closed = true;
                PostQuitMessage(0);
                return 0;
            case WM_SIZE:
                if (wparam != SIZE_MINIMIZED) {
                    self->width = static_cast<std::uint32_t>(LOWORD(lparam));
                    self->height = static_cast<std::uint32_t>(HIWORD(lparam));
                    self->events.push({PlatformEventType::Resize, static_cast<int>(self->width), static_cast<int>(self->height)});
                }
                return 0;
            case WM_SETFOCUS: self->events.push({PlatformEventType::FocusGained}); return 0;
            case WM_KILLFOCUS: self->events.push({PlatformEventType::FocusLost}); return 0;
            case WM_CAPTURECHANGED: self->events.push({PlatformEventType::PointerCancel}); return 0;
            case WM_LBUTTONDOWN:
                SetCapture(hwnd);
                self->events.push({PlatformEventType::PointerDown, 0, 0, static_cast<double>(GET_X_LPARAM(lparam)), static_cast<double>(GET_Y_LPARAM(lparam))});
                return 0;
            case WM_LBUTTONUP:
                if (GetCapture() == hwnd) ReleaseCapture();
                self->events.push({PlatformEventType::PointerUp, 0, 0, static_cast<double>(GET_X_LPARAM(lparam)), static_cast<double>(GET_Y_LPARAM(lparam))});
                return 0;
            case WM_MOUSEMOVE:
                self->events.push({PlatformEventType::PointerMove, 0, 0, static_cast<double>(GET_X_LPARAM(lparam)), static_cast<double>(GET_Y_LPARAM(lparam))});
                return 0;
            case WM_MOUSEWHEEL: {
                POINT point{GET_X_LPARAM(lparam), GET_Y_LPARAM(lparam)};
                ScreenToClient(hwnd, &point);
                self->events.push({PlatformEventType::Wheel, 0, 0, static_cast<double>(point.x), static_cast<double>(point.y), static_cast<double>(GET_WHEEL_DELTA_WPARAM(wparam)) / WHEEL_DELTA});
                return 0;
            }
            case WM_KEYDOWN: self->events.push({PlatformEventType::KeyDown, static_cast<int>(wparam)}); return 0;
            case WM_KEYUP: self->events.push({PlatformEventType::KeyUp, static_cast<int>(wparam)}); return 0;
            case WM_DPICHANGED: {
                const auto* suggested = reinterpret_cast<const RECT*>(lparam);
                SetWindowPos(hwnd, nullptr, suggested->left, suggested->top, suggested->right - suggested->left, suggested->bottom - suggested->top, SWP_NOZORDER | SWP_NOACTIVATE);
                return 0;
            }
            default: return DefWindowProcW(hwnd, message, wparam, lparam);
        }
    }
};

NativeWindow::NativeWindow(std::unique_ptr<Impl> impl) : impl_(std::move(impl)) {}
NativeWindow::~NativeWindow() {
    if (impl_ && impl_->hwnd && IsWindow(impl_->hwnd)) DestroyWindow(impl_->hwnd);
}

std::expected<std::unique_ptr<NativeWindow>, std::string> NativeWindow::create(const NativeWindowConfig& config) {
    if (config.width == 0 || config.height == 0) return std::unexpected("native window dimensions must be positive");
    (void)SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    auto impl = std::make_unique<Impl>();
    impl->instance = GetModuleHandleW(nullptr);
    WNDCLASSEXW window_class{};
    window_class.cbSize = sizeof(window_class);
    window_class.style = CS_HREDRAW | CS_VREDRAW | CS_OWNDC;
    window_class.lpfnWndProc = &Impl::windowProc;
    window_class.hInstance = impl->instance;
    window_class.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    window_class.lpszClassName = kWindowClass;
    if (!RegisterClassExW(&window_class) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) return std::unexpected(win32Error("failed to register native window class"));

    RECT desired{0, 0, static_cast<LONG>(config.width), static_cast<LONG>(config.height)};
    const DWORD style = WS_OVERLAPPEDWINDOW;
    if (!AdjustWindowRectExForDpi(&desired, style, FALSE, 0, 96)) return std::unexpected(win32Error("failed to calculate native window bounds"));
    const int show = config.visible ? SW_SHOW : SW_HIDE;
    const HWND hwnd = CreateWindowExW(0, kWindowClass, config.title.c_str(), style, CW_USEDEFAULT, CW_USEDEFAULT,
        desired.right - desired.left, desired.bottom - desired.top, nullptr, nullptr, impl->instance, impl.get());
    if (!hwnd) return std::unexpected(win32Error("failed to create native window"));
    impl->hwnd = hwnd;
    impl->width = config.width;
    impl->height = config.height;
    ShowWindow(hwnd, show);
    UpdateWindow(hwnd);
    return std::unique_ptr<NativeWindow>(new NativeWindow(std::move(impl)));
}

bool NativeWindow::pumpMessages() {
    MSG message{};
    while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
        if (message.message == WM_QUIT) impl_->closed = true;
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }
    return !impl_->closed;
}
std::vector<PlatformEvent> NativeWindow::drainEvents() { return impl_->events.drain(); }
void* NativeWindow::nativeHandle() const noexcept { return impl_->hwnd; }
std::uint32_t NativeWindow::clientWidth() const noexcept { return impl_->width; }
std::uint32_t NativeWindow::clientHeight() const noexcept { return impl_->height; }
bool NativeWindow::closed() const noexcept { return impl_->closed; }

} // namespace civic::presentation

#endif
