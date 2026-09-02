#ifdef _WIN32

#include <civic/presentation/Win32NativeUi.hpp>

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <d3d12.h>
#include <dxgiformat.h>
#include <wrl/client.h>

#include <imgui.h>
#include <imgui_impl_dx12.h>
#include <imgui_impl_win32.h>

#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

using Microsoft::WRL::ComPtr;

extern IMGUI_IMPL_API LRESULT ImGui_ImplWin32_WndProcHandler(HWND, UINT, WPARAM, LPARAM);

namespace civic::presentation {

struct Win32NativeUi::Impl {
    HWND window{};
    ID3D12Device* device{};
    ID3D12CommandQueue* queue{};
    ComPtr<ID3D12DescriptorHeap> srv_heap;
    UINT descriptor_stride{};
    std::vector<std::uint8_t> descriptor_used;
    ImGuiContext* context{};
    NativeUiRuntimeModel model;
    float applied_style_scale{1.0F};
    bool initialized{};

    ~Impl() { shutdown(); }

    static void allocateDescriptor(
        ImGui_ImplDX12_InitInfo* info,
        D3D12_CPU_DESCRIPTOR_HANDLE* out_cpu,
        D3D12_GPU_DESCRIPTOR_HANDLE* out_gpu) {
        if (!info || !info->UserData || !out_cpu || !out_gpu) return;
        auto* self = static_cast<Impl*>(info->UserData);
        for (std::size_t i = 0; i < self->descriptor_used.size(); ++i) {
            if (self->descriptor_used[i] != 0U) continue;
            self->descriptor_used[i] = 1U;
            auto cpu = self->srv_heap->GetCPUDescriptorHandleForHeapStart();
            auto gpu = self->srv_heap->GetGPUDescriptorHandleForHeapStart();
            cpu.ptr += static_cast<SIZE_T>(i) * self->descriptor_stride;
            gpu.ptr += static_cast<UINT64>(i) * self->descriptor_stride;
            *out_cpu = cpu;
            *out_gpu = gpu;
            return;
        }
        out_cpu->ptr = 0;
        out_gpu->ptr = 0;
    }

    static void freeDescriptor(
        ImGui_ImplDX12_InitInfo* info,
        D3D12_CPU_DESCRIPTOR_HANDLE cpu,
        D3D12_GPU_DESCRIPTOR_HANDLE) {
        if (!info || !info->UserData || cpu.ptr == 0) return;
        auto* self = static_cast<Impl*>(info->UserData);
        const auto base = self->srv_heap->GetCPUDescriptorHandleForHeapStart().ptr;
        if (cpu.ptr < base || self->descriptor_stride == 0U) return;
        const auto byte_offset = cpu.ptr - base;
        if ((byte_offset % self->descriptor_stride) != 0U) return;
        const auto index = static_cast<std::size_t>(byte_offset / self->descriptor_stride);
        if (index < self->descriptor_used.size()) self->descriptor_used[index] = 0U;
    }

    void makeCurrent() const noexcept {
        if (context) ImGui::SetCurrentContext(context);
    }

