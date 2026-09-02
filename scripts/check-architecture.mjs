import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

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
  {
    importer: "src/rendering/",
    forbidden: "src/ui/",
    rule: "rendering-no-ui",
  },
];

const mutationInternals = [
  "src/simulation/transactions/",
  "src/simulation/core/AuthoritativeTransactionCheckpoint.ts",
  "src/simulation/land/CadastralRuntimeMutationService.ts",
];

const presentationRoots = ["src/app/", "src/ui/", "src/rendering/"];
const authoritativeRoots = ["src/simulation/", "src/world/", "src/save/"];

function normalize(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function checkArchitectureImport(importer, imported) {
  const normalizedImporter = normalize(importer);
  const normalizedImported = normalize(imported);

  if (
    presentationRoots.some((prefix) => normalizedImporter.startsWith(prefix)) &&
    mutationInternals.some((prefix) => normalizedImported.startsWith(prefix))
  ) {
    return {
      rule: "presentation-no-authoritative-mutation",
      importer: normalizedImporter,
      imported: normalizedImported,
      alternative:
        "Use SimulationCore commands or a read-only snapshot/diagnostics projection instead of mutation internals.",
    };
  }

  for (const boundary of rules) {
    if (
      normalizedImporter.startsWith(boundary.importer) &&
      normalizedImported.startsWith(boundary.forbidden)
    ) {
      return {
        rule: boundary.rule,
        importer: normalizedImporter,
        imported: normalizedImported,
        alternative:
          "Depend on the lower-level domain contract or a read-only projection.",
      };
    }
  }

  return null;
}

function parseSource(path, source) {
  return ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

export function checkArchitectureSource(path, source) {
  const normalizedPath = normalize(path);
  if (!authoritativeRoots.some((prefix) => normalizedPath.startsWith(prefix)))
    return [];
  const failures = [];
  const sourceFile = parseSource(normalizedPath, source);

  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "Math" &&
      node.expression.name.text === "random"
    ) {
      const position = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile),
      );
      failures.push({
        rule: "authoritative-no-math-random",
        importer: normalizedPath,
        imported: "Math.random",
        line: position.line + 1,
        alternative:
          "Consume a named RandomStreamRegistry stream declared by the owning deterministic system.",
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
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

function extractModuleSpecifiers(path, source) {
  const sourceFile = parseSource(path, source);
  const specifiers = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
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

    failures.push(...checkArchitectureSource(importer, source));
    for (const specifier of extractModuleSpecifiers(importer, source)) {
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
      const location = failure.line === undefined ? "" : `:${failure.line}`;
      console.error(
        `${failure.importer}${location} -> ${failure.imported} violates ${failure.rule}. ${failure.alternative ?? ""}`,
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
