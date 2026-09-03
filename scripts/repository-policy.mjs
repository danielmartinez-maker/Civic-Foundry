import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const sourceRoots = ["src", "tests"];
const maxTrackedBinaryBytes = 5 * 1024 * 1024;

const forbiddenTrackedPrefixes = [
  "dist/",
  "target/",
  "node_modules/",
  "coverage/",
  "test-artifacts/",
  ".tmp/",
  ".cache/",
  "playwright-report/",
];

const forbiddenTrackedSegments = ["/__pycache__/", "/.pytest_cache/"];
const allowedTrackedPaths = new Set(["test-artifacts/cpp-parity/.gitkeep"]);
const binaryExtensions = new Set([
  ".bin",
  ".blend",
  ".fbx",
  ".gif",
  ".glb",
  ".gltf",
  ".jpeg",
  ".jpg",
  ".mov",
  ".mp3",
  ".mp4",
  ".obj",
  ".ogg",
  ".png",
  ".wav",
  ".webp",
  ".zip",
]);

function normalizeRepositoryPath(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function inspectRepositoryPathPolicy(path) {
  const display = normalizeRepositoryPath(path);
  const normalized = display.toLowerCase();
  const wrapped = `/${normalized}`;

  if (allowedTrackedPaths.has(normalized)) return [];

  if (
    forbiddenTrackedPrefixes.some((prefix) => normalized.startsWith(prefix)) ||
    forbiddenTrackedSegments.some((segment) => wrapped.includes(segment))
  ) {
    return [`${display}: generated/build output must not be tracked`];
  }

  return [];
}

export function inspectRepositoryFilePolicy(path, sizeBytes) {
  const display = normalizeRepositoryPath(path);
  const extension = extname(display).toLowerCase();

  if (
    binaryExtensions.has(extension) &&
    Number.isFinite(sizeBytes) &&
    sizeBytes > maxTrackedBinaryBytes
  ) {
    return [`${display}: binary file exceeds 5 MiB repository limit`];
  }

  return [];
}

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

async function collectTrackedFiles() {
  const { stdout } = await execFileAsync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  });

  return stdout
    .split("\0")
    .map((path) => normalizeRepositoryPath(path.trim()))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
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

  for (const display of await collectTrackedFiles()) {
    failures.push(...inspectRepositoryPathPolicy(display));

    const metadata = await stat(join(root, display));
    if (metadata.isFile()) {
      failures.push(...inspectRepositoryFilePolicy(display, metadata.size));
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
