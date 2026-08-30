import { spawn } from "node:child_process";
import { access, copyFile, cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

export async function prepareDist(root = repositoryRoot) {
  const dist = join(root, "dist");
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  return dist;
}

export async function copyDirectory(source, target) {
  await cp(source, target, { recursive: true });
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function copyStaticFiles(root) {
  const dist = join(root, "dist");
  await copyFile(join(root, "index.html"), join(dist, "index.html"));
  await copyFile(join(root, "src", "styles.css"), join(dist, "styles.css"));
}

async function copyOptionalVendorFiles(root) {
  const vendor = join(root, "dist", "vendor");
  await mkdir(vendor, { recursive: true });

  const clipperSource = join(
    root,
    "node_modules",
    "clipper2-ts",
    "dist",
    "clipper2.min.mjs",
  );
  if (await pathExists(clipperSource)) {
    await copyFile(clipperSource, join(vendor, "clipper2.min.mjs"));
  }

  const pixiSource = join(root, "node_modules", "pixi.js", "dist", "pixi.mjs");
  if (!(await pathExists(pixiSource))) {
    throw new Error(
      "PixiJS browser runtime is missing; run npm ci before building.",
    );
  }
  await copyFile(pixiSource, join(vendor, "pixi.mjs"));

  const babylonVendor = join(vendor, "@babylonjs");
  await mkdir(babylonVendor, { recursive: true });
  for (const packageName of ["core", "loaders"]) {
    const source = join(root, "node_modules", "@babylonjs", packageName);
    if (!(await pathExists(source))) {
      throw new Error(
        `Babylon.js ${packageName} browser runtime is missing; run npm ci before building.`,
      );
    }
    await copyDirectory(source, join(babylonVendor, packageName));
  }
}

function runCommand(command, args, { cwd, label }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: false,
    });

    child.on("error", rejectPromise);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      const detail = signal
        ? `signal ${signal}`
        : `exit code ${code ?? "unknown"}`;
      rejectPromise(new Error(`${label} failed with ${detail}`));
    });
  });
}

async function runTypeScriptCompiler(root) {
  const compiler = join(root, "node_modules", "typescript", "bin", "tsc");
  await runCommand(
    process.execPath,
    [compiler, "-p", join(root, "tsconfig.json")],
    {
      cwd: root,
      label: "TypeScript compilation",
    },
  );
}

async function runAtlasRenderer(root) {
  const script = join(root, "tools", "render_isometric_atlases.py");
  const candidates =
    process.platform === "win32"
      ? [
          ["python", [script]],
          ["py", ["-3", script]],
        ]
      : [
          ["python3", [script]],
          ["python", [script]],
        ];

  let lastMissingCommandError = null;
  for (const [command, args] of candidates) {
    try {
      await runCommand(command, args, { cwd: root, label: "Atlas generation" });
      return;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        lastMissingCommandError = error;
        continue;
      }
      throw error;
    }
  }

  throw new Error("Atlas generation requires Python 3 on PATH.", {
    cause: lastMissingCommandError ?? undefined,
  });
}

async function run3DAssetCompiler(root) {
  const compiler = join(root, "tools", "3d", "CivicAssetCompiler.mjs");
  await runCommand(process.execPath, [compiler, "--build"], {
    cwd: root,
    label: "3D asset generation",
  });
}

export async function build(root = repositoryRoot) {
  await prepareDist(root);
  await runTypeScriptCompiler(root);
  await copyStaticFiles(root);
  await copyOptionalVendorFiles(root);
  await runAtlasRenderer(root);
  await run3DAssetCompiler(root);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await build();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
