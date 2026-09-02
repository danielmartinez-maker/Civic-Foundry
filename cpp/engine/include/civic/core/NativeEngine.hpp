#pragma once

#include <cstdint>
#include <memory>
#include <optional>
#include <span>
#include <string>
#include <string_view>

#include <civic/core/Error.hpp>
#include <civic/core/Kernel.hpp>
#include <civic/persistence/SaveV9.hpp>
#include <civic/world/Hydrology.hpp>
#include <civic/world/WorldFoundation.hpp>

namespace civic {

struct EngineConfig final {
    std::uint32_t seed{1};
    std::uint64_t startTick{0};
    SpeedMode speed{SpeedMode::normal};
};

struct SnapshotBlob final { std::string json; };
struct EventBlob final { std::string json; };

enum class DomainOwnership : std::uint32_t { owned = 1, unowned = 2 };
struct DomainHash final {
    DomainOwnership ownership{DomainOwnership::unowned};
    std::uint32_t version{1};
    std::uint64_t value{};
};

class NativeEngine final {
public:
    [[nodiscard]] static Result<std::unique_ptr<NativeEngine>> create(const EngineConfig&);
    [[nodiscard]] Result<void> submit(std::span<const CommandEnvelope>);
    [[nodiscard]] Result<void> step(std::uint64_t ticks);
    [[nodiscard]] Result<SnapshotBlob> snapshot() const;
    [[nodiscard]] Result<EventBlob> drainEvents();
    [[nodiscard]] Result<DomainHash> domainHash(std::string_view domain) const;
    [[nodiscard]] Result<void> loadV9(std::string_view json);
    [[nodiscard]] Result<std::string> saveV9() const;

    [[nodiscard]] Result<SnapshotBlob> createWorld(std::string_view request_json);
    [[nodiscard]] Result<SnapshotBlob> restoreWorld(std::string_view snapshot_json);
    [[nodiscard]] Result<SnapshotBlob> createLegacyWorld(std::string_view request_json);
    [[nodiscard]] Result<SnapshotBlob> runDesignStorm(std::string_view request_json);
    [[nodiscard]] std::uint64_t tick() const noexcept { return clock_.tick(); }

private:
    explicit NativeEngine(const EngineConfig&);
    [[nodiscard]] std::string kernelCanonicalState() const;
    [[nodiscard]] Result<std::string> worldSnapshotJson() const;
    static std::uint64_t fnv1a64(std::string_view bytes) noexcept;

    std::uint32_t seed_{};
    SimulationClock clock_;
    RandomStreamRegistry random_;
    CommandQueue commands_;
    DomainEventJournal events_;
    SystemScheduler scheduler_;
    InvariantRunner invariants_;
    std::optional<SaveV9Dto> loaded_save_;

    std::optional<world::WorldFoundation> world_;
    std::optional<world::FloodResult> last_world_flood_;
    std::string world_mode_{"generated-1r"};
    std::optional<std::string> legacy_compatibility_json_;
};

} // namespace civic
