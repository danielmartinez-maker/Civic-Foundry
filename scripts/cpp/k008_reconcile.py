from __future__ import annotations

import json
import sys
from pathlib import Path

CORE = Path("cpp/tests/core/CoreTests.cpp")
PARITY = Path("cpp/tests/parity/ParityTests.cpp")
LEDGER = Path("docs/cpp/TS_REWRITE_LEDGER.json")

CORE_MARKER = "TEST(SchedulerContracts, RegistrationValidationMatchesTypeScriptDiagnostics)"
PARITY_MARKER = "TEST(SchedulerParity, ConflictDiagnosticsMatchTypeScript)"


def save_suffix(source: Path, marker: str, target: Path) -> None:
    text = source.read_text()
    index = text.find(marker)
    if index < 0:
        raise RuntimeError(f"missing K008 marker in {source}: {marker}")
    start = len(text[:index].rstrip())
    target.write_text(text[start:])


def save() -> None:
    save_suffix(CORE, CORE_MARKER, Path("/tmp/k008-core.txt"))
    save_suffix(PARITY, PARITY_MARKER, Path("/tmp/k008-parity.txt"))


def resolve() -> None:
    CORE.write_text(CORE.read_text().rstrip() + "\n\n" + Path("/tmp/k008-core.txt").read_text().lstrip())
    PARITY.write_text(PARITY.read_text().rstrip() + "\n\n" + Path("/tmp/k008-parity.txt").read_text().lstrip())

    ledger = json.loads(LEDGER.read_text())
    matches = [entry for entry in ledger["entries"] if entry["path"] == "src/simulation/kernel/SystemScheduler.ts"]
    if len(matches) != 1:
        raise RuntimeError("SystemScheduler ledger entry missing or duplicated")
    entry = matches[0]
    entry["assignedStack"] = "K008"
    entry["targetNativeOwner"] = "civic::SystemScheduler"
    entry["nativeTestOwner"] = "cpp/tests/parity/ParityTests.cpp"
    entry["status"] = "parity_accepted"
    entry["currentAuthority"] = "typescript"
    entry["parityClassification"] = "parity"
    LEDGER.write_text(json.dumps(ledger, indent=2) + "\n")


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in {"save", "resolve"}:
        raise SystemExit("usage: k008_reconcile.py <save|resolve>")
    if sys.argv[1] == "save":
        save()
    else:
        resolve()


if __name__ == "__main__":
    main()
