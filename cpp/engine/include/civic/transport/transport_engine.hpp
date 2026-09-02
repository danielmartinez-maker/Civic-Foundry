#pragma once

#include <compare>
#include <cstdint>
#include <functional>
#include <map>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <string_view>
#include <tuple>
#include <utility>
#include <vector>

namespace civic::transport {

template<class Tag>
struct Id {
    std::string value;
    Id() = default;
    explicit Id(std::string v) : value(std::move(v)) {}
    auto operator<=>(const Id&) const = default;
};
struct RoadTag {}; struct SegmentTag {}; struct CarriagewayTag {}; struct LaneTag {};
struct LaneGroupTag {}; struct JunctionTag {}; struct MovementTag {}; struct SignalPlanTag {};
struct ParkingFacilityTag {}; struct ParkingReservationTag {}; struct IncidentTag {}; struct RouteTag {};
struct TripTag {}; struct TransitStopTag {}; struct TransitLineTag {}; struct TransitRunTag {}; struct PassengerCohortTag {};
using RoadId = Id<RoadTag>; using SegmentId = Id<SegmentTag>; using CarriagewayId = Id<CarriagewayTag>;
using LaneId = Id<LaneTag>; using LaneGroupId = Id<LaneGroupTag>; using JunctionId = Id<JunctionTag>;
using MovementId = Id<MovementTag>; using SignalPlanId = Id<SignalPlanTag>; using ParkingFacilityId = Id<ParkingFacilityTag>;
using ParkingReservationId = Id<ParkingReservationTag>; using IncidentId = Id<IncidentTag>; using RouteId = Id<RouteTag>;
using TripId = Id<TripTag>; using TransitStopId = Id<TransitStopTag>; using TransitLineId = Id<TransitLineTag>;
using TransitRunId = Id<TransitRunTag>; using PassengerCohortId = Id<PassengerCohortTag>;

enum class RoadClass { local, collector, arterial, avenue, expressway, highway };
enum class Direction { forward, backward };
enum class LaneType { through, turn, bus, bike, parking, reversible, shoulder };
enum class MovementType { left, through, right, u_turn };
enum class ControlType { uncontrolled, stop, yield, signal };
enum class IncidentState { planned, active, clearing, cleared };
enum class VehiclePermission : std::uint32_t {
    private_car = 1u << 0, taxi_ride_hail = 1u << 1, light_commercial = 1u << 2,
    heavy_freight = 1u << 3, bus = 1u << 4, emergency = 1u << 5, bicycle = 1u << 6,
};
using VehiclePermissionMask = std::uint32_t;
constexpr VehiclePermissionMask permission(VehiclePermission p) { return static_cast<VehiclePermissionMask>(p); }
constexpr VehiclePermissionMask all_vehicle_permissions = (1u << 7) - 1u;

enum class TripCause { home_to_work, home_to_school, home_to_shopping, firm_to_supplier, warehouse_to_customer, incident_to_facility, construction_to_supplier };
enum class TransitMode { bus, tram, metro, rail, ferry };
enum class TravelMode { car, transit, unmet };
enum class TransitVehicleState { in_service, out_of_service, failed };
enum class RoadVehicleStatus { moving, queued };

struct Junction { JunctionId id; double x{}; double y{}; std::string source_legacy_cell; auto operator<=>(const Junction&) const = default; };
struct RoadSegment {
    SegmentId id; RoadClass road_class{RoadClass::local}; std::string geometry_ref; JunctionId start_junction_id; JunctionId end_junction_id;
    double length_meters{}; double speed_limit_kph{}; double condition{1}; std::string access_policy_id{"all"}; std::string toll_policy_id;
    std::vector<CarriagewayId> carriageway_ids; std::vector<std::string> source_legacy_cells;
    auto operator<=>(const RoadSegment&) const = default;
};
struct Carriageway {
    CarriagewayId id; SegmentId segment_id; Direction direction{Direction::forward}; JunctionId from_junction_id; JunctionId to_junction_id;
    RoadClass operating_class{RoadClass::local}; std::vector<LaneId> lane_ids;
    auto operator<=>(const Carriageway&) const = default;
};
struct Lane {
    LaneId id; CarriagewayId carriageway_id; std::uint32_t ordinal{}; LaneType type{LaneType::through}; VehiclePermissionMask permissions{all_vehicle_permissions};
    bool open{true}; double base_capacity_per_minute{}; double free_flow_speed_kph{};
    auto operator<=>(const Lane&) const = default;
};
struct TurnMovement {
    MovementId id; JunctionId junction_id; CarriagewayId from_carriageway_id; CarriagewayId to_carriageway_id;
    std::vector<LaneId> from_lane_ids; std::vector<LaneId> to_lane_ids; MovementType type{MovementType::through};
    VehiclePermissionMask permissions{all_vehicle_permissions}; bool allowed{true}; double base_penalty_ticks{};
    auto operator<=>(const TurnMovement&) const = default;
};
struct LaneGroup {
    LaneGroupId id; CarriagewayId carriageway_id; std::vector<LaneId> lane_ids; std::vector<MovementId> movement_ids;
    VehiclePermissionMask permissions{}; double capacity_per_minute{}; double free_flow_speed_kph{};
    auto operator<=>(const LaneGroup&) const = default;
};
struct NetworkSnapshot {
    std::vector<Junction> junctions; std::vector<RoadSegment> segments; std::vector<Carriageway> carriageways; std::vector<Lane> lanes; std::vector<TurnMovement> movements;
    std::uint64_t topology_revision{}; std::uint64_t cost_revision{};
    auto operator<=>(const NetworkSnapshot&) const = default;
};
struct MutationResult { bool changed{}; std::string reason; };

void validate_network(const NetworkSnapshot& snapshot);
std::vector<TurnMovement> build_turn_movements(const NetworkSnapshot& physical);
std::vector<LaneGroup> build_lane_groups(const NetworkSnapshot& snapshot);

class NetworkStore {
public:
    MutationResult replace(const NetworkSnapshot& snapshot);
    MutationResult set_lane_open(const LaneId&, bool);
    MutationResult set_lane_permissions(const LaneId&, VehiclePermissionMask);
    MutationResult set_movement_allowed(const MovementId&, bool);
    std::uint64_t advance_cost_revision();
    [[nodiscard]] NetworkSnapshot snapshot() const;
    void restore(const NetworkSnapshot&);
    [[nodiscard]] std::uint64_t topology_revision() const { return state_.topology_revision; }
    [[nodiscard]] std::uint64_t cost_revision() const { return state_.cost_revision; }
private:
    NetworkSnapshot state_{};
};

struct LegacyRoadCell { int x{}; int y{}; RoadClass road_class{RoadClass::local}; bool one_way{}; Direction one_way_direction{Direction::forward}; };
class LegacyRoadAdapter {
public:
    [[nodiscard]] NetworkSnapshot project(const std::vector<LegacyRoadCell>& cells, std::uint64_t source_revision) const;
};

struct SignalPlan { SignalPlanId id; std::vector<std::vector<MovementId>> phases; std::uint32_t offset_ticks{}; std::uint32_t phase_duration_ticks{10}; auto operator<=>(const SignalPlan&) const = default; };
class IntersectionControl {
public:
    [[nodiscard]] bool conflict(const NetworkSnapshot&, const MovementId&, const MovementId&) const;
    void validate_signal_plan(const NetworkSnapshot&, const SignalPlan&) const;
    [[nodiscard]] std::size_t active_phase(const SignalPlan&, std::uint64_t tick) const;
    [[nodiscard]] bool movement_green(const SignalPlan&, const MovementId&, std::uint64_t tick) const;
    [[nodiscard]] double capacity_factor(ControlType, const SignalPlan*, const MovementId&, std::uint64_t tick) const;
};

struct JunctionControl { JunctionId junction_id; ControlType type{ControlType::uncontrolled}; std::optional<SignalPlan> signal_plan; auto operator<=>(const JunctionControl&) const = default; };
struct IntersectionControlSnapshot { std::vector<JunctionControl> controls; std::uint64_t revision{}; auto operator<=>(const IntersectionControlSnapshot&) const = default; };
class IntersectionControlStore {
public:
    void upsert(const NetworkSnapshot&, JunctionControl);
    [[nodiscard]] double capacity_factor(const NetworkSnapshot&, const JunctionId&, const MovementId&, std::uint64_t tick) const;
    [[nodiscard]] IntersectionControlSnapshot snapshot() const;
    void restore(const NetworkSnapshot&, const IntersectionControlSnapshot&);
private:
    std::map<JunctionId,JunctionControl> controls_;
    std::uint64_t revision_{};
};

struct RouteResult {
    std::vector<JunctionId> junction_ids; std::vector<CarriagewayId> carriageway_ids; std::vector<MovementId> movement_ids; double total_cost{};
    auto operator<=>(const RouteResult&) const = default;
};
struct GeneralizedCostConfig {
    double travel_time_weight{1}; double intersection_delay_weight{1}; double toll_cost{}; double destination_parking_cost{}; double reliability_cost{};
    std::uint64_t cost_revision{};
    std::function<double(const CarriagewayId&)> incident_penalty;
};
class RoutingEngine {
public:
    [[nodiscard]] std::optional<RouteResult> find_route(const NetworkSnapshot&, const JunctionId&, const JunctionId&, VehiclePermissionMask, const GeneralizedCostConfig&);
    void clear_cache();
private:
    std::map<std::string, std::optional<RouteResult>> cache_;
    std::uint64_t cached_topology_revision_{static_cast<std::uint64_t>(-1)};
};

struct ParkingFacility {
    ParkingFacilityId id; JunctionId access_junction_id; double capacity{}; double occupied{}; double price{}; double access_penalty_ticks{};
    auto operator<=>(const ParkingFacility&) const = default;
};
struct ParkingReservation { ParkingReservationId id; ParkingFacilityId facility_id; double weight{}; auto operator<=>(const ParkingReservation&) const = default; };
struct ParkingSnapshot { std::vector<ParkingFacility> facilities; std::vector<ParkingReservation> reservations; std::uint64_t next_reservation_id{1}; auto operator<=>(const ParkingSnapshot&) const = default; };
class ParkingSystem {
public:
    void upsert(ParkingFacility);
    [[nodiscard]] std::optional<ParkingReservationId> reserve(const ParkingFacilityId&, double weight);
    void release(const ParkingReservationId&);
    [[nodiscard]] double occupancy(const ParkingFacilityId&) const;
    [[nodiscard]] double generalized_penalty(const ParkingFacilityId&) const;
    [[nodiscard]] ParkingSnapshot snapshot() const;
    void restore(const ParkingSnapshot&);
private:
    std::map<ParkingFacilityId, ParkingFacility> facilities_;
    std::map<ParkingReservationId, ParkingReservation> reservations_;
    std::uint64_t next_reservation_id_{1};
};

struct Incident {
    IncidentId id; CarriagewayId carriageway_id; double capacity_factor{1}; double speed_factor{1}; IncidentState state{IncidentState::active};
    std::uint64_t start_tick{}; std::uint64_t clear_tick{};
    auto operator<=>(const Incident&) const = default;
};
struct IncidentSnapshot { std::vector<Incident> incidents; std::uint64_t cost_revision{}; auto operator<=>(const IncidentSnapshot&) const = default; };
class IncidentSystem {
public:
    void upsert(Incident);
    void clear(const IncidentId&);
    void step(std::uint64_t tick);
    [[nodiscard]] double capacity_factor(const CarriagewayId&) const;
    [[nodiscard]] double speed_factor(const CarriagewayId&) const;
    [[nodiscard]] double route_penalty(const CarriagewayId&) const;
    [[nodiscard]] std::uint64_t cost_revision() const { return cost_revision_; }
    [[nodiscard]] IncidentSnapshot snapshot() const;
    void restore(const IncidentSnapshot&);
private:
    std::map<IncidentId, Incident> incidents_;
    std::uint64_t cost_revision_{};
};

struct TrafficMetric { CarriagewayId carriageway_id; double weighted_vehicles{}; double capacity_per_minute{}; double utilization{}; double travel_time_multiplier{1}; double speed_kph{}; auto operator<=>(const TrafficMetric&) const = default; };
struct TrafficLoadRecord { CarriagewayId carriageway_id; double weighted_vehicles{}; auto operator<=>(const TrafficLoadRecord&) const = default; };
struct TrafficFlowSnapshot { std::vector<TrafficLoadRecord> loads; auto operator<=>(const TrafficFlowSnapshot&) const = default; };
class TrafficFlowState {
public:
    void set_load(const CarriagewayId&, double weight);
    void add_load(const CarriagewayId&, double weight);
    [[nodiscard]] TrafficMetric metric(const NetworkSnapshot&, const CarriagewayId&, double incident_capacity_factor = 1.0) const;
    [[nodiscard]] double total_load() const;
    [[nodiscard]] TrafficFlowSnapshot snapshot() const;
    void restore(const TrafficFlowSnapshot&);
private: std::map<CarriagewayId,double> loads_; };

struct ActiveRoadVehicle {
    std::string id; TripId trip_id; TripCause cause{TripCause::home_to_work}; double traveler_weight{};
    std::string origin_id; std::string destination_id; std::vector<CarriagewayId> carriageway_ids;
    std::size_t current_carriageway_index{}; double carriageway_progress_ticks{}; std::uint64_t departure_tick{};
    double accumulated_delay_ticks{}; double free_flow_ticks{}; RoadVehicleStatus status{RoadVehicleStatus::moving};
    std::optional<JunctionId> queued_junction_id;
    auto operator<=>(const ActiveRoadVehicle&) const = default;
};
struct RoadTrafficSnapshot {
    std::vector<ActiveRoadVehicle> vehicles; std::uint64_t next_vehicle_id{1}; std::uint64_t completed_trips{};
    std::uint64_t failed_trips{}; std::uint64_t congestion_epoch{};
    auto operator<=>(const RoadTrafficSnapshot&) const = default;
};
class RoadTrafficState {
public:
    [[nodiscard]] RoadTrafficSnapshot snapshot() const;
    [[nodiscard]] TrafficFlowSnapshot flow_snapshot() const;
    void restore(const NetworkSnapshot&, const RoadTrafficSnapshot&);
private:
    std::map<std::string,ActiveRoadVehicle> vehicles_;
    std::uint64_t next_vehicle_id_{1}; std::uint64_t completed_trips_{}; std::uint64_t failed_trips_{}; std::uint64_t congestion_epoch_{};
};

struct TripSource { std::string id; double weight{}; };
struct Trip {
    TripId id; TripCause cause{TripCause::home_to_work}; std::string origin_id; std::string destination_id; std::uint64_t departure_tick{}; double traveler_weight{};
    auto operator<=>(const Trip&) const = default;
};
class TripGenerator {
public:
    explicit TripGenerator(std::uint64_t seed);
    [[nodiscard]] std::vector<Trip> generate(TripCause, const std::vector<TripSource>&, const std::vector<std::string>& destinations, std::uint64_t tick);
private:
    std::uint64_t state_{}; std::uint64_t next_trip_id_{1};
    std::uint64_t next_random();
};

struct ModeAlternative {
    bool available{}; double travel_time{}; double waiting{}; double transfers{}; double fare{}; double fuel{}; double toll{}; double parking{}; double comfort_penalty{}; double accessibility_penalty{};
    auto operator<=>(const ModeAlternative&) const = default;
};
struct ModeChoiceInput { ModeAlternative car; ModeAlternative transit; double reliability_weight{1}; auto operator<=>(const ModeChoiceInput&) const = default; };
struct ModeChoiceResult { TravelMode mode{TravelMode::unmet}; double car_cost{}; double transit_cost{}; double chosen_cost{}; auto operator<=>(const ModeChoiceResult&) const = default; };
class ModeChoice { public: [[nodiscard]] ModeChoiceResult choose(const ModeChoiceInput&) const; };

struct TransitStop { TransitStopId id; double x{}; double y{}; TransitMode mode{TransitMode::bus}; auto operator<=>(const TransitStop&) const = default; };
struct TransitLine { TransitLineId id; TransitMode mode{TransitMode::bus}; std::vector<TransitStopId> stop_ids; double fare{}; std::uint64_t headway_ticks{}; bool enabled{}; auto operator<=>(const TransitLine&) const = default; };
struct TransitNetworkSnapshot { std::vector<TransitStop> stops; std::vector<TransitLine> lines; std::uint64_t revision{}; auto operator<=>(const TransitNetworkSnapshot&) const = default; };
void validate_transit(const TransitNetworkSnapshot&);
class TransitNetwork {
public:
    void upsert_stop(TransitStop);
    void upsert_line(TransitLine);
    bool remove_stop(const TransitStopId&);
    bool remove_line(const TransitLineId&);
    [[nodiscard]] TransitNetworkSnapshot snapshot() const;
    void restore(const TransitNetworkSnapshot&);
private:
    std::map<TransitStopId,TransitStop> stops_; std::map<TransitLineId,TransitLine> lines_; std::uint64_t revision_{};
};

struct TransferLeg { TransitLineId line_id; std::string direction_key; TransitStopId boarding_stop_id; TransitStopId alighting_stop_id; auto operator<=>(const TransferLeg&) const = default; };
struct PassengerCohort {
    PassengerCohortId id; TripId trip_id; double traveler_weight{}; TransitLineId line_id; std::string direction_key; TransitStopId boarding_stop_id; TransitStopId alighting_stop_id;
    std::vector<TransferLeg> transfer_legs; std::uint64_t enqueued_tick{};
    auto operator<=>(const PassengerCohort&) const = default;
};
struct PassengerQueueEntry { TransitStopId stop_id; TransitLineId line_id; std::string direction_key; std::vector<PassengerCohort> cohorts; auto operator<=>(const PassengerQueueEntry&) const = default; };
struct PassengerQueueSnapshot { std::uint64_t next_split_id{1}; std::vector<PassengerQueueEntry> queues; auto operator<=>(const PassengerQueueSnapshot&) const = default; };
struct BoardingResult { std::vector<PassengerCohort> boarded; double boarded_weight{}; double left_behind_weight{}; auto operator<=>(const BoardingResult&) const = default; };
class PassengerQueues {
public:
    bool enqueue(PassengerCohort);
    [[nodiscard]] BoardingResult board(const TransitStopId&, const TransitLineId&, std::string_view direction_key, double capacity);
    bool enqueue_next_transfer(PassengerCohort, std::uint64_t tick);
    [[nodiscard]] double waiting_weight(const TransitStopId&, const TransitLineId&, std::string_view direction_key) const;
    [[nodiscard]] double total_waiting_weight() const;
    [[nodiscard]] PassengerQueueSnapshot snapshot() const;
    void restore(const PassengerQueueSnapshot&);
private:
    std::map<std::string,PassengerQueueEntry> queues_; std::uint64_t next_split_id_{1};
};

struct TransitVehicle { TransitRunId run_id; TransitLineId line_id; double capacity{}; TransitVehicleState state{TransitVehicleState::in_service}; std::size_t stop_index{}; std::uint64_t dwell_remaining{}; bool stop_serviced{}; double reliability{1.0}; auto operator<=>(const TransitVehicle&) const = default; };
struct TransitVehicleRecord { TransitVehicle vehicle; std::vector<PassengerCohort> onboard; auto operator<=>(const TransitVehicleRecord&) const = default; };
struct TransitOperationsSnapshot { std::vector<TransitVehicleRecord> vehicles; std::uint64_t next_run_id{1}; auto operator<=>(const TransitOperationsSnapshot&) const = default; };
struct TransitStepResult { double boarded_weight{}; double completed_weight{}; double transferred_weight{}; double cancelled_weight{}; auto operator<=>(const TransitStepResult&) const = default; };
class TransitOperations {
public:
    void add_vehicle(TransitVehicle);
    [[nodiscard]] TransitRunId dispatch(const TransitLineId&, double capacity);
    void set_onboard(const TransitRunId&, std::vector<PassengerCohort>);
    [[nodiscard]] TransitStepResult step(const TransitNetworkSnapshot&, PassengerQueues&, std::uint64_t tick, std::uint64_t dwell_ticks = 2);
    [[nodiscard]] std::vector<PassengerCohort> fail_vehicle(const TransitRunId&);
    [[nodiscard]] double total_onboard_weight() const;
    [[nodiscard]] double in_service_capacity() const;
    [[nodiscard]] double crowding_ratio() const;
    [[nodiscard]] TransitOperationsSnapshot snapshot() const;
    void restore(const TransitOperationsSnapshot&);
private: std::map<TransitRunId,TransitVehicleRecord> vehicles_; std::uint64_t next_run_id_{1}; };
[[nodiscard]] double stranded_weight(const std::vector<PassengerCohort>&);

struct JourneyLeg { TravelMode mode{TravelMode::unmet}; JunctionId from; JunctionId to; TransitLineId line_id; double generalized_cost{}; auto operator<=>(const JourneyLeg&) const = default; };
struct JourneyPlan { std::vector<JourneyLeg> legs; double total_generalized_cost{}; auto operator<=>(const JourneyPlan&) const = default; };
class MultimodalJourneyPlanner {
public:
    [[nodiscard]] std::optional<JourneyPlan> plan(const NetworkSnapshot&, const TransitNetworkSnapshot&, const JunctionId&, const JunctionId&, const GeneralizedCostConfig&);
};

struct TransportationSnapshot {
    NetworkSnapshot network; IntersectionControlSnapshot controls; ParkingSnapshot parking; IncidentSnapshot incidents;
    TrafficFlowSnapshot traffic; RoadTrafficSnapshot road_traffic; TransitNetworkSnapshot transit; PassengerQueueSnapshot queues; TransitOperationsSnapshot operations;
    auto operator<=>(const TransportationSnapshot&) const = default;
};
class TransportationAuthority {
public:
    void load_network(const NetworkSnapshot&);
    [[nodiscard]] NetworkStore& network() { return network_; }
    [[nodiscard]] const NetworkStore& network() const { return network_; }
    [[nodiscard]] IntersectionControlStore& controls() { return controls_; }
    [[nodiscard]] const IntersectionControlStore& controls() const { return controls_; }
    [[nodiscard]] ParkingSystem& parking() { return parking_; }
    [[nodiscard]] IncidentSystem& incidents() { return incidents_; }
    [[nodiscard]] TrafficFlowState& traffic() { return traffic_; }
    [[nodiscard]] const TrafficFlowState& traffic() const { return traffic_; }
    [[nodiscard]] RoadTrafficState& road_traffic() { return road_traffic_; }
    [[nodiscard]] const RoadTrafficState& road_traffic() const { return road_traffic_; }
    [[nodiscard]] TransitNetwork& transit() { return transit_; }
    [[nodiscard]] PassengerQueues& queues() { return queues_; }
    [[nodiscard]] TransitOperations& operations() { return operations_; }
    [[nodiscard]] TransportationSnapshot snapshot() const;
    void restore(const TransportationSnapshot&);
    [[nodiscard]] std::uint64_t domain_hash() const;
private:
    NetworkStore network_; IntersectionControlStore controls_; ParkingSystem parking_; IncidentSystem incidents_; TrafficFlowState traffic_; RoadTrafficState road_traffic_; TransitNetwork transit_; PassengerQueues queues_; TransitOperations operations_;
};

} // namespace civic::transport