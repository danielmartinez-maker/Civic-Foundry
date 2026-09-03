#pragma once

#include <civic/presentation/Presentation.hpp>

namespace civic::presentation {

class PresentationInvalidationTracker {
public:
    [[nodiscard]] SceneUpdateStats syncRecords(const FrameSnapshot& snapshot) {
        return retained_scene_.apply(snapshot);
    }

    [[nodiscard]] bool syncWorld(WorldSize world) noexcept {
        const bool changed = !world_initialized_ || world.width != world_.width || world.height != world_.height;
        world_ = world;
        world_initialized_ = true;
        return changed;
    }

    [[nodiscard]] bool syncSelection(const SelectionState& selection) {
        const bool changed = !selection_initialized_ || !sameSelection(selection_, selection);
        selection_ = selection;
        selection_initialized_ = true;
        return changed;
    }

    [[nodiscard]] bool syncToolPreview(const ToolPreviewState& preview) {
        const bool changed = !preview_initialized_ || !sameToolPreview(preview_, preview);
        preview_ = preview;
        preview_initialized_ = true;
        return changed;
    }

private:
    static bool sameSelection(const SelectionState& lhs, const SelectionState& rhs) noexcept {
        if (lhs.active != rhs.active) return false;
        return !lhs.active || lhs.entity == rhs.entity;
    }

    static bool sameToolPreview(const ToolPreviewState& lhs, const ToolPreviewState& rhs) {
        return lhs.tool_id == rhs.tool_id &&
            lhs.valid == rhs.valid &&
            lhs.geometry == rhs.geometry &&
            lhs.invalid_reason == rhs.invalid_reason;
    }

    RetainedScene retained_scene_{};
    WorldSize world_{};
    SelectionState selection_{};
    ToolPreviewState preview_{};
    bool world_initialized_{false};
    bool selection_initialized_{false};
    bool preview_initialized_{false};
};

[[nodiscard]] inline bool geometryNeedsRebuild(
    const SceneUpdateStats& records,
    bool world_changed,
    bool selection_changed,
    bool tool_preview_changed) noexcept {
    return records.totalRebuilt() != 0U || world_changed || selection_changed || tool_preview_changed;
}

[[nodiscard]] inline bool pickingNeedsRebuild(
    const SceneUpdateStats& records,
    bool world_changed) noexcept {
    return world_changed ||
        records.parcels_rebuilt != 0U ||
        records.roads_rebuilt != 0U ||
        records.buildings_rebuilt != 0U ||
        records.vehicles_updated != 0U ||
        records.transit_rebuilt != 0U;
}

} // namespace civic::presentation
