from __future__ import annotations

import argparse
import base64
import io
import json
import pathlib
import re
from typing import NamedTuple

import cairosvg
from PIL import Image, ImageChops

_RGB_SPACE = re.compile(r"rgb\((\d+)\s+(\d+)\s+(\d+)\)")


class VisualDiff(NamedTuple):
    passed: bool
    changed_pixels: int
    total_pixels: int
    changed_ratio: float
    max_channel_delta: int


def compare_images(
    actual: Image.Image,
    expected: Image.Image,
    *,
    channel_tolerance: int,
    max_changed_ratio: float,
) -> VisualDiff:
    actual = actual.convert("RGBA")
    expected = expected.convert("RGBA")
    if actual.size != expected.size:
        raise ValueError(f"image size mismatch: actual={actual.size} expected={expected.size}")
    if channel_tolerance < 0 or channel_tolerance > 255:
        raise ValueError("channel_tolerance must be between 0 and 255")
    if not 0.0 <= max_changed_ratio <= 1.0:
        raise ValueError("max_changed_ratio must be between 0 and 1")

    changed = 0
    max_delta = 0
    for actual_px, expected_px in zip(
        actual.get_flattened_data(), expected.get_flattened_data(), strict=True
    ):
        delta = max(abs(a - b) for a, b in zip(actual_px, expected_px, strict=True))
        max_delta = max(max_delta, delta)
        if delta > channel_tolerance:
            changed += 1

    total = actual.size[0] * actual.size[1]
    ratio = changed / total if total else 0.0
    return VisualDiff(
        passed=ratio <= max_changed_ratio,
        changed_pixels=changed,
        total_pixels=total,
        changed_ratio=ratio,
        max_channel_delta=max_delta,
    )


def sanitize_svg(svg: str) -> str:
    # Native SVG output intentionally uses modern CSS rgb(R G B) syntax.
    # CairoSVG 2.8.2 requires comma-separated rgb() values.
    return _RGB_SPACE.sub(r"rgb(\1,\2,\3)", svg)


def rasterize_svg(path: pathlib.Path, *, width: int, height: int) -> Image.Image:
    svg = sanitize_svg(path.read_text(encoding="utf-8"))
    png = cairosvg.svg2png(
        bytestring=svg.encode("utf-8"),
        output_width=width,
        output_height=height,
    )
    return Image.open(io.BytesIO(png)).convert("RGBA")


def decode_golden(encoded: str) -> Image.Image:
    raw = base64.b64decode(encoded, validate=True)
    return Image.open(io.BytesIO(raw)).convert("RGBA")


def load_manifest(path: pathlib.Path) -> tuple[dict[str, object], dict[str, str]]:
    document = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ValueError("golden manifest root must be an object")
    metadata = document.get("metadata", {})
    images = document.get("images")
    if not isinstance(metadata, dict) or not isinstance(images, dict) or not images:
        raise ValueError("golden manifest must contain metadata and non-empty images objects")
    if not all(isinstance(key, str) and isinstance(value, str) for key, value in images.items()):
        raise ValueError("golden manifest images must map scenario ids to base64 PNG strings")
    return metadata, images


def write_diff_image(actual: Image.Image, expected: Image.Image, path: pathlib.Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    diff = ImageChops.difference(actual.convert("RGBA"), expected.convert("RGBA"))
    diff = diff.point(lambda value: min(255, value * 4))
    diff.save(path)


def run(args: argparse.Namespace) -> int:
    actual_dir = pathlib.Path(args.actual_dir)
    manifest_path = pathlib.Path(args.golden_manifest)
    diff_dir = pathlib.Path(args.diff_dir) if args.diff_dir else None
    metadata, images = load_manifest(manifest_path)

    expected_names = set(images)
    actual_names = {path.stem for path in actual_dir.glob("*.svg")}
    reports: dict[str, object] = {"metadata": metadata}
    failed = False

    missing = sorted(expected_names - actual_names)
    extra = sorted(actual_names - expected_names)
    if missing or extra:
        failed = True
        reports["inventory"] = {"missing": missing, "extra": extra, "passed": False}

    scenarios: dict[str, object] = {}
    for scenario in sorted(expected_names):
        svg_path = actual_dir / f"{scenario}.svg"
        if not svg_path.is_file():
            continue
        actual = rasterize_svg(svg_path, width=args.width, height=args.height)
        expected = decode_golden(images[scenario])
        result = compare_images(
            actual,
            expected,
            channel_tolerance=args.channel_tolerance,
            max_changed_ratio=args.max_changed_ratio,
        )
        scenarios[scenario] = result._asdict()
        failed = failed or not result.passed
        if not result.passed and diff_dir is not None:
            diff_dir.mkdir(parents=True, exist_ok=True)
            actual.save(diff_dir / f"{scenario}.actual.png")
            expected.save(diff_dir / f"{scenario}.expected.png")
            write_diff_image(actual, expected, diff_dir / f"{scenario}.diff.png")
    reports["scenarios"] = scenarios

    print(json.dumps(reports, sort_keys=True, indent=2))
    return 1 if failed else 0


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(
        description="Compare Civic Foundry native SVG visual references against committed golden rasters."
    )
    command.add_argument("--actual-dir", required=True)
    command.add_argument("--golden-manifest", required=True)
    command.add_argument("--diff-dir")
    command.add_argument("--width", type=int, default=80)
    command.add_argument("--height", type=int, default=45)
    command.add_argument("--channel-tolerance", type=int, default=8)
    command.add_argument("--max-changed-ratio", type=float, default=0.005)
    return command


if __name__ == "__main__":
    raise SystemExit(run(parser().parse_args()))
