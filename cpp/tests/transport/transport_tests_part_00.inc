#include <civic/transport/transport_engine.hpp>
#include <cmath>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

using namespace civic::transport;

namespace {
int failures = 0;
#define CHECK(expr) do { if (!(expr)) { std::cerr << "FAIL " << __FILE__ << ':' << __LINE__ << " " #expr "\n"; ++failures; } } while (false)
#define CHECK_NEAR(a,b,eps) do { if (std::fabs((a)-(b)) > (eps)) { std::cerr << "FAIL " << __FILE__ << ':' << __LINE__ << " |" #a "-" #b "|\n"; ++failures; } } while (false)

template<class F> void check_throws(F&& fn) {
    bool threw = false;
    try { fn(); } catch (const std::exception&) { threw = true; }
    CHECK(threw);
}

NetworkSnapshot four_way() {
    LegacyRoadAdapter adapter;
    std::vector<LegacyRoadCell> cells{
        {0,0,RoadClass::local}, {-1,0,RoadClass::local}, {1,0,RoadClass::collector},
        {0,-1,RoadClass::arterial}, {0,1,RoadClass::local}
    };
    return adapter.project(cells, 7);
}

void test_legacy_projection_and_network_invariants() {
    auto snap = four_way();
    CHECK(snap.topology_revision == 7);
    CHECK(snap.junctions.size() == 5);
    CHECK(snap.segments.size() == 4);
    CHECK(snap.carriageways.size() == 8);
    CHECK(!snap.lanes.empty());
    CHECK(!snap.movements.empty());
    validate_network(snap);

    NetworkStore store;
    auto r = store.replace(snap);
    CHECK(r.changed);
    CHECK(store.topology_revision() == 1);
    auto stable = store.replace(snap);
    CHECK(!stable.changed);

    auto broken = snap;
    broken.lanes.push_back(broken.lanes.front());
    check_throws([&] { validate_network(broken); });
}

void test_intersection_control_conflicts() {
    auto snap = four_way();
    IntersectionControl control;
    auto movements = snap.movements;
    CHECK(movements.size() >= 2);
    const auto a = movements.front().id;
    MovementId b{};
    for (const auto& candidate : movements) {
        if (candidate.id != a && control.conflict(snap, a, candidate.id)) { b = candidate.id; break; }
    }
    CHECK(!b.value.empty());
    SignalPlan plan{SignalPlanId{"signal:1"}, {{a,b}}, 0};
    check_throws([&] { control.validate_signal_plan(snap, plan); });
}

void test_signal_cycle_and_control_capacity() {
    auto snap = four_way();
    IntersectionControl control;
    CHECK(snap.movements.size() >= 2);
    const auto a = snap.movements[0].id;
    MovementId b{};
    for (const auto& candidate : snap.movements) {
        if (candidate.id != a && candidate.junction_id == snap.movements[0].junction_id) { b = candidate.id; break; }
    }
    CHECK(!b.value.empty());
    SignalPlan plan{SignalPlanId{"signal:cycle"}, {{a}, {b}}, 2, 5};
    control.validate_signal_plan(snap, plan);
    CHECK(control.active_phase(plan, 2) == 0);
    CHECK(control.active_phase(plan, 7) == 1);
    CHECK(control.movement_green(plan, a, 2));
    CHECK(!control.movement_green(plan, a, 7));
    CHECK_NEAR(control.capacity_factor(ControlType::stop, nullptr, a, 0), 0.65, 1e-9);
