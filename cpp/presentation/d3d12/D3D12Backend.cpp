#ifdef _WIN32

#include <civic/presentation/D3D12Backend.hpp>

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <d3d12.h>
#include <dxgi1_6.h>
#include <wrl/client.h>

#include <algorithm>
#include <array>
#include <cstring>
#include <limits>
#include <unordered_map>
#include <utility>

using Microsoft::WRL::ComPtr;

namespace civic::presentation {
namespace {
constexpr UINT kFrameCount = 2;

std::string hrMessage(const char* prefix, HRESULT hr) { return std::string(prefix) + " (HRESULT=" + std::to_string(static_cast<long long>(hr)) + ")"; }
DXGI_FORMAT toDxgi(TextureFormat format) noexcept {
    switch (format) {
        case TextureFormat::Rgba8Unorm: return DXGI_FORMAT_R8G8B8A8_UNORM;
        case TextureFormat::Depth32Float: return DXGI_FORMAT_D32_FLOAT;
        case TextureFormat::Bgra8Unorm: default: return DXGI_FORMAT_B8G8R8A8_UNORM;
    }
}
std::string narrow(const wchar_t* text) {
    if (!text || !*text) return {};
    const int size = WideCharToMultiByte(CP_UTF8, 0, text, -1, nullptr, 0, nullptr, nullptr);
    if (size <= 1) return {};
    std::string result(static_cast<std::size_t>(size - 1), '\0');
    WideCharToMultiByte(CP_UTF8, 0, text, -1, result.data(), size - 1, nullptr, nullptr);
    return result;
}
}

struct D3D12Backend::Impl {
    ComPtr<IDXGIFactory7> factory;
    ComPtr<IDXGIAdapter4> adapter;
    ComPtr<ID3D12Device> device;
    ComPtr<ID3D12CommandQueue> queue;
    ComPtr<IDXGISwapChain3> swapchain;
    ComPtr<ID3D12DescriptorHeap> rtv_heap;
    std::array<ComPtr<ID3D12Resource>, kFrameCount> backbuffers;
    std::array<ComPtr<ID3D12CommandAllocator>, kFrameCount> allocators;
    ComPtr<ID3D12GraphicsCommandList> command_list;
    ComPtr<ID3D12Fence> fence;
    ComPtr<ID3D12RootSignature> root_signature;
    HANDLE fence_event{};
    std::array<std::uint64_t, kFrameCount> frame_fences{};
    std::uint64_t next_fence{1};
    std::uint64_t frame_serial{1};
    std::uint64_t next_handle{16};
    UINT frame_index{};
    UINT rtv_stride{};
    std::uint32_t width{};
    std::uint32_t height{};
    bool initialized{};
    bool recording{};
    bool submitted{};
    bool debug_layer{};
    bool tearing{};
    std::string adapter_name;
    std::uint64_t dedicated_video_memory{};
    std::string last_error{"D3D12 backend is not initialized"};
    std::unordered_map<std::uint64_t, ComPtr<ID3D12Resource>> buffers;
    std::unordered_map<std::uint64_t, ComPtr<ID3D12Resource>> textures;
    struct ShaderRecord { ShaderStage stage{}; std::vector<std::byte> bytecode; };
    std::unordered_map<std::uint64_t, ShaderRecord> shaders;
    std::unordered_map<std::uint64_t, ComPtr<ID3D12PipelineState>> pipelines;

