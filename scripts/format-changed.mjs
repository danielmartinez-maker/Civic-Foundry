import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import * as prettier from "prettier";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const formattingArtifactRoot = join(root, "test-artifacts", "format-expected");
const managedExtensions = new Set([
  ".cjs",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".ts",
  ".yaml",
  ".yml",
]);
const prettierExtensions = new Set([
  ".cjs",
  ".js",
  ".json",
  ".mjs",
  ".ts",
  ".yaml",
  ".yml",
]);

function normalizeRepositoryPath(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function isFormattingManagedPath(path) {
  const normalized = normalizeRepositoryPath(path);
  return managedExtensions.has(extname(normalized).toLowerCase());
}

export function normalizeMarkdown(source) {
  const normalizedLineEndings = source.replace(/\r\n?/gu, "\n");
  return `${normalizedLineEndings.replace(/\n*$/u, "")}\n`;
}

export function classifyFormattingState({
  source,
  formatted,
  baseSource,
  baseFormatted,
}) {
  if (source === formatted) return "clean";
  if (
    baseSource !== null &&
    baseFormatted !== null &&
    baseSource !== baseFormatted
  ) {
    return "grandfathered";
  }
  return "failure";
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
  if (branch === "main" || branch === "master") {
    try {
      return await git(["rev-parse", "HEAD^"]);
    } catch {
      return "HEAD";
    }
  }

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

  const candidates = [...new Set(outputs.flatMap(parsePathList))]
    .filter(isFormattingManagedPath)
    .sort((left, right) => left.localeCompare(right));

  return { base, candidates };
}

async function readBaseSource(base, display) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["show", `${base}:${display}`],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
    return stdout;
  } catch {
    return null;
  }
}

async function formatManagedSource(absolutePath, source) {
  const extension = extname(absolutePath).toLowerCase();
  if (extension === ".md") return normalizeMarkdown(source);
  if (!prettierExtensions.has(extension)) return source;
  return prettier.format(source, { filepath: absolutePath });
}

async function preserveExpectedFormatting(display, formatted) {
  const target = join(formattingArtifactRoot, display);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, formatted, "utf8");
}

export async function runChangedFileFormatting({ write = false } = {}) {
  const { base, candidates } = await collectCandidatePaths();
  const failures = [];
  const grandfathered = [];
  let checked = 0;

  for (const display of candidates) {
    const absolutePath = join(root, display);
    const extension = extname(display).toLowerCase();

    if (prettierExtensions.has(extension)) {
      const fileInfo = await prettier.getFileInfo(absolutePath, {
        ignorePath: join(root, ".prettierignore"),
      });
      if (fileInfo.ignored || fileInfo.inferredParser === null) continue;
    }

    const source = await readFile(absolutePath, "utf8");
    const formatted = await formatManagedSource(absolutePath, source);
    checked += 1;

    if (write) {
      if (formatted !== source)
        await writeFile(absolutePath, formatted, "utf8");
      continue;
    }

    if (formatted === source) continue;

    const baseSource = await readBaseSource(base, display);
    const baseFormatted =
      baseSource === null
        ? null
        : await formatManagedSource(absolutePath, baseSource);
    const state = classifyFormattingState({
      source,
      formatted,
      baseSource,
      baseFormatted,
    });

    if (state === "grandfathered") grandfathered.push(display);
    else if (state === "failure") {
      failures.push(display);
      await preserveExpectedFormatting(display, formatted);
    }
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
    console.error(
      "Exact expected copies are available under test-artifacts/format-expected/.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `Formatting check passed for ${checked} changed managed file(s).`,
  );
  if (grandfathered.length > 0) {
    console.log(
      `${grandfathered.length} changed file(s) remain grandfathered legacy formatting debt:`,
    );
    for (const display of grandfathered) console.log(`- ${display}`);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await runChangedFileFormatting({ write: process.argv.includes("--write") });
}
