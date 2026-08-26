import assert from 'node:assert/strict';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { prepareDist } from '../scripts/build.mjs';

test('prepareDist removes stale output and recreates an empty dist directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'civic-foundry-build-'));
  const dist = join(root, 'dist');
  await writeFile(join(root, 'stale.txt'), 'outside dist');
  await prepareDist(root);
  await writeFile(join(dist, 'stale.txt'), 'stale build');

  await prepareDist(root);

  assert.deepEqual(await readdir(dist), []);
});
