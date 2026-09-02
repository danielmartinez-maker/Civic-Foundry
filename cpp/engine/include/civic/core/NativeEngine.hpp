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
#include <civic/persistence/TransportationSaveV9.hpp>
#include <civic/socioeconomic/SocioeconomicAuthority.hpp>
#include <civic/transport/transport_engine.hpp>

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
    [[nodiscard]] const transport::TransportationAuthority& transportation() const noexcept { return transportation_; }
    [[nodiscard]] const socioeconomic::SocioeconomicAuthority& socioeconomic() const noexcept { return socioeconomic_; }
    [[nodiscard]] std::uint64_t tick() const noexcept { return clock_.tick(); }
private:
    explicit NativeEngine(const EngineConfig&);
    [[nodiscard]] Result<void> applySocioeconomicBridgeCommand(const CommandEnvelope& command);
    [[nodiscard]] std::string kernelCanonicalState() const;
    [[nodiscard]] std::uint64_t transportationDomainHash() const;
    [[nodiscard]] std::uint64_t socioeconomicDomainHash(socioeconomic::SocioeconomicDomainGate gate) const;
    [[nodiscard]] bool economyFullyNative() const noexcept;
    [[nodiscard]] bool populationFullyNative() const noexcept;
    static std::uint64_t fnv1a64(std::string_view bytes) noexcept;

    std::uint32_t seed_{};
    SimulationClock clock_;
    RandomStreamRegistry random_;
    CommandQueue commands_;
    DomainEventJournal events_;
    SystemScheduler scheduler_;
    InvariantRunner invariants_;
    transport::TransportationAuthority transportation_;
    TransportationContinuationV9 transportation_continuation_;
    socioeconomic::SocioeconomicAuthority socioeconomic_;
    std::optional<SaveV9Dto> loaded_save_;
};

} // namespace civic
