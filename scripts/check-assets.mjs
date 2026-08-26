import { execFile } from 'node:child_process';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const forbiddenExtensions = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.wav',
  '.mp3',
  '.ogg',
  '.flac',
  '.mp4',
  '.mov',
  '.fbx',
  '.glb',
  '.gltf',
  '.blend',
  '.obj',
]);

function normalize(path) {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

export function isForbiddenAssetPath(path) {
  const normalized = normalize(path).toLowerCase();
  if (!normalized.startsWith('assets/')) return false;
  return forbiddenExtensions.has(extname(normalized));
}

export async function runAssetPolicyCheck() {
  const { stdout } = await execFileAsync('git', ['ls-files'], { encoding: 'utf8' });
  const tracked = stdout
    .split(/\r?\n/)
    .map((path) => path.trim())
    .filter(Boolean);
  const failures = tracked.filter(isForbiddenAssetPath);

  if (failures.length > 0) {
    console.error(`Asset policy failed with ${failures.length} forbidden tracked file(s):`);
    for (const path of failures) console.error(`- ${path}`);
    console.error('Generated runtime assets belong in dist/. Approved large binary sources require Git LFS and architectural review.');
    process.exitCode = 1;
    return;
  }

  console.log('Asset repository policy passed.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runAssetPolicyCheck();
}
