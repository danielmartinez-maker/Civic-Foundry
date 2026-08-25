import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function TypeScriptFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...TypeScriptFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(path);
  }
  return files.sort();
}

test('rendering sources remain compatible with Node strip-types execution', () => {
  const offenders = TypeScriptFiles('src/rendering').filter((path) => {
    const source = readFileSync(path, 'utf8');
    return /constructor\s*\([^)]*\b(?:private|protected|public)\b[^)]*\)/s.test(source);
  });

  assert.deepEqual(
    offenders,
    [],
    'Node --experimental-strip-types cannot execute TypeScript constructor parameter properties',
  );
});
