#!/usr/bin/env python3
from pathlib import Path
import argparse, json, hashlib, sys

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = json.loads((ROOT/"tools/spec_manifest.json").read_text(encoding="utf-8"))
OUTPUT = ROOT / MANIFEST["generated_output"]

def build_text():
    groups = [
        ("Part I — Canonical Requirements", MANIFEST["canonical_files"]["requirements"]),
        ("Part II — Global Execution Contracts", MANIFEST["canonical_files"]["contracts"]),
        ("Part III — Architecture Decision Records", MANIFEST["canonical_files"]["adrs"]),
        ("Part IV — Hardened Phase Packets", MANIFEST["canonical_files"]["phases"]),
        ("Part V — Traceability and Readiness", MANIFEST["canonical_files"]["traceability"]),
    ]
    source_hash = hashlib.sha256()
    pieces = [
        "# AudioGubbins — Implementation Specification",
        "",
        "> **Generated artefact. Do not edit directly.**",
        "> Canonical source is the modular specification listed in `tools/spec_manifest.json`.",
        "",
        "## Reading Rule",
        "",
        "Implementation agents must load the bounded Phase Context Pack described in `contracts/specification-execution.md`; this compiled document is primarily for human review, archival, and download.",
        "",
    ]
    for group_title, files in groups:
        pieces += ["", "---", "", f"# {group_title}", ""]
        for rel in files:
            p=ROOT/rel
            raw=p.read_bytes()
            source_hash.update(rel.encode("utf-8")+b"\0"+raw+b"\0")
            content=raw.decode("utf-8").rstrip()
            pieces += ["", f"<!-- SOURCE: {rel} -->", "", content, ""]
    digest=source_hash.hexdigest()
    pieces += ["", "---", "", "## Generation Fingerprint", "", f"`sha256:{digest}`", ""]
    return "\n".join(pieces).rstrip()+"\n"

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args=ap.parse_args()
    built=build_text()
    if args.check:
        if not OUTPUT.exists():
            print(f"ERROR: missing generated output: {OUTPUT}", file=sys.stderr)
            return 1
        current=OUTPUT.read_text(encoding="utf-8")
        if current != built:
            print("ERROR: generated specification is stale; run tools/build_spec.py", file=sys.stderr)
            return 1
        print("PASS: compiled specification is reproducible and current.")
        return 0
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(built, encoding="utf-8")
    print(f"Wrote {OUTPUT}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
