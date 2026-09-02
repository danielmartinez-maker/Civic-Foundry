#include <civic/persistence/TransportationSaveV9.hpp>

#include <charconv>
#include <optional>
#include <string>
#include <string_view>
#include <utility>

namespace civic {
namespace {

std::optional<std::pair<int, int>> parseLegacyNodeCoordinates(std::string_view value) {
    const auto comma = value.find(',');
    if (comma == std::string_view::npos || comma == 0 || comma + 1 >= value.size()) return std::nullopt;
    if (value.find(',', comma + 1) != std::string_view::npos) return std::nullopt;

    int x{};
    int y{};
    const auto xText = value.substr(0, comma);
    const auto yText = value.substr(comma + 1);
    const auto [xEnd, xError] = std::from_chars(xText.data(), xText.data() + xText.size(), x);
    const auto [yEnd, yError] = std::from_chars(yText.data(), yText.data() + yText.size(), y);
    if (xError != std::errc{} || yError != std::errc{}) return std::nullopt;
    if (xEnd != xText.data() + xText.size() || yEnd != yText.data() + yText.size()) return std::nullopt;
    return std::pair{x, y};
}

std::string legacyNodeId(int x, int y) {
    return "j:legacy:" + std::to_string(x) + ',' + std::to_string(y);
}

std::string canonicalLegacyEdgeId(int fromX, int fromY, int toX, int toY) {
    return "e:n:" + std::to_string(fromX) + ',' + std::to_string(fromY) + ">n:" +
           std::to_string(toX) + ',' + std::to_string(toY);
}

} // namespace

Result<transport::CarriagewayId> resolveLegacyEdgeV9(
    const transport::NetworkSnapshot& network,
    std::string_view legacyEdgeId) {
    constexpr std::string_view prefix{"e:n:"};
    constexpr std::string_view separator{">n:"};
    if (!legacyEdgeId.starts_with(prefix)) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid legacy transportation edge id"));
    }

    const auto separatorOffset = legacyEdgeId.find(separator, prefix.size());
    if (separatorOffset == std::string_view::npos ||
        legacyEdgeId.find(separator, separatorOffset + separator.size()) != std::string_view::npos) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid legacy transportation edge id"));
    }

    const auto from = parseLegacyNodeCoordinates(
        legacyEdgeId.substr(prefix.size(), separatorOffset - prefix.size()));
    const auto to = parseLegacyNodeCoordinates(
        legacyEdgeId.substr(separatorOffset + separator.size()));
    if (!from || !to || canonicalLegacyEdgeId(from->first, from->second, to->first, to->second) != legacyEdgeId) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid legacy transportation edge id"));
    }

    const transport::JunctionId fromId{legacyNodeId(from->first, from->second)};
    const transport::JunctionId toId{legacyNodeId(to->first, to->second)};
    const transport::Carriageway* match = nullptr;
    for (const auto& carriageway : network.carriageways) {
        if (carriageway.from_junction_id != fromId || carriageway.to_junction_id != toId) continue;
        if (match != nullptr) {
            return std::unexpected(make_error(
                ErrorCode::serialization_failure,
                "legacy transportation edge maps to multiple native carriageways: " + std::string{legacyEdgeId}));
        }
        match = &carriageway;
    }
    if (match == nullptr) {
        return std::unexpected(make_error(
            ErrorCode::serialization_failure,
            "legacy transportation edge has no native carriageway: " + std::string{legacyEdgeId}));
    }
    return match->id;
}

} // namespace civic
