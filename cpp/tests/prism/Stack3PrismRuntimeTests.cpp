#include <gtest/gtest.h>

#include <atomic>
#include <memory>
#include <string>
#include <vector>

#include <civic/prism/PrismRuntime.hpp>

namespace prism = civic::prism;

TEST(Stack3PrismSnapshots, PublishedSnapshotsAreImmutableAndRevisioned) {
    prism::ImmutableSnapshotRegistry registry;
    prism::Snapshot snapshot{};
    snapshot.tick = 12;
    snapshot.schema_version = 3;
    snapshot.domain_revisions = {{"economy", 4}, {"personhood", 7}};
    snapshot.payload = "{\"population\":10}";
    auto published = registry.publish(std::move(snapshot)); ASSERT_TRUE(published);
    auto current = registry.latest(); ASSERT_TRUE(current);
    EXPECT_EQ(current->tick, 12U);
    EXPECT_EQ(current->schema_version, 3U);
    EXPECT_EQ(current->domain_revisions.at("economy"), 4U);
    EXPECT_EQ(current->payload, "{\"population\":10}");
    EXPECT_EQ(registry.publication_revision(), 1U);
}

TEST(Stack3PrismCausality, TracesStructuredContributionsToOutcomes) {
    prism::CausalityTraceStore traces;
    const auto trace = traces.begin({"economy", 9, "firm.margin"}, 20);
    ASSERT_TRUE(trace);
    ASSERT_TRUE(traces.add_contribution(*trace, {"freight", 4, "logistics.cost"}, 0.65, "delivered-cost"));
    ASSERT_TRUE(traces.add_contribution(*trace, {"labor", 2, "wage.cost"}, 0.35, "payroll"));
    auto explanation = traces.trace(*trace); ASSERT_TRUE(explanation);
    ASSERT_EQ(explanation->contributions.size(), 2U);
    EXPECT_EQ(explanation->outcome.metric, "firm.margin");
    EXPECT_EQ(explanation->contributions.front().cause.metric, "logistics.cost");
}

TEST(Stack3PrismTelemetry, CapturesDomainCountersAndCanBeDisabled) {
    prism::PerformanceTelemetry telemetry;
    telemetry.record("economy", {.milliseconds = 1.25, .entity_count = 100, .pathfinding_count = 4, .cache_hits = 9, .cache_misses = 1, .allocations = 3, .snapshot_bytes = 2048, .save_load_milliseconds = 0.5});
    auto economy = telemetry.domain("economy"); ASSERT_TRUE(economy);
    EXPECT_DOUBLE_EQ(economy->milliseconds, 1.25);
    EXPECT_EQ(economy->entity_count, 100U);
    telemetry.set_enabled(false);
    telemetry.record("economy", {.milliseconds = 99.0});
    EXPECT_DOUBLE_EQ(telemetry.domain("economy")->milliseconds, 1.25);
}

TEST(Stack3PrismJobs, OneThreadAndManyThreadsReduceIdentically) {
    std::vector<prism::DerivedJob> jobs;
    for (std::uint64_t i = 0; i < 128; ++i) {
        jobs.push_back({i, 7, [i] { return prism::JobResult{i, std::to_string((i * 37U) % 19U)}; }});
    }
    prism::DeterministicJobSystem single{1};
    prism::DeterministicJobSystem parallel{8};
    auto one = single.run(jobs); ASSERT_TRUE(one);
    auto many = parallel.run(jobs); ASSERT_TRUE(many);
    ASSERT_EQ(one->size(), many->size());
    for (std::size_t i = 0; i < one->size(); ++i) {
        EXPECT_EQ((*one)[i].canonical_key, (*many)[i].canonical_key);
        EXPECT_EQ((*one)[i].payload, (*many)[i].payload);
    }
}

TEST(Stack3PrismDomains, OrderedParallelExecutionMatchesSingleThreadAuthoritativeHash) {
    auto build_graph = [] {
        prism::OrderedDomainExecutor executor;
        EXPECT_TRUE(executor.add({"accessibility", {}, {"transport"}, {"accessibility"}, [](prism::DomainState& state) { state["accessibility"] = state["transport"] + 3; }}));
        EXPECT_TRUE(executor.add({"labor", {"accessibility"}, {"accessibility"}, {"labor"}, [](prism::DomainState& state) { state["labor"] = state["accessibility"] * 2; }}));
        EXPECT_TRUE(executor.add({"economy", {"labor"}, {"labor"}, {"economy"}, [](prism::DomainState& state) { state["economy"] = state["labor"] + 11; }}));
        return executor;
    };
    prism::DomainState one{{"transport", 5}};
    prism::DomainState many{{"transport", 5}};
    auto single = build_graph();
    auto parallel = build_graph();
    ASSERT_TRUE(single.execute(one, 1));
    ASSERT_TRUE(parallel.execute(many, 8));
    EXPECT_EQ(prism::canonical_state_hash(one), prism::canonical_state_hash(many));
    EXPECT_EQ(one, many);
}

TEST(Stack3PrismDomains, RejectsConflictingParallelWritesWithoutDependency) {
    prism::OrderedDomainExecutor executor;
    ASSERT_TRUE(executor.add({"a", {}, {}, {"economy"}, [](prism::DomainState& state) { state["economy"] = 1; }}));
    ASSERT_TRUE(executor.add({"b", {}, {}, {"economy"}, [](prism::DomainState& state) { state["economy"] = 2; }}));
    EXPECT_FALSE(executor.compile());
}
