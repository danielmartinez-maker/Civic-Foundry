import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const rules = [
  {
    importer: "src/simulation/",
    forbidden: "src/app/",
    rule: "simulation-no-app",
  },
  {
    importer: "src/simulation/",
    forbidden: "src/ui/",
    rule: "simulation-no-ui",
  },
  {
    importer: "src/simulation/",
    forbidden: "src/rendering/",
    rule: "simulation-no-rendering",
  },
  { importer: "src/world/", forbidden: "src/app/", rule: "world-no-app" },
  { importer: "src/world/", forbidden: "src/ui/", rule: "world-no-ui" },
  {
    importer: "src/world/",
    forbidden: "src/rendering/",
    rule: "world-no-rendering",
  },
  { importer: "src/save/", forbidden: "src/app/", rule: "save-no-app" },
  { importer: "src/save/", forbidden: "src/ui/", rule: "save-no-ui" },
  { importer: "src/data/", forbidden: "src/app/", rule: "data-no-app" },
  { importer: "src/data/", forbidden: "src/ui/", rule: "data-no-ui" },
  {
    importer: "src/rendering/",
    forbidden: "src/app/",
    rule: "rendering-no-app",
  },
  { importer: "src/rendering/", forbidden: "src/ui/", rule: "rendering-no-ui" },
];

function normalize(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function checkArchitectureImport(importer, imported) {
  const normalizedImporter = normalize(importer);
  const normalizedImported = normalize(imported);

  for (const boundary of rules) {
    if (
      normalizedImporter.startsWith(boundary.importer) &&
      normalizedImported.startsWith(boundary.forbidden)
    ) {
      return {
        rule: boundary.rule,
        importer: normalizedImporter,
        imported: normalizedImported,
      };
    }
  }

  return null;
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

function extractModuleSpecifiers(source) {
  const specifiers = [];
  const staticPattern =
    /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicPattern = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (const pattern of [staticPattern, dynamicPattern]) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      if (match[1]) specifiers.push(match[1]);
    }
  }

  return specifiers;
}

function resolveRelativeImport(importerAbsolute, specifier) {
  if (!specifier.startsWith(".")) return null;
  const target = resolve(dirname(importerAbsolute), specifier);
  return normalize(relative(root, target));
}

export async function runArchitectureCheck() {
  const failures = [];
  const files = await collectTypeScriptFiles(join(root, "src"));

  for (const absolutePath of files) {
    const importer = normalize(relative(root, absolutePath));
    const source = await readFile(absolutePath, "utf8");

    for (const specifier of extractModuleSpecifiers(source)) {
      const imported = resolveRelativeImport(absolutePath, specifier);
      if (!imported) continue;
      const violation = checkArchitectureImport(importer, imported);
      if (violation) failures.push(violation);
    }
  }

  if (failures.length > 0) {
    console.error(
      `Architecture check failed with ${failures.length} violation(s):`,
    );
    for (const failure of failures) {
      console.error(
        `${failure.importer} -> ${failure.imported} violates ${failure.rule}`,
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log("Architecture boundaries passed.");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await runArchitectureCheck();
}
