#!/usr/bin/env python3
from pathlib import Path
import subprocess, sys, json, re
ROOT=Path(__file__).resolve().parents[1]

commands=[
    [sys.executable, str(ROOT/"tools/spec_lint.py")],
    [sys.executable, str(ROOT/"tools/build_spec.py"), "--check"],
    [sys.executable, str(ROOT/"tools/build_phase_contexts.py"), "--check"],
]
for cmd in commands:
    print("+", " ".join(cmd))
    cp=subprocess.run(cmd, cwd=ROOT)
    if cp.returncode:
        raise SystemExit(cp.returncode)

# Additional hardening assertions
phase_files=sorted(p.relative_to(ROOT).as_posix() for p in (ROOT/"phases").glob("phase-*.md"))
ledger=json.loads((ROOT/"traceability/implementation-ledger.json").read_text(encoding="utf-8"))["phases"]
ledger_files=sorted(entry["phase_file"] for entry in ledger.values())
assert phase_files==ledger_files, f"phase packets {phase_files} differ from the ledger's {ledger_files}"
legacy=(ROOT/"generated/LEGACY_Requirements_Baseline.md")
assert legacy.exists(), "legacy baseline must be archived for auditability"
report=(ROOT/"reviews/hardening-review.md")
assert report.exists(), "hardening review report missing"
text=report.read_text(encoding="utf-8")
if "Unresolved BLOCKER/CRITICAL/HIGH: **0**" not in text:
    raise SystemExit("hardening review does not certify zero unresolved blocking/high findings")

print("PASS: hardening verification assertions satisfied.")
