import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sourceRoots = ["src", "tests"];

export function inspectSourcePolicy(display, source) {
  const failures = [];
  const lines = source.split("\n");

  lines.forEach((line, index) => {
    if (/[ \t]+$/.test(line))
      failures.push(`${display}:${index + 1}: trailing whitespace`);
    if (line.includes("\t"))
      failures.push(`${display}:${index + 1}: tab indentation`);
  });

  if (/\bdebugger\s*;/.test(source))
    failures.push(`${display}: debugger statement`);
  if (/\beval\s*\(/.test(source))
    failures.push(`${display}: eval is prohibited`);
  if (/\bnew\s+Function\s*\(/.test(source)) {
    failures.push(`${display}: Function constructor is prohibited`);
  }

  const rawUserInterpolation = /\$\{\s*(?:line\.name|inspection\.title)\s*\}/;
  if (display === "src/app/GameApp.ts" && rawUserInterpolation.test(source)) {
    failures.push(
      `${display}: user-controlled text must be escaped before HTML interpolation`,
    );
  }

  return failures;
}

async function collectTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory())
      files.push(...(await collectTypeScriptFiles(path)));
    else if (extname(entry.name) === ".ts") files.push(path);
  }

  return files;
}

export async function runRepositoryPolicy() {
  const failures = [];

  for (const sourceRoot of sourceRoots) {
    for (const path of await collectTypeScriptFiles(join(root, sourceRoot))) {
      const source = await readFile(path, "utf8");
      const display = relative(root, path).replaceAll("\\", "/");
      failures.push(...inspectSourcePolicy(display, source));
    }
  }

  if (failures.length > 0) {
    console.error(`Repository policy failed with ${failures.length} issue(s):`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log("Repository policy passed.");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await runRepositoryPolicy();
}
