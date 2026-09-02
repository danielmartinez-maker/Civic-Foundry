#ifdef _WIN32

// Keep the native presentation escape hatch D3D12-specific without widening
// IGpuBackend. This translation unit owns the implementation so the private
// D3D12 backend state remains encapsulated from the generic renderer API.
#include "D3D12Backend.cpp"

namespace civic::presentation {

D3D12NativeUiContext D3D12Backend::nativeUiContext() const noexcept {
    D3D12NativeUiContext context{};
    if (!impl_ || !impl_->initialized) return context;
    context.device = impl_->device.Get();
    context.command_queue = impl_->queue.Get();
    context.command_list = impl_->recording ? impl_->command_list.Get() : nullptr;
    return context;
}

} // namespace civic::presentation

#endif
