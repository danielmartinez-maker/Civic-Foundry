import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

export function buildCommands({
  preset = "round-debug",
  regex = null,
  label = "native",
} = {}) {
  const configure = ["cmake", ["--preset", preset]];
  const build = ["cmake", ["--build", "--preset", preset]];

  const testArgs = ["--preset", preset, "--output-on-failure"];

  if (label) {
    testArgs.push("-L", label);
  }

  if (regex) {
    testArgs.push("-R", regex);
  }

  return {
    configure,
    build,
    test: ["ctest", testArgs],
  };
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: "cpp",
    stdio: "inherit",
    shell: false,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function parseArgs(argv) {
  const options = {
    preset: "round-debug",
    regex: null,
    label: "native",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--preset") {
      options.preset = argv[++index];
    } else if (arg === "--regex") {
      options.regex = argv[++index];
    } else if (arg === "--label") {
      options.label = argv[++index];
    } else if (arg === "--all") {
      options.label = null;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

async function main() {
  const commands = buildCommands(parseArgs(process.argv.slice(2)));

  run(...commands.configure);
  run(...commands.build);
  run(...commands.test);
}

const isCli =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isCli) {
  await main();
}
