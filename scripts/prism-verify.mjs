import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const prismRoot = fileURLToPath(new URL("../engine/prism/", import.meta.url));

export const prismVerificationCommands = Object.freeze([
  Object.freeze(["fmt", "--all", "--", "--check"]),
  Object.freeze([
    "clippy",
    "--workspace",
    "--all-targets",
    "--locked",
    "--",
    "-D",
    "warnings",
  ]),
  Object.freeze(["test", "--workspace", "--locked"]),
  Object.freeze(["check", "--workspace", "--all-targets", "--locked"]),
]);

function runCargo(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("cargo", args, {
      cwd,
      shell: false,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`cargo ${args.join(" ")} exited with code ${code}`));
    });
  });
}

export async function runPrismVerification(cwd = prismRoot) {
  for (const command of prismVerificationCommands) {
    await runCargo([...command], cwd);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await runPrismVerification();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
