#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <vector>

#include <civic/prism/PrismBenchmark.hpp>
#include <civic/prism/PrismRuntime.hpp>
#include <civic/socioeconomic/HousingEconomics.hpp>
#include <civic/socioeconomic/SocioeconomicAuthority.hpp>
#include <civic/socioeconomic/SocioeconomicIntegration.hpp>
#include <civic/socioeconomic/SocioeconomicPersistence.hpp>
#include <civic/socioeconomic/SocioeconomicRuntime.hpp>

namespace socio = civic::socioeconomic;
namespace prism = civic::prism;

TEST(Stack3FreightRouting, VehicleAssignmentConsumesNativeTransportQuote) {
    socio::FreightVehicleStore vehicles;
    const socio::RouteCostProvider route = [](civic::FirmId supplier, std::uint64_t destination) -> civic::Result<socio::DeliveredCostQuote> {
        if (supplier != civic::FirmId{4} || destination != 88) {
            return std::unexpected(civic::make_error(civic::ErrorCode::invalid_argument, "unexpected route request"));
        }
        return socio::DeliveredCostQuote{20, 3, 1, 17.25};
    };

    ASSERT_TRUE(socio::assign_freight_vehicle_with_transport(
        vehicles,
        socio::FreightVehicleId{9},
        socio::FreightOrderId{3},
        12,
        civic::FirmId{4},
        88,
        route));
    auto vehicle = vehicles.get(socio::FreightVehicleId{9});
    ASSERT_TRUE(vehicle);
    EXPECT_DOUBLE_EQ(vehicle->travel_time, 17.25);
    EXPECT_EQ(vehicle->cargo, 12);
}

TEST(Stack3BusinessLifecycle, PortsAcceptedDistressClosureRecoveryAndFormationScoring) {
    socio::BusinessLifecycleModel lifecycle;
    socio::FirmLifecycleMemory memory{
        .status = socio::BusinessLifecycleState::operating,
        .cash_health = 0.30,
        .consecutive_loss_cycles = 1,
    };
    const socio::FirmCycleFinancials loss{
        .revenue = 50.0,
        .input_cost = 20.0,
        .wage_cost = 20.0,
        .utility_cost = 5.0,
        .tax_cost = 5.0,
        .logistics_cost = 12.0,
        .shortage_penalty = 3.0,
        .operating_margin = -1.0,
    };

    auto first = lifecycle.evaluate_cycle(memory, loss, 100);
    ASSERT_TRUE(first);
    EXPECT_EQ(first->status, socio::BusinessLifecycleState::distressed);
    EXPECT_EQ(first->distress_reason, "input cost");

    memory = first->memory();
    memory.consecutive_loss_cycles = 3;
    memory.cash_health = 0.08;
    auto closed = lifecycle.evaluate_cycle(memory, loss, 200);
    ASSERT_TRUE(closed);
    EXPECT_EQ(closed->status, socio::BusinessLifecycleState::closed);
    ASSERT_TRUE(closed->closure_tick);
    EXPECT_EQ(*closed->closure_tick, 200U);

    const socio::FormationContext context{
        .reachable_gateway = true,
        .utility_ratio = 1.0,
        .labor_availability = 1.0,
        .accessibility = 1.0,
        .local_demand = 1.0,
        .sector_gap = 1.0,
        .tax_rate = 0.0,
    };
    EXPECT_DOUBLE_EQ(lifecycle.score_formation(context), 1.0);
    auto blocked = context;
    blocked.reachable_gateway = false;
    EXPECT_DOUBLE_EQ(lifecycle.score_formation(blocked), 0.0);
}

