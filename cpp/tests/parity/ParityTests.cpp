#include <gtest/gtest.h>
#include <civic/bridge/civic_engine.h>

TEST(CAbi, LifecycleBufferOwnershipAndErrorContract) {
    cf_engine* engine = nullptr; const cf_engine_config config{9, 0, 1};
    ASSERT_EQ(cf_engine_create(&config, &engine), CF_ERROR_NONE); ASSERT_NE(engine, nullptr);
    ASSERT_EQ(cf_engine_step(engine, 1), CF_ERROR_NONE);
    cf_buffer snapshot{}; ASSERT_EQ(cf_engine_get_snapshot(engine, &snapshot), CF_ERROR_NONE); EXPECT_GT(snapshot.size, 0U); cf_buffer_free(snapshot);
    cf_buffer save{}; EXPECT_EQ(cf_engine_save_v9(engine, &save), CF_ERROR_INVALID_STATE);
    cf_error error{}; ASSERT_EQ(cf_engine_get_last_error(engine, &error), CF_ERROR_NONE); EXPECT_EQ(error.code, CF_ERROR_INVALID_STATE); EXPECT_GT(error.message.size, 0U); cf_buffer_free(error.message);
    cf_engine_destroy(engine);
}

TEST(CAbi, RepeatedLifecycleIsSafe) {
    for (int index = 0; index < 1000; ++index) {
        cf_engine* engine = nullptr; const cf_engine_config config{static_cast<uint32_t>(index), 0, 1};
        ASSERT_EQ(cf_engine_create(&config, &engine), CF_ERROR_NONE);
        cf_engine_destroy(engine);
    }
}
