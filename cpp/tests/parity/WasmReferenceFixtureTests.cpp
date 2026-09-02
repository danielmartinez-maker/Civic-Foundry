#include <gtest/gtest.h>

#include <civic/bridge/ReferenceFixture.hpp>

TEST(WasmReferenceFixture, MatchesNativeDeterministicKernelContract) {
    EXPECT_EQ(civic::bridge::runReferenceFixture(), 0);
}
