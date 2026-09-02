#pragma once

#include <civic/bridge/civic_engine.h>

#include <cstdint>
#include <string>

namespace civic::bridge {

[[nodiscard]] inline int runReferenceFixture() {
    cf_engine* left = nullptr;
    cf_engine* right = nullptr;
    const cf_engine_config config{73U, 0U, 1U};
    if (cf_engine_create(&config, &left) != CF_ERROR_NONE || !left) return 10;
    if (cf_engine_create(&config, &right) != CF_ERROR_NONE || !right) {
        cf_engine_destroy(left);
        return 11;
    }

    const std::string commands = R"([{"sequence":1,"tick":1,"type":"reference-fixture","payload":{"a":1,"b":2}}])";
    const auto* data = reinterpret_cast<const std::uint8_t*>(commands.data());
    if (cf_engine_submit_commands(left, data, commands.size()) != CF_ERROR_NONE ||
        cf_engine_submit_commands(right, data, commands.size()) != CF_ERROR_NONE) {
        cf_engine_destroy(left);
        cf_engine_destroy(right);
        return 12;
    }
    if (cf_engine_step(left, 64U) != CF_ERROR_NONE || cf_engine_step(right, 64U) != CF_ERROR_NONE) {
        cf_engine_destroy(left);
        cf_engine_destroy(right);
        return 13;
    }

    cf_domain_hash left_hash{};
    cf_domain_hash right_hash{};
    const bool hashes_ok =
        cf_engine_get_domain_hash(left, "kernel", &left_hash) == CF_ERROR_NONE &&
        cf_engine_get_domain_hash(right, "kernel", &right_hash) == CF_ERROR_NONE &&
        left_hash.ownership == 1U && right_hash.ownership == 1U &&
        left_hash.version == right_hash.version && left_hash.value == right_hash.value;

    cf_buffer left_snapshot{};
    cf_buffer right_snapshot{};
    const bool snapshots_ok =
        cf_engine_get_snapshot(left, &left_snapshot) == CF_ERROR_NONE &&
        cf_engine_get_snapshot(right, &right_snapshot) == CF_ERROR_NONE &&
        left_snapshot.size == right_snapshot.size && left_snapshot.size > 0U &&
        std::string(reinterpret_cast<const char*>(left_snapshot.data), left_snapshot.size) ==
            std::string(reinterpret_cast<const char*>(right_snapshot.data), right_snapshot.size);

    cf_buffer_free(left_snapshot);
    cf_buffer_free(right_snapshot);
    cf_engine_destroy(left);
    cf_engine_destroy(right);
    return hashes_ok && snapshots_ok ? 0 : 14;
}

} // namespace civic::bridge