    void shutdown() noexcept {
        if (!initialized && !context) {
            model.shutdown();
            return;
        }
        makeCurrent();
        if (initialized) {
            ImGui_ImplDX12_Shutdown();
            ImGui_ImplWin32_Shutdown();
        }
        model.shutdown();
        if (context) {
            ImGui::DestroyContext(context);
            context = nullptr;
        }
        initialized = false;
        srv_heap.Reset();
        descriptor_used.clear();
    }
};

Win32NativeUi::Win32NativeUi(std::unique_ptr<Impl> impl) noexcept : impl_(std::move(impl)) {}
Win32NativeUi::~Win32NativeUi() = default;
Win32NativeUi::Win32NativeUi(Win32NativeUi&&) noexcept = default;
Win32NativeUi& Win32NativeUi::operator=(Win32NativeUi&&) noexcept = default;

std::expected<Win32NativeUi, std::string> Win32NativeUi::create(const Win32NativeUiConfig& config) {
    if (!config.window || !config.d3d12_device || !config.d3d12_command_queue) {
        return std::unexpected("Win32 native UI requires window, D3D12 device, and command queue");
    }
    if (config.frames_in_flight == 0U || config.frames_in_flight > 8U) {
        return std::unexpected("Win32 native UI frames-in-flight must be between 1 and 8");
    }
    if (config.descriptor_capacity < 8U || config.descriptor_capacity > 4096U) {
        return std::unexpected("Win32 native UI descriptor capacity must be between 8 and 4096");
    }
    if (config.rtv_format == 0U) return std::unexpected("Win32 native UI RTV format is invalid");
    if (ImGui::GetCurrentContext() != nullptr) return std::unexpected("an ImGui context is already active");

    auto impl = std::make_unique<Impl>();
    impl->window = static_cast<HWND>(config.window);
    impl->device = static_cast<ID3D12Device*>(config.d3d12_device);
    impl->queue = static_cast<ID3D12CommandQueue*>(config.d3d12_command_queue);
    impl->descriptor_used.resize(config.descriptor_capacity, 0U);

    D3D12_DESCRIPTOR_HEAP_DESC heap_desc{};
    heap_desc.Type = D3D12_DESCRIPTOR_HEAP_TYPE_CBV_SRV_UAV;
    heap_desc.NumDescriptors = config.descriptor_capacity;
    heap_desc.Flags = D3D12_DESCRIPTOR_HEAP_FLAG_SHADER_VISIBLE;
    const HRESULT heap_hr = impl->device->CreateDescriptorHeap(&heap_desc, IID_PPV_ARGS(&impl->srv_heap));
    if (FAILED(heap_hr)) return std::unexpected("failed to create ImGui D3D12 descriptor heap");
    impl->descriptor_stride = impl->device->GetDescriptorHandleIncrementSize(D3D12_DESCRIPTOR_HEAP_TYPE_CBV_SRV_UAV);

    IMGUI_CHECKVERSION();
    impl->context = ImGui::CreateContext();
    if (!impl->context) return std::unexpected("failed to create ImGui context");
    impl->makeCurrent();
    auto& io = ImGui::GetIO();
    io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;
    io.ConfigFlags |= ImGuiConfigFlags_DockingEnable;
    io.ConfigWindowsMoveFromTitleBarOnly = true;
    ImGui::StyleColorsDark();

    if (!ImGui_ImplWin32_Init(config.window)) {
        impl->shutdown();
        return std::unexpected("failed to initialize ImGui Win32 backend");
    }

    ImGui_ImplDX12_InitInfo init{};
    init.Device = impl->device;
    init.CommandQueue = impl->queue;
    init.NumFramesInFlight = static_cast<int>(config.frames_in_flight);
    init.RTVFormat = static_cast<DXGI_FORMAT>(config.rtv_format);
    init.DSVFormat = DXGI_FORMAT_UNKNOWN;
    init.UserData = impl.get();
    init.SrvDescriptorHeap = impl->srv_heap.Get();
    init.SrvDescriptorAllocFn = &Impl::allocateDescriptor;
    init.SrvDescriptorFreeFn = &Impl::freeDescriptor;
    if (!ImGui_ImplDX12_Init(&init)) {
        ImGui_ImplWin32_Shutdown();
        ImGui::DestroyContext(impl->context);
        impl->context = nullptr;
        return std::unexpected("failed to initialize ImGui D3D12 backend");
    }

    float dpi = ImGui_ImplWin32_GetDpiScaleForHwnd(config.window);
    if (!std::isfinite(dpi) || dpi <= 0.0F) dpi = 1.0F;
    if (auto initialized = impl->model.initialize(dpi); !initialized) {
        ImGui_ImplDX12_Shutdown();
        ImGui_ImplWin32_Shutdown();
        ImGui::DestroyContext(impl->context);
        impl->context = nullptr;
        return std::unexpected(initialized.error());
    }

    impl->initialized = true;
    return Win32NativeUi(std::move(impl));
}

std::expected<UiFrameState, std::string> Win32NativeUi::beginFrame(
    const FrameSnapshot& snapshot,
    PresentationSettings settings) {
    if (!impl_ || !impl_->initialized) return std::unexpected("Win32 native UI is not initialized");
    const auto frame = impl_->model.beginFrame(snapshot, settings);
    if (!frame) return std::unexpected(frame.error());

    impl_->makeCurrent();
    ImGui_ImplDX12_NewFrame();
    ImGui_ImplWin32_NewFrame();
    ImGui::NewFrame();

    const float target_scale = std::clamp(frame->effective_scale, 0.5F, 4.0F);
    if (std::abs(target_scale - impl_->applied_style_scale) > 0.001F) {
        const float ratio = target_scale / impl_->applied_style_scale;
        ImGui::GetStyle().ScaleAllSizes(ratio);
        impl_->applied_style_scale = target_scale;
    }
    ImGui::GetIO().FontGlobalScale = target_scale;
    return *frame;
}

std::expected<void, std::string> Win32NativeUi::render(void* d3d12_graphics_command_list) {
    if (!impl_ || !impl_->initialized) return std::unexpected("Win32 native UI is not initialized");
    if (!impl_->model.frameActive()) return std::unexpected("Win32 native UI frame is not active");
    if (!d3d12_graphics_command_list) return std::unexpected("Win32 native UI requires an active D3D12 command list");

    impl_->makeCurrent();
    ImGui::Render();
    auto* command_list = static_cast<ID3D12GraphicsCommandList*>(d3d12_graphics_command_list);
    ID3D12DescriptorHeap* heaps[] = {impl_->srv_heap.Get()};
    command_list->SetDescriptorHeaps(1, heaps);
    ImGui_ImplDX12_RenderDrawData(ImGui::GetDrawData(), command_list);
    return impl_->model.endFrame();
}

bool Win32NativeUi::handleMessage(
    void* window,
    std::uint32_t message,
    std::uintptr_t wparam,
    std::intptr_t lparam) noexcept {
    if (!impl_ || !impl_->initialized) return false;
    impl_->makeCurrent();
    return ImGui_ImplWin32_WndProcHandler(
        static_cast<HWND>(window),
        static_cast<UINT>(message),
        static_cast<WPARAM>(wparam),
        static_cast<LPARAM>(lparam)) != 0;
}

bool Win32NativeUi::wantsKeyboardCapture() const noexcept {
    if (!impl_ || !impl_->initialized) return false;
    impl_->makeCurrent();
    return ImGui::GetIO().WantCaptureKeyboard;
}

bool Win32NativeUi::wantsTextInput() const noexcept {
    if (!impl_ || !impl_->initialized) return false;
    impl_->makeCurrent();
    return ImGui::GetIO().WantTextInput;
}

bool Win32NativeUi::wantsMouseCapture() const noexcept {
    if (!impl_ || !impl_->initialized) return false;
    impl_->makeCurrent();
    return ImGui::GetIO().WantCaptureMouse;
}

NativeUiRuntimeModel& Win32NativeUi::model() noexcept {
    assert(impl_);
    return impl_->model;
}

const NativeUiRuntimeModel& Win32NativeUi::model() const noexcept {
    assert(impl_);
    return impl_->model;
}

} // namespace civic::presentation

#endif
