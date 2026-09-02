# ADR — Native Presentation Platform

## Status
Accepted for Stack 4 implementation branch; production cutover remains gated.

## Decision
Windows is the first-class native production platform. Stack 4 uses a narrow Win32 window/input shell and D3D12 backend directly rather than adding SDL3 at this tranche.

The reason is architectural rather than aesthetic: Civic Foundry currently needs one first-class Windows presentation target, high-DPI pointer/keyboard/window lifecycle handling, and D3D12 device/swapchain ownership. A direct Win32 shell keeps the platform dependency surface small while the native simulation branches are still being consolidated. The public presentation boundary remains platform/API-neutral, so SDL3 or another host can be added later without changing simulation authority.

## Boundary
`FrameSnapshot` and other presentation DTOs are the only simulation-facing data accepted by native presentation code. Win32, D3D12, camera, asset, UI, audio, and platform callbacks do not own or mutate simulation facts.

## Cutover gate
This decision does not retire Electron/Pixi/DOM. Final retirement is blocked until all Alpha-authoritative domains are natively owned and save/replay/performance/visual acceptance passes.
