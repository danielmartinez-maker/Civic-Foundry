import fs from 'node:fs';
import { execSync } from 'node:child_process';

function run(command, options = {}) {
  return execSync(command, { stdio: 'inherit', ...options });
}

run('git config user.name github-actions[bot]');
run('git config user.email 41898282+github-actions[bot]@users.noreply.github.com');
run('git fetch origin main');
try {
  run('git merge --no-commit --no-ff origin/main');
} catch {
  console.log('Merge reported conflicts; resolving shared files explicitly.');
}

for (const path of [
  '.github/workflows/ci.yml',
  'cpp/tests/core/CoreTests.cpp',
  'cpp/tests/parity/ParityTests.cpp',
  'docs/cpp/TS_REWRITE_LEDGER.json',
]) {
  run(`git checkout origin/main -- ${path}`);
}
for (const path of [
  'cpp/engine/include/civic/core/RandomStreamRegistry.hpp',
  'cpp/engine/src/core/RandomStreamRegistry.cpp',
]) {
  try { run(`git checkout --ours ${path}`); } catch { /* no conflict */ }
}

const corePath = 'cpp/tests/core/CoreTests.cpp';
let core = fs.readFileSync(corePath, 'utf8').trimEnd();
if (!core.includes('RootSeedAndSameNameUseUint32StreamSemantics')) {
  core += String.raw`

TEST(RandomParity, RootSeedAndSameNameUseUint32StreamSemantics) {
    civic::RandomStreamRegistry baseline(1U);
    const auto wrapped_seed = static_cast<std::uint32_t>(0x100000001ULL);
    civic::RandomStreamRegistry wrapped(wrapped_seed);
    auto baseline_traffic = baseline.stream("traffic"); ASSERT_TRUE(baseline_traffic);
    auto wrapped_traffic = wrapped.stream("traffic"); ASSERT_TRUE(wrapped_traffic);
    EXPECT_DOUBLE_EQ((*baseline_traffic)->next(), (*wrapped_traffic)->next());

    civic::RandomStreamRegistry registry(7U);
    auto first = registry.stream("traffic"); ASSERT_TRUE(first);
    (void)(*first)->next();
    const auto state = (*first)->state();
    auto second = registry.stream("traffic"); ASSERT_TRUE(second);
    EXPECT_EQ(*first, *second);
    EXPECT_EQ((*second)->state(), state);
}

TEST(RandomParity, RestoreZeroStateUsesSeededRandomFallback) {
    civic::RandomStreamRegistry registry(9U);
    civic::RandomStreamSnapshot snapshot;
    snapshot.emplace("traffic", 0U);
    ASSERT_TRUE(registry.restore(snapshot));

    auto traffic = registry.stream("traffic"); ASSERT_TRUE(traffic);
    EXPECT_EQ((*traffic)->state(), 0x6d2b79f5U);
    civic::SeededRandom expected(0U);
    EXPECT_DOUBLE_EQ((*traffic)->next(), expected.next());
}
`;
  fs.writeFileSync(corePath, `${core}\n`);
}

const parityPath = 'cpp/tests/parity/ParityTests.cpp';
let parity = fs.readFileSync(parityPath, 'utf8').trimEnd();
if (!parity.includes('ListNamesUsesJavaScriptUtf16OrdinalOrder')) {
  parity += String.raw`

TEST(RandomParity, ListNamesUsesJavaScriptUtf16OrdinalOrder) {
    civic::RandomStreamRegistry registry(31);
    ASSERT_TRUE(registry.stream(kPrivateBmp));
    ASSERT_TRUE(registry.stream("traffic"));
    ASSERT_TRUE(registry.stream(kSupplementary));

    const auto names = registry.listNames();
    ASSERT_EQ(names.size(), 3U);
    EXPECT_EQ(names[0], "traffic");
    EXPECT_EQ(names[1], kSupplementary);
    EXPECT_EQ(names[2], kPrivateBmp);
}

TEST(RandomParity, RestoreReplacesRatherThanMergesStreams) {
    civic::RandomStreamRegistry source(31);
    auto traffic = source.stream("traffic"); ASSERT_TRUE(traffic);
    (void)(*traffic)->next();
    const auto snapshot = source.snapshot();

    civic::RandomStreamRegistry restored(31);
    ASSERT_TRUE(restored.stream("obsolete"));
    ASSERT_TRUE(restored.restore(snapshot));

    const auto names = restored.listNames();
    ASSERT_EQ(names.size(), 1U);
    EXPECT_EQ(names[0], "traffic");
}

TEST(RandomParity, SnapshotRestoreContinuesExactSequence) {
    civic::RandomStreamRegistry original(31);
    auto traffic = original.stream("traffic"); ASSERT_TRUE(traffic);
    (void)(*traffic)->next();
    (void)(*traffic)->next();
    const auto snapshot = original.snapshot();
    const auto expected_first = (*traffic)->next();
    const auto expected_second = (*traffic)->next();

    civic::RandomStreamRegistry restored(31);
    ASSERT_TRUE(restored.restore(snapshot));
    auto restored_traffic = restored.stream("traffic"); ASSERT_TRUE(restored_traffic);
    EXPECT_DOUBLE_EQ((*restored_traffic)->next(), expected_first);
    EXPECT_DOUBLE_EQ((*restored_traffic)->next(), expected_second);
}

TEST(RandomParity, NonBmpStreamNameMatchesTypeScriptFixture) {
    civic::RandomStreamRegistry registry(31);
    auto stream = registry.stream(kSupplementary); ASSERT_TRUE(stream);
    EXPECT_DOUBLE_EQ((*stream)->next(), 0.42440165276639163);
    EXPECT_DOUBLE_EQ((*stream)->next(), 0.07056768285110593);
}
`;
  fs.writeFileSync(parityPath, `${parity}\n`);
}

const ledgerPath = 'docs/cpp/TS_REWRITE_LEDGER.json';
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const entry = ledger.entries.find((candidate) => candidate.inventoryId === 'CF-TS-0099');
if (!entry || entry.path !== 'src/simulation/kernel/RandomStreamRegistry.ts') {
  throw new Error('CF-TS-0099 RandomStreamRegistry entry missing');
}
Object.assign(entry, {
  assignedStack: 'K005',
  targetNativeOwner: 'cpp/engine/src/core/RandomStreamRegistry.cpp',
  nativeTestOwner: 'cpp/tests/parity/ParityTests.cpp',
  status: 'parity_accepted',
  currentAuthority: 'typescript',
  parityClassification: 'parity',
});
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

fs.rmSync('.github/workflows/k005-reconcile-main.yml');
fs.rmSync('scripts/cpp/k005-reconcile-main.mjs');
run('git add -A');
run('git commit -m "merge(k005): reconcile with current main"');
run('git push origin HEAD:feature/k005-random-stream-registry-cpp');
