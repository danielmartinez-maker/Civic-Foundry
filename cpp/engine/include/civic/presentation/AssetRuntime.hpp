#pragma once

#include <cstddef>
#include <cstdint>
#include <expected>
#include <span>
#include <string>
#include <vector>

namespace civic::presentation {

struct GlbAsset {
    std::string source_name;
    std::size_t primitive_count{};
    std::size_t material_count{};
    std::size_t texture_count{};
    std::vector<std::byte> binary_chunk;
    std::string json_chunk;
    bool diagnostic_placeholder{false};
    std::string diagnostic_message;
};

class GlbLoader {
public:
    [[nodiscard]] std::expected<GlbAsset, std::string> load(std::span<const std::byte> bytes, std::string source_name) const;
    [[nodiscard]] GlbAsset loadOrPlaceholder(std::span<const std::byte> bytes, std::string source_name) const;
};

} // namespace civic::presentation
