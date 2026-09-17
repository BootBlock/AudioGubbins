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
phase_files=list((ROOT/"phases").glob("phase-*.md"))
assert len(phase_files)==16, f"expected 16 phase packets, got {len(phase_files)}"
legacy=(ROOT/"generated/LEGACY_Requirements_Baseline.md")
assert legacy.exists(), "legacy baseline must be archived for auditability"
report=(ROOT/"reviews/hardening-review.md")
assert report.exists(), "hardening review report missing"
text=report.read_text(encoding="utf-8")
if "Unresolved BLOCKER/CRITICAL/HIGH: **0**" not in text:
    raise SystemExit("hardening review does not certify zero unresolved blocking/high findings")

print("PASS: hardening verification assertions satisfied.")