    std::expected<void, std::string> fail(const std::string& error) { last_error = error; return std::unexpected(error); }
    std::expected<void, std::string> wait(std::uint64_t value) {
        if (!fence || !fence_event) return fail("D3D12 fence is unavailable");
        if (fence->GetCompletedValue() >= value) return {};
        const HRESULT hr = fence->SetEventOnCompletion(value, fence_event);
        if (FAILED(hr)) return fail(hrMessage("failed to schedule D3D12 fence wait", hr));
        WaitForSingleObject(fence_event, INFINITE);
        return {};
    }
    std::expected<void, std::string> createBackbuffers() {
        D3D12_CPU_DESCRIPTOR_HANDLE handle = rtv_heap->GetCPUDescriptorHandleForHeapStart();
        for (UINT i = 0; i < kFrameCount; ++i) {
            const HRESULT hr = swapchain->GetBuffer(i, IID_PPV_ARGS(&backbuffers[i]));
            if (FAILED(hr)) return fail(hrMessage("failed to acquire swapchain backbuffer", hr));
            device->CreateRenderTargetView(backbuffers[i].Get(), nullptr, handle);
            handle.ptr += rtv_stride;
        }
        return {};
    }
};

D3D12Backend::D3D12Backend() : impl_(std::make_unique<Impl>()) {}
D3D12Backend::~D3D12Backend() {
    if (impl_) {
        if (impl_->initialized && impl_->fence && impl_->queue) {
            const auto value = impl_->next_fence++;
            if (SUCCEEDED(impl_->queue->Signal(impl_->fence.Get(), value))) (void)impl_->wait(value);
        }
        if (impl_->fence_event) CloseHandle(impl_->fence_event);
    }
}

std::expected<void, std::string> D3D12Backend::initialize(void* native_window, std::uint32_t width, std::uint32_t height) {
    if (!native_window || width == 0 || height == 0) return impl_->fail("D3D12 initialization requires a valid window and positive dimensions");
    UINT factory_flags = 0;
#if defined(_DEBUG)
    ComPtr<ID3D12Debug> debug;
    if (SUCCEEDED(D3D12GetDebugInterface(IID_PPV_ARGS(&debug)))) { debug->EnableDebugLayer(); impl_->debug_layer = true; factory_flags |= DXGI_CREATE_FACTORY_DEBUG; }
#endif
    HRESULT hr = CreateDXGIFactory2(factory_flags, IID_PPV_ARGS(&impl_->factory));
    if (FAILED(hr)) return impl_->fail(hrMessage("failed to create DXGI factory", hr));

    for (UINT index = 0;; ++index) {
        ComPtr<IDXGIAdapter1> candidate;
        if (impl_->factory->EnumAdapterByGpuPreference(index, DXGI_GPU_PREFERENCE_HIGH_PERFORMANCE, IID_PPV_ARGS(&candidate)) == DXGI_ERROR_NOT_FOUND) break;
        DXGI_ADAPTER_DESC1 desc{};
        candidate->GetDesc1(&desc);
        if ((desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE) != 0) continue;
        if (SUCCEEDED(D3D12CreateDevice(candidate.Get(), D3D_FEATURE_LEVEL_11_0, __uuidof(ID3D12Device), nullptr))) {
            candidate.As(&impl_->adapter);
            impl_->adapter_name = narrow(desc.Description);
            impl_->dedicated_video_memory = desc.DedicatedVideoMemory;
            break;
        }
    }
    if (!impl_->adapter) return impl_->fail("no compatible hardware D3D12 adapter was found");
    hr = D3D12CreateDevice(impl_->adapter.Get(), D3D_FEATURE_LEVEL_11_0, IID_PPV_ARGS(&impl_->device));
    if (FAILED(hr)) return impl_->fail(hrMessage("failed to create D3D12 device", hr));

    D3D12_COMMAND_QUEUE_DESC queue_desc{};
    queue_desc.Type = D3D12_COMMAND_LIST_TYPE_DIRECT;
    hr = impl_->device->CreateCommandQueue(&queue_desc, IID_PPV_ARGS(&impl_->queue));
    if (FAILED(hr)) return impl_->fail(hrMessage("failed to create D3D12 command queue", hr));

    BOOL allow_tearing = FALSE;
    impl_->tearing = SUCCEEDED(impl_->factory->CheckFeatureSupport(DXGI_FEATURE_PRESENT_ALLOW_TEARING, &allow_tearing, sizeof(allow_tearing))) && allow_tearing;
    DXGI_SWAP_CHAIN_DESC1 swap_desc{};
    swap_desc.Width = width; swap_desc.Height = height; swap_desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    swap_desc.SampleDesc.Count = 1; swap_desc.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT; swap_desc.BufferCount = kFrameCount;
    swap_desc.SwapEffect = DXGI_SWAP_EFFECT_FLIP_DISCARD; swap_desc.Flags = impl_->tearing ? DXGI_SWAP_CHAIN_FLAG_ALLOW_TEARING : 0;
    ComPtr<IDXGISwapChain1> swapchain1;
    hr = impl_->factory->CreateSwapChainForHwnd(impl_->queue.Get(), static_cast<HWND>(native_window), &swap_desc, nullptr, nullptr, &swapchain1);
    if (FAILED(hr)) return impl_->fail(hrMessage("failed to create D3D12 swapchain", hr));
    (void)impl_->factory->MakeWindowAssociation(static_cast<HWND>(native_window), DXGI_MWA_NO_ALT_ENTER);
    hr = swapchain1.As(&impl_->swapchain);
    if (FAILED(hr)) return impl_->fail(hrMessage("failed to query IDXGISwapChain3", hr));
    impl_->frame_index = impl_->swapchain->GetCurrentBackBufferIndex();

    D3D12_DESCRIPTOR_HEAP_DESC heap_desc{}; heap_desc.NumDescriptors = kFrameCount; heap_desc.Type = D3D12_DESCRIPTOR_HEAP_TYPE_RTV;
    hr = impl_->device->CreateDescriptorHeap(&heap_desc, IID_PPV_ARGS(&impl_->rtv_heap));
    if (FAILED(hr)) return impl_->fail(hrMessage("failed to create RTV descriptor heap", hr));
    impl_->rtv_stride = impl_->device->GetDescriptorHandleIncrementSize(D3D12_DESCRIPTOR_HEAP_TYPE_RTV);
    if (auto result = impl_->createBackbuffers(); !result) return result;
    for (auto& allocator : impl_->allocators) {
        hr = impl_->device->CreateCommandAllocator(D3D12_COMMAND_LIST_TYPE_DIRECT, IID_PPV_ARGS(&allocator));
        if (FAILED(hr)) return impl_->fail(hrMessage("failed to create D3D12 command allocator", hr));
    }
    hr = impl_->device->CreateCommandList(0, D3D12_COMMAND_LIST_TYPE_DIRECT, impl_->allocators[impl_->frame_index].Get(), nullptr, IID_PPV_ARGS(&impl_->command_list));
    if (FAILED(hr)) return impl_->fail(hrMessage("failed to create D3D12 command list", hr));
    impl_->command_list->Close();
    hr = impl_->device->CreateFence(0, D3D12_FENCE_FLAG_NONE, IID_PPV_ARGS(&impl_->fence));
    if (FAILED(hr)) return impl_->fail(hrMessage("failed to create D3D12 fence", hr));
    impl_->fence_event = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    if (!impl_->fence_event) return impl_->fail("failed to create D3D12 fence event");

    D3D12_ROOT_SIGNATURE_DESC root_desc{};
    root_desc.Flags = D3D12_ROOT_SIGNATURE_FLAG_ALLOW_INPUT_ASSEMBLER_INPUT_LAYOUT;
    ComPtr<ID3DBlob> signature;
    ComPtr<ID3DBlob> errors;
    hr = D3D12SerializeRootSignature(&root_desc, D3D_ROOT_SIGNATURE_VERSION_1, &signature, &errors);
    if (FAILED(hr)) return impl_->fail(hrMessage("failed to serialize D3D12 root signature", hr));
    hr = impl_->device->CreateRootSignature(0, signature->GetBufferPointer(), signature->GetBufferSize(), IID_PPV_ARGS(&impl_->root_signature));
    if (FAILED(hr)) return impl_->fail(hrMessage("failed to create D3D12 root signature", hr));

    impl_->width = width; impl_->height = height; impl_->initialized = true; impl_->last_error.clear();
    return {};
}

std::expected<void, std::string> D3D12Backend::resize(std::uint32_t width, std::uint32_t height) {
    if (!impl_->initialized) return impl_->fail("cannot resize an uninitialized D3D12 backend");
    if (width == 0 || height == 0 || (width == impl_->width && height == impl_->height)) return {};
    const auto fence_value = impl_->next_fence++;
    HRESULT hr = impl_->queue->Signal(impl_->fence.Get(), fence_value);
    if (FAILED(hr)) return impl_->fail(hrMessage("failed to signal before resize", hr));
    if (auto waited = impl_->wait(fence_value); !waited) return waited;
    for (auto& buffer : impl_->backbuffers) buffer.Reset();
    const UINT flags = impl_->tearing ? DXGI_SWAP_CHAIN_FLAG_ALLOW_TEARING : 0;
    hr = impl_->swapchain->ResizeBuffers(kFrameCount, width, height, DXGI_FORMAT_B8G8R8A8_UNORM, flags);
    if (FAILED(hr)) return impl_->fail(hrMessage("failed to resize D3D12 swapchain", hr));
    impl_->frame_index = impl_->swapchain->GetCurrentBackBufferIndex();
    impl_->frame_fences.fill(0);
    impl_->width = width; impl_->height = height;
    return impl_->createBackbuffers();
}

std::expected<BufferHandle, std::string> D3D12Backend::createBuffer(const BufferDesc& desc, std::span<const std::byte> initial_data) {
    if (!impl_->initialized || desc.size_bytes == 0) return std::unexpected("invalid D3D12 buffer request");
    const bool upload = desc.cpu_visible || !initial_data.empty() || desc.usage == BufferUsage::Upload;
    D3D12_HEAP_PROPERTIES heap{}; heap.Type = upload ? D3D12_HEAP_TYPE_UPLOAD : D3D12_HEAP_TYPE_DEFAULT;
    D3D12_RESOURCE_DESC resource{}; resource.Dimension = D3D12_RESOURCE_DIMENSION_BUFFER; resource.Width = desc.size_bytes; resource.Height = 1;
    resource.DepthOrArraySize = 1; resource.MipLevels = 1; resource.SampleDesc.Count = 1; resource.Layout = D3D12_TEXTURE_LAYOUT_ROW_MAJOR;
    ComPtr<ID3D12Resource> buffer;
    const auto state = upload ? D3D12_RESOURCE_STATE_GENERIC_READ : D3D12_RESOURCE_STATE_COMMON;
    HRESULT hr = impl_->device->CreateCommittedResource(&heap, D3D12_HEAP_FLAG_NONE, &resource, state, nullptr, IID_PPV_ARGS(&buffer));
    if (FAILED(hr)) return std::unexpected(hrMessage("failed to create D3D12 buffer", hr));
    if (!initial_data.empty()) {
        if (initial_data.size() > desc.size_bytes) return std::unexpected("initial buffer data exceeds requested size");
        void* mapped = nullptr;
        hr = buffer->Map(0, nullptr, &mapped);
        if (FAILED(hr)) return std::unexpected(hrMessage("failed to map D3D12 upload buffer", hr));
        std::memcpy(mapped, initial_data.data(), initial_data.size());
        buffer->Unmap(0, nullptr);
    }
    const auto handle = BufferHandle{impl_->next_handle++};
    impl_->buffers.emplace(handle.value, std::move(buffer));
    return handle;
}

std::expected<TextureHandle, std::string> D3D12Backend::createTexture(const TextureDesc& desc) {
    if (!impl_->initialized || desc.width == 0 || desc.height == 0) return std::unexpected("invalid D3D12 texture request");
    D3D12_HEAP_PROPERTIES heap{}; heap.Type = D3D12_HEAP_TYPE_DEFAULT;
    D3D12_RESOURCE_DESC resource{}; resource.Dimension = D3D12_RESOURCE_DIMENSION_TEXTURE2D; resource.Width = desc.width; resource.Height = desc.height;
    resource.DepthOrArraySize = 1; resource.MipLevels = 1; resource.Format = toDxgi(desc.format); resource.SampleDesc.Count = 1;
    resource.Flags = desc.render_target ? D3D12_RESOURCE_FLAG_ALLOW_RENDER_TARGET : D3D12_RESOURCE_FLAG_NONE;
    D3D12_CLEAR_VALUE clear{}; clear.Format = resource.Format; clear.Color[3] = 1.0F;
    ComPtr<ID3D12Resource> texture;
    const D3D12_CLEAR_VALUE* clear_ptr = desc.render_target ? &clear : nullptr;
    const HRESULT hr = impl_->device->CreateCommittedResource(&heap, D3D12_HEAP_FLAG_NONE, &resource, D3D12_RESOURCE_STATE_COMMON, clear_ptr, IID_PPV_ARGS(&texture));
    if (FAILED(hr)) return std::unexpected(hrMessage("failed to create D3D12 texture", hr));
    const auto handle = TextureHandle{impl_->next_handle++}; impl_->textures.emplace(handle.value, std::move(texture)); return handle;
}

std::expected<ShaderHandle, std::string> D3D12Backend::createShader(const ShaderDesc& desc) {
    if (!impl_->initialized || desc.bytecode.empty()) return std::unexpected("D3D12 shader bytecode is empty");
    const auto handle = ShaderHandle{impl_->next_handle++}; impl_->shaders.emplace(handle.value, Impl::ShaderRecord{desc.stage, desc.bytecode}); return handle;
}

std::expected<PipelineHandle, std::string> D3D12Backend::createPipeline(const PipelineDesc& desc) {
    if (!impl_->initialized) return std::unexpected("D3D12 backend is not initialized");
    const auto vs = impl_->shaders.find(desc.vertex_shader.value); const auto ps = impl_->shaders.find(desc.pixel_shader.value);
    if (vs == impl_->shaders.end() || ps == impl_->shaders.end() || vs->second.stage != ShaderStage::Vertex || ps->second.stage != ShaderStage::Pixel) return std::unexpected("pipeline references invalid D3D12 shaders");
    D3D12_GRAPHICS_PIPELINE_STATE_DESC state{}; state.pRootSignature = impl_->root_signature.Get();
    state.VS = {vs->second.bytecode.data(), vs->second.bytecode.size()}; state.PS = {ps->second.bytecode.data(), ps->second.bytecode.size()};
    state.BlendState.RenderTarget[0].RenderTargetWriteMask = D3D12_COLOR_WRITE_ENABLE_ALL;
    state.SampleMask = std::numeric_limits<UINT>::max();
    state.RasterizerState.FillMode = D3D12_FILL_MODE_SOLID; state.RasterizerState.CullMode = D3D12_CULL_MODE_BACK; state.RasterizerState.DepthClipEnable = TRUE;
    state.DepthStencilState.DepthEnable = desc.depth_test ? TRUE : FALSE; state.DepthStencilState.DepthWriteMask = D3D12_DEPTH_WRITE_MASK_ALL; state.DepthStencilState.DepthFunc = D3D12_COMPARISON_FUNC_LESS_EQUAL;
    state.PrimitiveTopologyType = D3D12_PRIMITIVE_TOPOLOGY_TYPE_TRIANGLE; state.NumRenderTargets = 1; state.RTVFormats[0] = toDxgi(desc.color_format); state.SampleDesc.Count = 1;
    ComPtr<ID3D12PipelineState> pipeline;
    const HRESULT hr = impl_->device->CreateGraphicsPipelineState(&state, IID_PPV_ARGS(&pipeline));
    if (FAILED(hr)) return std::unexpected(hrMessage("failed to create D3D12 graphics pipeline", hr));
    const auto handle = PipelineHandle{impl_->next_handle++}; impl_->pipelines.emplace(handle.value, std::move(pipeline)); return handle;
}

std::expected<FrameToken, std::string> D3D12Backend::beginFrame() {
    if (!impl_->initialized) return std::unexpected(impl_->last_error.empty() ? "D3D12 backend is not initialized" : impl_->last_error);
    if (impl_->recording) return std::unexpected("D3D12 frame is already recording");
    impl_->frame_index = impl_->swapchain->GetCurrentBackBufferIndex();
    if (const auto pending = impl_->frame_fences[impl_->frame_index]; pending != 0) if (auto waited = impl_->wait(pending); !waited) return std::unexpected(waited.error());
    HRESULT hr = impl_->allocators[impl_->frame_index]->Reset(); if (FAILED(hr)) return std::unexpected(hrMessage("failed to reset D3D12 command allocator", hr));
    hr = impl_->command_list->Reset(impl_->allocators[impl_->frame_index].Get(), nullptr); if (FAILED(hr)) return std::unexpected(hrMessage("failed to reset D3D12 command list", hr));
    D3D12_RESOURCE_BARRIER barrier{}; barrier.Type = D3D12_RESOURCE_BARRIER_TYPE_TRANSITION; barrier.Transition.pResource = impl_->backbuffers[impl_->frame_index].Get();
    barrier.Transition.StateBefore = D3D12_RESOURCE_STATE_PRESENT; barrier.Transition.StateAfter = D3D12_RESOURCE_STATE_RENDER_TARGET; barrier.Transition.Subresource = D3D12_RESOURCE_BARRIER_ALL_SUBRESOURCES;
    impl_->command_list->ResourceBarrier(1, &barrier);
    auto handle = impl_->rtv_heap->GetCPUDescriptorHandleForHeapStart(); handle.ptr += static_cast<SIZE_T>(impl_->frame_index) * impl_->rtv_stride;
    const FLOAT clear[4] = {0.055F, 0.075F, 0.085F, 1.0F}; impl_->command_list->ClearRenderTargetView(handle, clear, 0, nullptr);
    impl_->recording = true; impl_->submitted = false;
    return FrameToken{impl_->frame_serial++, TextureHandle{static_cast<std::uint64_t>(impl_->frame_index + 1U)}};
}

std::expected<std::uint64_t, std::string> D3D12Backend::submit(const FrameToken&) {
    if (!impl_->recording) return std::unexpected("no D3D12 frame is recording");
    D3D12_RESOURCE_BARRIER barrier{}; barrier.Type = D3D12_RESOURCE_BARRIER_TYPE_TRANSITION; barrier.Transition.pResource = impl_->backbuffers[impl_->frame_index].Get();
    barrier.Transition.StateBefore = D3D12_RESOURCE_STATE_RENDER_TARGET; barrier.Transition.StateAfter = D3D12_RESOURCE_STATE_PRESENT; barrier.Transition.Subresource = D3D12_RESOURCE_BARRIER_ALL_SUBRESOURCES;
    impl_->command_list->ResourceBarrier(1, &barrier);
    HRESULT hr = impl_->command_list->Close(); if (FAILED(hr)) return std::unexpected(hrMessage("failed to close D3D12 command list", hr));
    ID3D12CommandList* lists[] = {impl_->command_list.Get()}; impl_->queue->ExecuteCommandLists(1, lists);
    const auto value = impl_->next_fence++; hr = impl_->queue->Signal(impl_->fence.Get(), value); if (FAILED(hr)) return std::unexpected(hrMessage("failed to signal D3D12 frame fence", hr));
    impl_->frame_fences[impl_->frame_index] = value; impl_->recording = false; impl_->submitted = true; return value;
}

std::expected<void, std::string> D3D12Backend::present(const FrameToken&) {
    if (!impl_->submitted) return std::unexpected("D3D12 frame must be submitted before present");
    const UINT flags = impl_->tearing ? DXGI_PRESENT_ALLOW_TEARING : 0;
    const HRESULT hr = impl_->swapchain->Present(impl_->tearing ? 0 : 1, flags);
    impl_->submitted = false;
    if (FAILED(hr)) { impl_->last_error = hrMessage("D3D12 present failed; device may be lost", hr); return std::unexpected(impl_->last_error); }
    return {};
}
std::expected<void, std::string> D3D12Backend::waitForFence(std::uint64_t value) { return impl_->wait(value); }
GpuCapabilities D3D12Backend::capabilities() const { return {impl_->adapter_name, impl_->dedicated_video_memory, impl_->debug_layer, impl_->tearing}; }
std::string D3D12Backend::deviceLostReason() const { return impl_->last_error.empty() ? std::string{"D3D12 device is healthy"} : impl_->last_error; }

} // namespace civic::presentation

#endif
