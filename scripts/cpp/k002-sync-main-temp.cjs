const fs = require('node:fs');

{
  const path = 'cpp/engine/include/civic/core/Kernel.hpp';
  let text = fs.readFileSync(path, 'utf8');
  const domainEvent = [
    'struct DomainEvent final {',
    '    std::uint64_t sequence{};',
    '    std::uint64_t tick{};',
    '    std::string type;',
    '    std::string source;',
    '    std::vector<std::byte> payload;',
    '};',
  ].join('\n');
  const snapshot = [
    domainEvent,
    '',
    'struct DomainEventJournalSnapshot final {',
    '    std::vector<DomainEvent> events;',
    '    std::uint64_t next_sequence{1};',
    '};',
  ].join('\n');
  if (!text.includes('struct DomainEventJournalSnapshot final')) {
    if (!text.includes(domainEvent)) throw new Error('DomainEvent anchor missing in Kernel.hpp');
    text = text.replace(domainEvent, snapshot);
  }
  const start = text.indexOf('class DomainEventJournal final {');
  const endMarker = '\n\nstruct SystemCadence final';
  const end = text.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error('DomainEventJournal class block missing');
  const replacement = [
    'class DomainEventJournal final {',
    'public:',
    '    [[nodiscard]] Result<DomainEvent> append(std::uint64_t tick, std::string type, std::string source, std::vector<std::byte> payload = {});',
    '    [[nodiscard]] std::vector<DomainEvent> drain();',
    '    [[nodiscard]] const std::vector<DomainEvent>& list() const noexcept { return events_; }',
    '    [[nodiscard]] std::vector<DomainEvent> since(std::uint64_t sequence_exclusive) const;',
    '    [[nodiscard]] DomainEventJournalSnapshot snapshot() const;',
    '    [[nodiscard]] Result<void> restore(const DomainEventJournalSnapshot& snapshot);',
    '    void clearDiagnosticHistory() noexcept;',
    '    [[nodiscard]] std::uint64_t nextSequence() const noexcept { return next_sequence_; }',
    'private:',
    '    std::vector<DomainEvent> events_;',
    '    std::uint64_t next_sequence_{1};',
    '};',
  ].join('\n');
  text = text.slice(0, start) + replacement + text.slice(end);
  fs.writeFileSync(path, text, 'utf8');
}

{
  const path = 'cpp/engine/src/core/Kernel.cpp';
  let text = fs.readFileSync(path, 'utf8');
  const start = text.indexOf('DomainEvent DomainEventJournal::append(');
  const end = text.indexOf('Result<void> SystemScheduler::registerSystem', start);
  if (start < 0 || end < 0) throw new Error('DomainEventJournal implementation block missing in Kernel.cpp');
  const lines = [
    'Result<DomainEvent> DomainEventJournal::append(std::uint64_t tick, std::string type, std::string source, std::vector<std::byte> payload) {',
    '    if (!validIdentity(type)) return std::unexpected(make_error(ErrorCode::invalid_argument, "event type must not be empty"));',
    '    if (!validIdentity(source)) return std::unexpected(make_error(ErrorCode::invalid_argument, "event source must not be empty"));',
    '    DomainEvent event{next_sequence_++, tick, std::move(type), std::move(source), std::move(payload)};',
    '    events_.push_back(event);',
    '    return event;',
    '}',
    '',
    'std::vector<DomainEvent> DomainEventJournal::drain() {',
    '    auto drained = std::move(events_);',
    '    events_.clear();',
    '    return drained;',
    '}',
    '',
    'std::vector<DomainEvent> DomainEventJournal::since(std::uint64_t sequence_exclusive) const {',
    '    std::vector<DomainEvent> result;',
    '    for (const auto& event : events_) {',
    '        if (event.sequence > sequence_exclusive) result.push_back(event);',
    '    }',
    '    return result;',
    '}',
    '',
    'DomainEventJournalSnapshot DomainEventJournal::snapshot() const {',
    '    return DomainEventJournalSnapshot{events_, next_sequence_};',
    '}',
    '',
    'Result<void> DomainEventJournal::restore(const DomainEventJournalSnapshot& snapshot) {',
    '    if (snapshot.next_sequence == 0) {',
    '        return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid event journal snapshot"));',
    '    }',
    '',
    '    std::set<std::uint64_t> seen;',
    '    auto restored = snapshot.events;',
    '    for (const auto& event : restored) {',
    '        if (!validIdentity(event.type)) return std::unexpected(make_error(ErrorCode::invalid_argument, "event type must not be empty"));',
    '        if (!validIdentity(event.source)) return std::unexpected(make_error(ErrorCode::invalid_argument, "event source must not be empty"));',
    '        if (event.sequence == 0 || !seen.insert(event.sequence).second) {',
    '            return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid event sequence"));',
    '        }',
    '    }',
    '',
    '    std::ranges::sort(restored, [](const auto& left, const auto& right) { return left.sequence < right.sequence; });',
    '    if (std::ranges::any_of(restored, [&](const auto& event) { return event.sequence >= snapshot.next_sequence; })) {',
    '        return std::unexpected(make_error(ErrorCode::invalid_argument, "event sequence exceeds next sequence"));',
    '    }',
    '',
    '    events_ = std::move(restored);',
    '    next_sequence_ = snapshot.next_sequence;',
    '    return {};',
    '}',
    '',
    'void DomainEventJournal::clearDiagnosticHistory() noexcept {',
    '    events_.clear();',
    '}',
    '',
    '',
  ];
  text = text.slice(0, start) + lines.join('\n') + text.slice(end);
  fs.writeFileSync(path, text, 'utf8');
}