TEST(Stack3Lifecycle, AgingCadenceMutatesPeopleWithoutChangingPopulationCount) {
    socio::PersonRegistry people;
    auto p1 = people.create({civic::HouseholdId{1}, 20, 2, 1, true, civic::Money{100}}); ASSERT_TRUE(p1);
    auto p2 = people.create({civic::HouseholdId{1}, 70, 3, 2, false, civic::Money{0}}); ASSERT_TRUE(p2);
    socio::AuthoritativeLifecycleScheduler scheduler{123, {.aging_ticks = 10, .employment_ticks = 1000, .migration_ticks = 1000}};

    const auto count_before = people.size();
    ASSERT_TRUE(scheduler.step(9, people));
    EXPECT_EQ(people.get(*p1)->age, 20);
    auto outcome = scheduler.step(10, people); ASSERT_TRUE(outcome);
    EXPECT_EQ(outcome->aged, 2U);
    EXPECT_EQ(people.get(*p1)->age, 21);
    EXPECT_EQ(people.get(*p2)->age, 71);
    EXPECT_EQ(people.size(), count_before);
}

TEST(Stack3CausalChains, AccessibilityLaborAndWagesFlowIntoPersonAndHouseholdState) {
    socio::SocioeconomicRuntime runtime{77};
    ASSERT_TRUE(runtime.households().insert({civic::HouseholdId{1}, 1.0, civic::Money{0}, civic::Money{0}, 0, {}, 0}));
    auto person = runtime.people().create({civic::HouseholdId{1}, 30, 3, 2, false, civic::Money{0}}); ASSERT_TRUE(person);
    ASSERT_TRUE(runtime.register_payroll_accounts(civic::FirmId{4}, civic::HouseholdId{1}, socio::AccountId{10}, socio::AccountId{11}));

    socio::LaborMarket labor;
    ASSERT_TRUE(labor.add_worker({socio::WorkerId{5}, 2, 4.0, true}));
    ASSERT_TRUE(labor.add_worker({socio::WorkerId{6}, 2, 40.0, true}));
    ASSERT_TRUE(labor.add_opening({socio::JobOpeningId{9}, civic::FirmId{4}, 2, civic::Money{2500}, 3.0, true}));

    socio::EconomyPersonhoodIntegrator integration{runtime};
    ASSERT_TRUE(integration.bind_worker(socio::WorkerId{5}, *person, civic::HouseholdId{1}));
    auto allocations = integration.clear_labor_and_apply(labor, 12); ASSERT_TRUE(allocations);
    ASSERT_EQ(allocations->size(), 1U);
    EXPECT_EQ(allocations->front().worker, socio::WorkerId{5});
    EXPECT_TRUE(runtime.people().get(*person)->employed);
    EXPECT_EQ(runtime.households().get(civic::HouseholdId{1})->income.minor_units(), 2500);
}

TEST(Stack3CausalChains, HousingCostProducesDeterministicRelocationPressure) {
    socio::SocioeconomicRuntime runtime{1};
    socio::EconomyPersonhoodIntegrator integration{runtime};
    auto affordable = integration.housing_relocation_pressure(525.0, socio::HousingIncomeBand::lower);
    auto unaffordable = integration.housing_relocation_pressure(1050.0, socio::HousingIncomeBand::lower);
    ASSERT_TRUE(affordable && unaffordable);
    EXPECT_DOUBLE_EQ(*affordable, 0.0);
    EXPECT_DOUBLE_EQ(*unaffordable, 1.0);
}

TEST(Stack3CausalChains, LogisticsCostReducesFirmMarginAndProducesStructuredTrace) {
    socio::SocioeconomicRuntime runtime{1};
    socio::EconomyPersonhoodIntegrator integration{runtime};
    prism::CausalityTraceStore traces;
    const socio::FirmMarginInputs cheap{
        .revenue = 100.0,
        .input_cost = 20.0,
        .wage_cost = 20.0,
        .utility_cost = 5.0,
        .tax_cost = 5.0,
        .logistics_cost = 5.0,
        .shortage_penalty = 0.0,
    };
    auto expensive = cheap;
    expensive.logistics_cost = 25.0;

    auto baseline = integration.explain_firm_margin(civic::FirmId{3}, cheap, traces, 20); ASSERT_TRUE(baseline);
    auto stressed = integration.explain_firm_margin(civic::FirmId{3}, expensive, traces, 21); ASSERT_TRUE(stressed);
    EXPECT_GT(baseline->operating_margin, stressed->operating_margin);
    auto trace = traces.trace(stressed->trace); ASSERT_TRUE(trace);
    EXPECT_EQ(trace->outcome.metric, "firm.margin");
    EXPECT_TRUE(std::ranges::any_of(trace->contributions, [](const auto& contribution) {
        return contribution.cause.metric == "logistics.cost";
    }));
}

