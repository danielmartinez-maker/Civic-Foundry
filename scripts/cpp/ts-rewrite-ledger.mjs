import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

const MANIFEST_PATH = 'docs/cpp/TS_REWRITE_INVENTORY_BASELINE.txt';
const BASELINE_DOC_PATH = 'docs/cpp/TS_REWRITE_INVENTORY_BASELINE.md';
const LEDGER_PATH = 'docs/cpp/TS_REWRITE_LEDGER.json';

const STATUS = new Set([
  'pending',
  'in_progress',
  'shadow_complete',
  'parity_accepted',
  'native_authoritative',
  'ts_removed',
]);

const AUTHORITY = new Set(['typescript', 'shadow', 'native', 'none']);

const PARITY = new Set([
  'unclassified',
  'parity',
  'correction',
  'deferred',
]);

const KIND = new Set(['production', 'test', 'declaration', 'support']);

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function parseManifest(text) {
  if (!text.endsWith('\n')) {
    throw new Error(`${MANIFEST_PATH} must end with LF`);
  }

  const paths = text.slice(0, -1).split('\n');

  if (paths.some((path) => path.length === 0)) {
    throw new Error(`${MANIFEST_PATH} contains blank lines`);
  }

  const sorted = [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (JSON.stringify(paths) !== JSON.stringify(sorted)) {
    throw new Error(`${MANIFEST_PATH} is not lexicographically sorted`);
  }

  if (new Set(paths).size !== paths.length) {
    throw new Error(`${MANIFEST_PATH} contains duplicate paths`);
  }

  return paths;
}

function parseBaselineCommit(markdown) {
  const match = markdown.match(
    /\*\*Baseline commit:\*\*\s*`([0-9a-f]{40})`/i,
  );

  if (!match) {
    throw new Error(
      `${BASELINE_DOC_PATH} does not contain a 40-character baseline commit`,
    );
  }

  return match[1].toLowerCase();
}

function classifyKind(path) {
  if (path.endsWith('.d.ts')) return 'declaration';
  if (path.startsWith('tests/support/')) return 'support';
  if (path.startsWith('tests/')) return 'test';
  if (path.startsWith('src/')) return 'production';
  return 'support';
}

function inventoryId(index) {
  return `CF-TS-${String(index + 1).padStart(4, '0')}`;
}

async function readBaseline() {
  const [manifestText, baselineMarkdown] = await Promise.all([
    readFile(MANIFEST_PATH, 'utf8'),
    readFile(BASELINE_DOC_PATH, 'utf8'),
  ]);

  return {
    manifestText,
    paths: parseManifest(manifestText),
    commit: parseBaselineCommit(baselineMarkdown),
  };
}

function initialEntry(path, index) {
  const kind = classifyKind(path);

  return {
    inventoryId: inventoryId(index),
    path,
    kind,
    assignedStack: null,
    targetNativeOwner: null,
    nativeTestOwner: null,
    status: 'pending',
    currentAuthority: kind === 'production' ? 'typescript' : 'none',
    parityClassification: 'unclassified',
    cutoverDependencies: [],
  };
}

function assertNullableString(value, field, id) {
  if (value !== null && (typeof value !== 'string' || value.length === 0)) {
    throw new Error(`${id}.${field} must be null or a non-empty string`);
  }
}

function verifyEntry(entry, path, index) {
  const expectedId = inventoryId(index);

  if (entry.inventoryId !== expectedId) {
    throw new Error(
      `ledger identity mismatch for ${path}: expected ${expectedId}`,
    );
  }

  if (entry.path !== path) {
    throw new Error(
      `ledger path mismatch at ${expectedId}: expected ${path}, got ${entry.path}`,
    );
  }

  const expectedKind = classifyKind(path);
  if (entry.kind !== expectedKind || !KIND.has(entry.kind)) {
    throw new Error(
      `${expectedId}.kind must be ${expectedKind}, got ${entry.kind}`,
    );
  }

  assertNullableString(entry.assignedStack, 'assignedStack', expectedId);
  assertNullableString(
    entry.targetNativeOwner,
    'targetNativeOwner',
    expectedId,
  );
  assertNullableString(entry.nativeTestOwner, 'nativeTestOwner', expectedId);

  if (!STATUS.has(entry.status)) {
    throw new Error(`${expectedId}.status is invalid: ${entry.status}`);
  }

  if (!AUTHORITY.has(entry.currentAuthority)) {
    throw new Error(
      `${expectedId}.currentAuthority is invalid: ${entry.currentAuthority}`,
    );
  }

  if (!PARITY.has(entry.parityClassification)) {
    throw new Error(
      `${expectedId}.parityClassification is invalid: ${entry.parityClassification}`,
    );
  }

  if (
    !Array.isArray(entry.cutoverDependencies) ||
    entry.cutoverDependencies.some(
      (dependency) =>
        typeof dependency !== 'string' || dependency.length === 0,
    )
  ) {
    throw new Error(
      `${expectedId}.cutoverDependencies must be an array of non-empty strings`,
    );
  }

  if (new Set(entry.cutoverDependencies).size !== entry.cutoverDependencies.length) {
    throw new Error(`${expectedId}.cutoverDependencies contains duplicates`);
  }
}

async function init() {
  const baseline = await readBaseline();

  const ledger = {
    schemaVersion: 1,
    baseline: {
      manifest: MANIFEST_PATH,
      manifestSha256: sha256(baseline.manifestText),
      commit: baseline.commit,
      fileCount: baseline.paths.length,
    },
    target: {
      language: 'C++',
      trackedTypeScriptFileCount: 0,
    },
    entries: baseline.paths.map(initialEntry),
  };

  try {
    await readFile(LEDGER_PATH, 'utf8');
    throw new Error(
      `${LEDGER_PATH} already exists; refusing to overwrite migration progress`,
    );
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  await writeFile(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');

  console.log(
    `Initialized ${LEDGER_PATH} with ${ledger.entries.length} entries.`,
  );
}

async function verify() {
  const baseline = await readBaseline();
  const ledger = JSON.parse(await readFile(LEDGER_PATH, 'utf8'));

  if (ledger.schemaVersion !== 1) {
    throw new Error(`ledger.schemaVersion must equal 1`);
  }

  if (ledger.baseline?.manifest !== MANIFEST_PATH) {
    throw new Error(`ledger.baseline.manifest must equal ${MANIFEST_PATH}`);
  }

  const expectedHash = sha256(baseline.manifestText);
  if (ledger.baseline?.manifestSha256 !== expectedHash) {
    throw new Error(`ledger baseline manifest SHA-256 mismatch`);
  }

  if (ledger.baseline?.commit !== baseline.commit) {
    throw new Error(`ledger baseline commit mismatch`);
  }

  if (ledger.baseline?.fileCount !== baseline.paths.length) {
    throw new Error(`ledger baseline fileCount mismatch`);
  }

  if (
    ledger.target?.language !== 'C++' ||
    ledger.target?.trackedTypeScriptFileCount !== 0
  ) {
    throw new Error(`ledger target must require zero tracked TypeScript files`);
  }

  if (!Array.isArray(ledger.entries)) {
    throw new Error(`ledger.entries must be an array`);
  }

  if (ledger.entries.length !== baseline.paths.length) {
    throw new Error(
      `ledger entry count ${ledger.entries.length} does not match baseline ${baseline.paths.length}`,
    );
  }

  const ids = new Set();
  const paths = new Set();

  ledger.entries.forEach((entry, index) => {
    verifyEntry(entry, baseline.paths[index], index);

    if (ids.has(entry.inventoryId)) {
      throw new Error(`duplicate ledger inventoryId: ${entry.inventoryId}`);
    }
    ids.add(entry.inventoryId);

    if (paths.has(entry.path)) {
      throw new Error(`duplicate ledger path: ${entry.path}`);
    }
    paths.add(entry.path);
  });

  console.log(
    `Verified ${LEDGER_PATH}: ${ledger.entries.length} frozen TypeScript paths accounted for.`,
  );
}

const command = process.argv[2];

if (command === 'init') {
  await init();
} else if (command === 'verify') {
  await verify();
} else {
  console.error(
    'Usage: node scripts/cpp/ts-rewrite-ledger.mjs <init|verify>',
  );
  process.exitCode = 2;
}