{
  const path = 'cpp/tests/core/CoreTests.cpp';
  let text = fs.readFileSync(path, 'utf8');
  const start = text.indexOf('TEST(EventContracts, PreservesAppendSequenceAndDrainOrder) {');
  const end = text.indexOf('TEST(ClockContracts, PreservesAcceptedSpeedModes)', start);
  if (start < 0 || end < 0) throw new Error('EventContracts block missing');
  const lines = [
    'TEST(EventContracts, PreservesAppendSequenceAndDrainOrder) {',
    '    civic::DomainEventJournal journal;',
    '    const auto first = journal.append(5, "first", "source-a");',
    '    ASSERT_TRUE(first);',
    '    const auto second = journal.append(3, "second", "source-b");',
    '    ASSERT_TRUE(second);',
    '    EXPECT_EQ(first->sequence, 1U);',
    '    EXPECT_EQ(second->sequence, 2U);',
    '    ASSERT_EQ(journal.list().size(), 2U);',
    '    EXPECT_EQ(journal.list()[0].type, "first");',
    '    EXPECT_EQ(journal.list()[1].type, "second");',
    '    const auto drained = journal.drain();',
    '    ASSERT_EQ(drained.size(), 2U);',
    '    EXPECT_EQ(drained[0].sequence, 1U);',
    '    EXPECT_EQ(drained[1].sequence, 2U);',
    '    EXPECT_TRUE(journal.list().empty());',
    '    EXPECT_EQ(journal.nextSequence(), 3U);',
    '}',
    '',
    '',
  ];
  text = text.slice(0, start) + lines.join('\n') + text.slice(end);
  fs.writeFileSync(path, text, 'utf8');
}

{
  const path = 'docs/cpp/TS_REWRITE_LEDGER.json';
  const ledger = JSON.parse(fs.readFileSync(path, 'utf8'));
  const entry = ledger.entries.find((candidate) => candidate.path === 'src/simulation/kernel/DomainEventJournal.ts');
  if (!entry) throw new Error('DomainEventJournal ledger entry missing');
  Object.assign(entry, {
    assignedStack: 'K002',
    targetNativeOwner: 'civic::DomainEventJournal',
    status: 'shadow_complete',
    currentAuthority: 'typescript',
    parityClassification: 'parity',
  });
  fs.writeFileSync(path, JSON.stringify(ledger, null, 2) + '\n', 'utf8');
}
