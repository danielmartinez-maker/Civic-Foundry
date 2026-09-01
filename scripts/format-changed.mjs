import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import * as prettier from "prettier";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const supportedExtensions = new Set([
  ".cjs",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".ts",
  ".yaml",
  ".yml",
]);

function normalizeRepositoryPath(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function isPrettierManagedPath(path) {
  const normalized = normalizeRepositoryPath(path);
  return supportedExtensions.has(extname(normalized).toLowerCase());
}

async function git(args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    encoding: "utf8",
  });
  return stdout.trim();
}

async function resolveComparisonBase() {
  const githubBase = process.env.GITHUB_BASE_REF?.trim();
  if (githubBase) {
    return git(["merge-base", "HEAD", `origin/${githubBase}`]);
  }

  const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === "main" || branch === "master") return "HEAD";

  for (const candidate of ["main", "origin/main", "master", "origin/master"]) {
    try {
      return await git(["merge-base", "HEAD", candidate]);
    } catch {
      // Try the next conventional default branch reference.
    }
  }

  try {
    return await git(["rev-parse", "HEAD^"]);
  } catch {
    return "HEAD";
  }
}

function parsePathList(output) {
  return output
    .split(/\r?\n/)
    .map((path) => normalizeRepositoryPath(path.trim()))
    .filter(Boolean);
}

async function collectCandidatePaths() {
  const base = await resolveComparisonBase();
  const outputs = await Promise.all([
    git(["diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`]),
    git(["diff", "--name-only", "--diff-filter=ACMR"]),
    git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]),
    git(["ls-files", "--others", "--exclude-standard"]),
  ]);

  return [...new Set(outputs.flatMap(parsePathList))]
    .filter(isPrettierManagedPath)
    .sort((left, right) => left.localeCompare(right));
}

export async function runChangedFileFormatting({ write = false } = {}) {
  const candidates = await collectCandidatePaths();
  const failures = [];
  let checked = 0;

  for (const display of candidates) {
    const absolutePath = join(root, display);
    const fileInfo = await prettier.getFileInfo(absolutePath, {
      ignorePath: join(root, ".prettierignore"),
    });
    if (fileInfo.ignored || fileInfo.inferredParser === null) continue;

    const source = await readFile(absolutePath, "utf8");
    const options = { filepath: absolutePath };
    checked += 1;

    if (write) {
      const formatted = await prettier.format(source, options);
      if (formatted !== source) await writeFile(absolutePath, formatted, "utf8");
      continue;
    }

    if (!(await prettier.check(source, options))) failures.push(display);
  }

  if (write) {
    console.log(`Formatted ${checked} changed managed file(s).`);
    return;
  }

  if (failures.length > 0) {
    console.error(
      `Formatting check failed for ${failures.length} changed managed file(s):`,
    );
    for (const failure of failures) console.error(`- ${failure}`);
    console.error("Run `npm run format` and commit the resulting changes.");
    process.exitCode = 1;
    return;
  }

  console.log(`Formatting check passed for ${checked} changed managed file(s).`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await runChangedFileFormatting({ write: process.argv.includes("--write") });
}
