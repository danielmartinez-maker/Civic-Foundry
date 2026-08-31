import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  resolvePresentationBackend,
  type PresentationBackend,
} from '../src/rendering/PresentationRendererFactory.ts';

const text = (path: string): Promise<string> =>
  readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('presentation backend defaults to legacy gpu and recognizes explicit civic-3d', () => {
  const cases: readonly [string, PresentationBackend][] = [
    ['', 'legacy-gpu'],
    ['?renderer=legacy-gpu', 'legacy-gpu'],
    ['?renderer=civic-3d', 'civic-3d'],
    ['?renderer=unknown', 'legacy-gpu'],
    ['?foo=bar&renderer=civic-3d', 'civic-3d'],
  ];

  for (const [search, expected] of cases) {
    assert.equal(resolvePresentationBackend(search), expected, search);
  }
});

test('GameApp selects the shared renderer through the backend factory without changing the legacy default', async () => {
  const source = await text('src/app/GameApp.ts');
  assert.match(source, /PresentationRendererFactory\.ts/);
  assert.match(source, /resolvePresentationBackend\(window\.location\.search\)/);
  assert.match(source, /createPresentationRenderer\(canvas, backend\)/);
  assert.doesNotMatch(source, /new GpuWorldRenderer\(canvas\)/);
});

test('GameApp leaves renderer-owned orbit pan and wheel gestures to the civic-3d backend', async () => {
  const source = await text('src/app/GameApp.ts');
  assert.match(source, /if \(this\.renderer\.cameraInputOwner !== 'app'\) return;/);
  assert.match(source, /if \(this\.renderer\.cameraInputOwner === 'app'\) \{[\s\S]*event\.button === 1 \|\| event\.button === 2/);
  assert.match(source, /if \(key === 'q'\) this\.renderer\.rotate\(-1\)/);
  assert.match(source, /if \(key === 'e'\) this\.renderer\.rotate\(1\)/);
});
