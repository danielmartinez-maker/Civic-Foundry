import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import process from "node:process";

const BASELINE_PATH = "docs/cpp/TS_REWRITE_INVENTORY_BASELINE.txt";

function normalizePaths(paths) {
  return [...paths].sort();
}

function parseBaseline(text) {
  if (!text.endsWith("\n")) {
    throw new Error(`${BASELINE_PATH} must end with LF`);
  }

  const paths = text.slice(0, -1).split("\n");

  if (paths.some((path) => path.length === 0)) {
    throw new Error(`${BASELINE_PATH} contains blank lines`);
  }

  const sorted = normalizePaths(paths);
  if (JSON.stringify(paths) !== JSON.stringify(sorted)) {
    throw new Error(`${BASELINE_PATH} must remain lexicographically sorted`);
  }

  if (new Set(paths).size !== paths.length) {
    throw new Error(`${BASELINE_PATH} contains duplicate paths`);
  }

  return paths;
}

export function evaluateInventory({ baseline, current }) {
  const baselineSorted = normalizePaths(baseline);
  const currentSorted = normalizePaths(current);
  const baselineSet = new Set(baselineSorted);

  const newPaths = currentSorted.filter((path) => !baselineSet.has(path));
  const countIncreased = currentSorted.length > baselineSorted.length;
  const removedCount = baselineSorted.length - currentSorted.length;

  return {
    ok: !countIncreased && newPaths.length === 0,
    baselineCount: baselineSorted.length,
    currentCount: currentSorted.length,
    removedCount,
    countIncreased,
    newPaths,
  };
}

function currentTrackedTypeScriptPaths() {
  const output = execFileSync("git", ["ls-files", "*.ts", "*.tsx", "*.d.ts"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });

  const trimmed = output.trim();
  if (trimmed.length === 0) return [];

  return normalizePaths(trimmed.split(/\r?\n/));
}

async function main() {
  const baselineText = await readFile(BASELINE_PATH, "utf8");
  const baseline = parseBaseline(baselineText);
  const current = currentTrackedTypeScriptPaths();
  const result = evaluateInventory({ baseline, current });

  if (!result.ok) {
    console.error("TypeScript rewrite monotonicity guard FAILED.");
    console.error(`Baseline tracked TypeScript files: ${result.baselineCount}`);
    console.error(`Current tracked TypeScript files:  ${result.currentCount}`);

    if (result.countIncreased) {
      console.error("The tracked TypeScript count increased.");
    }

    if (result.newPaths.length > 0) {
      console.error("New TypeScript-family paths are forbidden:");
      for (const path of result.newPaths) {
        console.error(`  + ${path}`);
      }
    }

    process.exitCode = 1;
    return;
  }

  console.log("TypeScript rewrite monotonicity guard passed.");
  console.log(`Baseline: ${result.baselineCount}`);
  console.log(`Current:  ${result.currentCount}`);
  console.log(`Removed:  ${result.removedCount}`);

  if (result.currentCount === 0) {
    console.log("Final zero-TypeScript target reached.");
  }
}

const isCli =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isCli) {
  await main();
}
