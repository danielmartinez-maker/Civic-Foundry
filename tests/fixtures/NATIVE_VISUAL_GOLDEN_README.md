# Stack 4 Native Visual Golden Baseline

This fixture is the deterministic raster baseline for the ten native Stack 4 visual acceptance scenarios emitted by `civic_visual_reference_capture`.

- Source baseline commit: `d0a2413afb534e5360d7563cff9773ac9c05b0bc`
- Accepted workflow run: `33667627970`
- Raster size: `80x45` pixels per scenario
- CairoSVG: `2.8.2`
- Pillow: `12.3.0`
- Per-channel tolerance: `8`
- Maximum changed-pixel ratio: `0.005` (0.5%)

The committed JSON stores base64-encoded PNG rasters rather than browser screenshots. CI regenerates the native SVG references from the current C++ presentation code, rasterizes them with the pinned versions above, and compares every pixel against this baseline.

A visual change must not be accepted by widening the tolerance until it passes. Review the generated actual/expected/diff artifacts first. Update the golden baseline only when the rendering change is intentional and the native visual acceptance scenarios have been reviewed.
