#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

SHEETS: dict[str, tuple[int, int]] = {
    'terrain': (1024, 64),
    'roads': (2048, 192),
    'buildings': (4096, 2048),
    'construction': (2048, 768),
    'civic': (2048, 768),
    'utilities': (1024, 512),
    'vegetation': (1024, 512),
    'vehicles': (4096, 768),
}
ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets' / 'source'
OUTPUT = ROOT / 'dist' / 'assets' / 'atlases'
DIMENSION_RE = re.compile(r'<svg\b[^>]*\bwidth=["\'](\d+)["\'][^>]*\bheight=["\'](\d+)["\']', re.IGNORECASE)


def check_sources() -> list[str]:
    errors: list[str] = []
    for name, expected in SHEETS.items():
        path = SOURCE / f'{name}.svg'
        if not path.is_file():
            errors.append(f'missing source atlas: {path.relative_to(ROOT)}')
            continue
        text = path.read_text(encoding='utf-8')
        match = DIMENSION_RE.search(text)
        if not match:
            errors.append(f'{path.relative_to(ROOT)} must declare numeric root width and height')
            continue
        actual = (int(match.group(1)), int(match.group(2)))
        if actual != expected:
            errors.append(f'{path.relative_to(ROOT)} dimensions {actual} != expected {expected}')
        if 'http://' in text or 'https://' in text.replace('http://www.w3.org/2000/svg', ''):
            errors.append(f'{path.relative_to(ROOT)} may not reference remote resources')
    return errors


def render() -> None:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise SystemExit('Python Playwright is required for atlas rasterization. Install with: pip install playwright') from exc

    OUTPUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            page = browser.new_page()
            for name, (width, height) in SHEETS.items():
                svg = (SOURCE / f'{name}.svg').read_text(encoding='utf-8')
                page.set_viewport_size({'width': width, 'height': height})
                page.set_content(
                    '<!doctype html><html><head><style>'
                    'html,body{margin:0;padding:0;background:transparent;overflow:hidden}'
                    'svg{display:block}'
                    '</style></head><body>' + svg + '</body></html>',
                    wait_until='load',
                )
                locator = page.locator('svg')
                box = locator.bounding_box()
                if not box or round(box['width']) != width or round(box['height']) != height:
                    raise RuntimeError(f'{name}: rendered SVG dimensions do not match {width}x{height}')
                locator.screenshot(path=str(OUTPUT / f'{name}.png'), omit_background=True)
        finally:
            browser.close()


def main() -> int:
    parser = argparse.ArgumentParser(description='Validate or rasterize Civic Foundry isometric atlas sources.')
    parser.add_argument('--check', action='store_true', help='validate source files without launching Chromium')
    args = parser.parse_args()
    errors = check_sources()
    if errors:
        for error in errors:
            print(f'ERROR: {error}', file=sys.stderr)
        return 1
    if args.check:
        print(f'validated {len(SHEETS)} isometric SVG atlas sources')
        return 0
    render()
    print(f'rendered {len(SHEETS)} PNG atlases to {OUTPUT.relative_to(ROOT)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
