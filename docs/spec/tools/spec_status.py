#!/usr/bin/env python3
"""Read-only status viewer for the AudioGubbins implementation ledger."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
LEDGER = ROOT / "traceability" / "implementation-ledger.json"


def load_ledger() -> dict[str, Any]:
    with LEDGER.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def normalise_phase(value: str) -> str:
    try:
        return f"{int(value):02d}"
    except ValueError as exc:
        raise argparse.ArgumentTypeError("phase must be an integer such as 01 or 1") from exc


def phase_summary(phase_id: str, phase: dict[str, Any]) -> dict[str, Any]:
    return {
        "phase": phase_id,
        "name": phase.get("name"),
        "status": phase.get("status"),
        "hard_dependencies": [f"{int(dep):02d}" for dep in phase.get("hard_dependencies", [])],
        "phase_file": phase.get("phase_file"),
        "requirement_count": len(phase.get("requirements", [])),
        "open_verified_findings": phase.get("open_verified_findings", []),
        "handoff": phase.get("handoff"),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Show AudioGubbins phase readiness without mutating the ledger.")
    parser.add_argument("--json", action="store_true", dest="as_json", help="emit machine-readable JSON")
    parser.add_argument("--phase", type=normalise_phase, help="show details for one phase")
    args = parser.parse_args()

    ledger = load_ledger()
    phases: dict[str, dict[str, Any]] = ledger.get("phases", {})

    if args.phase:
        if args.phase not in phases:
            parser.error(f"phase {args.phase} is not present in the implementation ledger")
        summary = phase_summary(args.phase, phases[args.phase])
        if args.as_json:
            print(json.dumps(summary, indent=2))
        else:
            deps = ", ".join(summary["hard_dependencies"]) or "—"
            print(f"Phase {summary['phase']} — {summary['name']}")
            print(f"Status: {summary['status']}")
            print(f"Hard dependencies: {deps}")
            print(f"Requirement groups: {summary['requirement_count']}")
            print(f"Phase packet: {summary['phase_file']}")
            print(f"Handoff: {summary['handoff'] or '—'}")
            print(f"Open verified findings: {len(summary['open_verified_findings'])}")
        return 0

    summaries = [phase_summary(pid, phases[pid]) for pid in sorted(phases)]
    ready = [item for item in summaries if item["status"] == "READY"]
    unfinished = [item for item in summaries if item["status"] not in {"PASS"}]

    if args.as_json:
        print(json.dumps({"schema_version": ledger.get("schema_version"), "ready": ready, "phases": summaries}, indent=2))
        return 0

    print("AudioGubbins specification status")
    print("=" * 36)
    for item in summaries:
        print(f"{item['phase']}  {item['status']:<10}  {item['name']}")

    print()
    if ready:
        print("READY phase(s):")
        for item in ready:
            print(f"- Phase {item['phase']} — {item['name']}")
            print(f"  Packet: {item['phase_file']}")
            print(f"  Context: generated/context/phase-{item['phase']}-context.md")
    elif unfinished:
        print("No phase is currently READY. Check blocked/not-ready dependencies and review gates.")
    else:
        print("All ledger phases are PASS.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
