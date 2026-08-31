import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = async (): Promise<string> =>
  await readFile(new URL('../src/rendering/3d/Civic3DWorldRenderer.ts', import.meta.url), 'utf8');

test('Civic3DWorldRenderer initializes the retained building runtime on the Babylon scene', async () => {
  const text = await source();
  assert.match(text, /import \{ Civic3DBuildingRuntime \} from '\.\/scene\/Civic3DBuildingRuntime\.ts';/);
  assert.match(text, /private buildingRuntime: Civic3DBuildingRuntime \| null = null;/);
  assert.match(
    text,
    /this\.buildingRuntime\s*=\s*await Civic3DBuildingRuntime\.create\(scene,\s*\{[\s\S]*onDiagnostic:[\s\S]*\}\);/,
  );
});

test('Civic3DWorldRenderer draw submits immutable snapshots with the live Babylon camera position without awaiting', async () => {
  const text = await source();
  assert.match(
    text,
    /this\.buildingRuntime\?\.submit\(this\.lastSnapshot,\s*Object\.freeze\(\{\s*x:\s*this\.camera\.position\.x,\s*y:\s*this\.camera\.position\.y,\s*z:\s*this\.camera\.position\.z,\s*\}\)\);/s,
  );
  assert.doesNotMatch(text, /await\s+this\.buildingRuntime\?\.submit/);
});

test('Civic3DWorldRenderer exposes live retained-scene diagnostics instead of placeholder zeroes', async () => {
  const text = await source();
  assert.match(text, /const runtime = this\.buildingRuntime\?\.diagnostics\(\);/);
  assert.match(text, /loadedPrototypes:\s*runtime\?\.loadedPrototypes\s*\?\?\s*0/);
  assert.match(text, /buildingInstances:\s*runtime\?\.buildingInstances\s*\?\?\s*0/);
  assert.match(text, /fallbackBuildings:\s*runtime\?\.fallbackBuildings\s*\?\?\s*\(this\.lastSnapshot\?\.buildings\.length\s*\?\?\s*0\)/);
  assert.match(text, /assetRequests:\s*runtime\?\.assetRequests\s*\?\?\s*0/);
  assert.match(text, /cacheHits:\s*runtime\?\.cacheHits\s*\?\?\s*0/);
  assert.match(text, /cacheMisses:\s*runtime\?\.cacheMisses\s*\?\?\s*0/);
});

test('Civic3DWorldRenderer shutdown awaits retained resource disposal before destroying the Babylon scene', async () => {
  const text = await source();
  assert.match(text, /private disposePromise: Promise<void> \| null = null;/);
  assert.match(text, /dispose\(\): void \{[\s\S]*this\.disposePromise\s*=\s*this\.disposeInternal\(\);/);
  assert.match(text, /async whenDisposed\(\): Promise<void> \{[\s\S]*await this\.disposePromise;/);
  assert.match(
    text,
    /private async disposeInternal\(\): Promise<void> \{[\s\S]*await this\.buildingRuntime\?\.dispose\(\);[\s\S]*this\.scene\?\.dispose\(\);/,
  );
});