TEST(Stack3Compatibility, TransitionalServicesHaveExactlyOneWriterAndRevisionedSnapshots) {
    socio::CivicEconomicCompatibilityGateway gateway;
    const socio::ServiceEconomicInterface service{1, 8.0, 5.0, 10.0, civic::Money{400}, 0.7};
    ASSERT_TRUE(gateway.publish_service(socio::CompatibilityWriter::typescript, service));
    auto first = gateway.service(1); ASSERT_TRUE(first);
    EXPECT_EQ(first->revision, 1U);
    EXPECT_EQ(first->writer, socio::CompatibilityWriter::typescript);

    ASSERT_TRUE(gateway.transfer_service_to_native(1));
    EXPECT_FALSE(gateway.publish_service(socio::CompatibilityWriter::typescript, service));
    ASSERT_TRUE(gateway.publish_service(socio::CompatibilityWriter::native, service));
    auto native = gateway.service(1); ASSERT_TRUE(native);
    EXPECT_EQ(native->writer, socio::CompatibilityWriter::native);
    EXPECT_EQ(native->revision, 2U);
}

TEST(Stack3Causality, CommuteAccessibilityTraceIsStructuredAndReconstructable) {
    prism::CausalityTraceStore traces;
    auto id = socio::record_commute_accessibility_trace(
        traces,
        socio::PersonId{44},
        91,
        0.55,
        0.30,
        0.15);
    ASSERT_TRUE(id);
    auto trace = traces.trace(*id); ASSERT_TRUE(trace);
    EXPECT_EQ(trace->outcome.domain, "personhood");
    EXPECT_EQ(trace->outcome.metric, "commute.accessibility");
    EXPECT_EQ(trace->contributions.size(), 3U);
}

TEST(Stack3Performance, RepresentativeCityBenchmarkRecordsRequiredCounters) {
    prism::PerformanceTelemetry telemetry;
    prism::RepresentativeCityBenchmark benchmark;
    const prism::RepresentativeCityWorkload workload{
        .entity_count = 100000,
        .pathfinding_count = 5000,
        .snapshot_bytes = 8U * 1024U * 1024U,
        .iterations = 3,
    };
    auto result = benchmark.run("socioeconomic-large-city", workload, telemetry); ASSERT_TRUE(result);
    auto recorded = telemetry.domain("socioeconomic-large-city"); ASSERT_TRUE(recorded);
    EXPECT_EQ(recorded->entity_count, workload.entity_count);
    EXPECT_EQ(recorded->pathfinding_count, workload.pathfinding_count);
    EXPECT_EQ(recorded->snapshot_bytes, workload.snapshot_bytes);
    EXPECT_GE(recorded->milliseconds, 0.0);
}

TEST(Stack3SaveReplay, SaveLoadContinueMatchesUninterruptedAuthoritativeFuture) {
    socio::SocioeconomicAuthority uninterrupted{19};
    ASSERT_TRUE(uninterrupted.apply({1, 1, socio::SocioeconomicCommandType::create_household, 7, 2, 1000}));
    ASSERT_TRUE(uninterrupted.apply({2, 2, socio::SocioeconomicCommandType::create_person, 7, 30, 800}));

    auto encoded = socio::SocioeconomicPersistence::serialize_v9_extension(uninterrupted.runtime(), 2); ASSERT_TRUE(encoded);
    auto restored_runtime = socio::SocioeconomicPersistence::restore_v9_extension(*encoded); ASSERT_TRUE(restored_runtime);

    ASSERT_TRUE(uninterrupted.apply({3, 3, socio::SocioeconomicCommandType::create_person, 7, 8, 0}));
    socio::SocioeconomicAuthority continued{19};
    continued.runtime() = std::move(*restored_runtime);
    ASSERT_TRUE(continued.apply(uninterrupted.journal()[2]));
    EXPECT_EQ(continued.runtime().authoritative_hash(), uninterrupted.runtime().authoritative_hash());
}
