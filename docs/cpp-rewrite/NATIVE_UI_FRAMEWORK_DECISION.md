# Native UI Framework Decision

Status: **Stack 4 Task 16 implementation decision**

## Decision

Civic Foundry's native Windows client uses a retained/immediate hybrid UI:

- **Retained Civic presentation model:** `NativeUiRuntimeModel` owns panel identity, visibility, lifecycle and per-frame presentation metadata.
- **Immediate rendering/input layer:** Dear ImGui docking branch through the vcpkg `imgui` port.
- **Text rasterization:** FreeType-enabled ImGui build.
- **Platform backend:** ImGui Win32 backend.
- **Renderer backend:** ImGui D3D12 backend.
- **Simulation boundary:** UI reads immutable snapshots/query models and submits typed commands through Civic Foundry command interfaces. It never owns authoritative simulation facts.

The ImGui dependency is Windows-only. Simulation and presentation-model libraries remain usable without an ImGui dependency on non-Windows builds.

## Evaluation

| Requirement | Decision / evidence |
| --- | --- |
| Text quality | FreeType is enabled in the vcpkg ImGui feature set. Text remains presentation-only. |
| Accessibility | Keyboard navigation is enabled. Task 20 owns the full accessibility pass, including severity/contrast and settings completion. |
| DPI scaling | `Win32NativeUi` reads per-window DPI and combines it with normalized `PresentationSettings::ui_scale`. |
| Input | Raw Win32 messages are forwarded to the ImGui platform backend; Civic Foundry keeps its own typed platform-event path for game input. UI capture is exposed separately. |
| Docking / panels | ImGui docking is enabled; stable Civic panel IDs and open/closed state live in `NativeUiRuntimeModel`. |
| Data visualization | Task 19 will render historical/causality views from snapshot/query DTOs using ImGui drawing primitives. A second chart dependency is not justified until those requirements demonstrate a gap. |
| Lifecycle | Context, backend state and D3D12 descriptor resources use RAII and explicit runtime initialization/frame/shutdown contracts. |
| Authority isolation | `NativeUiController` remains the mutation boundary. No renderer, widget or Win32 callback receives a simulation-owner pointer. |

## Ownership Rules

The target flow is:

```text
immutable native snapshot / query DTO
        |
        v
NativeUiRuntimeModel
        |
        v
Win32NativeUi / ImGui
        |
        +---- read-only presentation
        |
        +---- user intent ----> typed Civic command ----> authoritative runtime
```

Forbidden patterns:

- storing authoritative entity objects inside UI panels;
- mutating simulation state from ImGui callbacks;
- using widget lifetime as simulation lifetime;
- serializing ImGui/C++ object layout into city saves;
- making UI container order authoritative;
- routing native UI through Node/Electron in the shipping client.

## Deferred to Later Stack 4 Tasks

Task 16 establishes the framework and lifecycle only. The following remain separately gated:

- Task 17: HUD, core tools, notifications and shortcut routing;
- Task 18: inspectors and management panels;
- Task 19: historical charts and causality / “Why?” views;
- Task 20: full accessibility settings and smoke coverage;
- Task 21: complete machine/user settings persistence including keybinds.

This decision does not transfer simulation authority and does not change Save V9 semantics.
