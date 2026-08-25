import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const roots = ['src', 'tests'];
const failures = [];

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(path));
    else if (extname(entry.name) === '.ts') files.push(path);
  }
  return files;
}

for (const sourceRoot of roots) {
  for (const path of await collect(join(root, sourceRoot))) {
    const source = await readFile(path, 'utf8');
    const display = relative(root, path).replaceAll('\\', '/');
    const lines = source.split('\n');
    lines.forEach((line, index) => {
      if (/[ \t]+$/.test(line)) failures.push(`${display}:${index + 1}: trailing whitespace`);
      if (line.includes('\t')) failures.push(`${display}:${index + 1}: tab indentation`);
    });
    if (/\bdebugger\s*;/.test(source)) failures.push(`${display}: debugger statement`);
    if (/\beval\s*\(/.test(source)) failures.push(`${display}: eval is prohibited`);
    if (/\bnew\s+Function\s*\(/.test(source)) failures.push(`${display}: Function constructor is prohibited`);
    const rawUserInterpolation = /\$\{\s*(?:line\.name|inspection\.title)\s*\}/;
    if (rawUserInterpolation.test(source)) failures.push(`${display}: user-controlled text must be escaped before HTML interpolation`);
  }
}

if (failures.length > 0) {
  console.error(`Lint failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('Lint passed.');
}
