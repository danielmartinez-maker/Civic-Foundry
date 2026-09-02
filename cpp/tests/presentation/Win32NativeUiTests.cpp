#include <gtest/gtest.h>

#include <civic/presentation/Win32NativeUi.hpp>

#ifdef _WIN32

#include <civic/presentation/D3D12Backend.hpp>

#include <type_traits>

using namespace civic::presentation;

static_assert(!std::is_copy_constructible_v<Win32NativeUi>);
static_assert(!std::is_copy_assignable_v<Win32NativeUi>);
static_assert(std::is_move_constructible_v<Win32NativeUi>);

TEST(Win32NativeUiContract, RejectsNullPlatformDependencies) {
    Win32NativeUiConfig config{};
    const auto ui = Win32NativeUi::create(config);
    EXPECT_FALSE(ui.has_value());
}

TEST(Win32NativeUiContract, ConfigDefaultsAreSafeAndBounded) {
    const Win32NativeUiConfig config{};
    EXPECT_EQ(config.frames_in_flight, 2U);
    EXPECT_GE(config.descriptor_capacity, 8U);
}

TEST(Win32NativeUiContract, D3D12BackendPublishesOnlyPresentationNativeContext) {
    D3D12Backend backend{};
    const auto native = backend.nativeUiContext();
    EXPECT_EQ(native.device, nullptr);
    EXPECT_EQ(native.command_queue, nullptr);
    EXPECT_EQ(native.command_list, nullptr);
    EXPECT_EQ(native.frames_in_flight, 2U);
    EXPECT_EQ(native.rtv_format, 87U);
}

#endif
