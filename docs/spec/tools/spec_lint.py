#!/usr/bin/env python3
from pathlib import Path
import re, json, sys

ROOT=Path(__file__).resolve().parents[1]
ERRORS=[]
WARNINGS=[]

REQUIRED_PHASE_HEADINGS = [
    "## Status","## Objective","## User-Visible Outcome","## Hard Dependencies",
    "## Owned Requirements","## Referenced Global Execution Requirements","## In Scope",
    "## Explicitly Out of Scope","## Owned Modules / Packages","## Cross-Package Dependency Rules","## Required Public Contracts",
    "## Data / Schema Changes","## Browser / Platform Considerations","## Architectural Invariants","## Internal Work Units","## Failure and Recovery Behaviour",
    "## Required Verification Commands / Suites","## Acceptance Criteria","## Forbidden Shortcuts",
    "## Required Review Lenses","## Evidence Package","## Handoff Capsule"
]

reg=json.loads((ROOT/"traceability/requirements-register.json").read_text(encoding="utf-8"))["requirements"]
ledger=json.loads((ROOT/"traceability/implementation-ledger.json").read_text(encoding="utf-8"))["phases"]
graph=json.loads((ROOT/"traceability/phase-dependency-graph.json").read_text(encoding="utf-8"))["hard_dependencies"]

# IDs in canonical requirements
seen={}
for p in sorted((ROOT/"requirements").glob("*.md")):
    if p.name=="README.md": continue
    text=p.read_text(encoding="utf-8")
    for rid in re.findall(r'^##\s+(REQ-[A-Z]+-\d{3})\s+—', text, flags=re.M):
        if rid in seen:
            ERRORS.append(f"duplicate requirement ID {rid}: {seen[rid]} and {p.relative_to(ROOT)}")
        seen[rid]=str(p.relative_to(ROOT))

reg_ids=[r["id"] for r in reg]
if len(reg_ids)!=len(set(reg_ids)):
    ERRORS.append("requirements-register.json contains duplicate IDs")
for rid in reg_ids:
    if rid not in seen:
        ERRORS.append(f"register references missing canonical requirement {rid}")
for rid in seen:
    if rid not in reg_ids:
        ERRORS.append(f"canonical requirement missing from register: {rid}")

# Phase files completeness and ownership
phase_owned={}
for phase_key,entry in ledger.items():
    pf=ROOT/entry["phase_file"]
    if not pf.exists():
        ERRORS.append(f"missing phase file {entry['phase_file']}")
        continue
    text=pf.read_text(encoding="utf-8")
    for heading in REQUIRED_PHASE_HEADINGS:
        if heading not in text:
            ERRORS.append(f"{pf.name}: missing mandatory heading {heading}")
    if re.search(r'NOT HARDENED|NOT READY FOR IMPLEMENTATION|define one precise|phase-specific forbidden shortcuts', text, flags=re.I):
        ERRORS.append(f"{pf.name}: contains stale shell/placeholder text")
    ids=set(re.findall(r'`(REQ-[A-Z]+-\d{3})`', text))
    phase_owned[int(phase_key)]=ids
    for rid in entry["requirements"]:
        if rid not in ids:
            ERRORS.append(f"{pf.name}: owned/constraint requirement {rid} not referenced")
    if entry["status"]=="READY":
        for d in entry["hard_dependencies"]:
            if ledger[f"{d:02d}"]["status"]!="PASS":
                ERRORS.append(f"Phase {phase_key} READY but dependency {d:02d} is not PASS")

# Each register entry must appear in its owner's phase packet
for r in reg:
    p=r["owner_phase"]
    if r["id"] not in phase_owned.get(p,set()):
        ERRORS.append(f"{r['id']} missing from owner Phase {p:02d} packet")

# DAG cycle check
deps={int(k):list(v) for k,v in graph.items()}
temp=set(); perm=set()
def visit(n,stack):
    if n in perm: return
    if n in temp:
        ERRORS.append("phase dependency cycle: "+" -> ".join(map(str,stack+[n])))
        return
    temp.add(n)
    for d in deps.get(n,[]):
        if d not in deps:
            ERRORS.append(f"phase {n:02d} depends on unknown phase {d:02d}")
        else:
            visit(d,stack+[n])
    temp.remove(n); perm.add(n)
for n in deps: visit(n,[])

# Canonical hardening status checks
for folder in ["requirements","contracts","phases","adr","traceability"]:
    for p in (ROOT/folder).rglob("*.md"):
        if "template" in p.name: continue
        text=p.read_text(encoding="utf-8")
        if "Hardening status:" in text or "NOT HARDENED" in text:
            ERRORS.append(f"stale pre-hardening marker in {p.relative_to(ROOT)}")

# Authority safety
for p in (ROOT/"requirements").glob("*.md"):
    if p.name=="README.md": continue
    t=p.read_text(encoding="utf-8")
    if "Authority:" not in t:
        ERRORS.append(f"{p.name}: missing authority declaration")

print(f"Requirements discovered: {len(seen)}")
print(f"Register entries: {len(reg)}")
print(f"Phases: {len(ledger)}")
if WARNINGS:
    for w in WARNINGS: print("WARNING:",w)
if ERRORS:
    for e in ERRORS: print("ERROR:",e)
    print(f"FAIL: {len(ERRORS)} error(s).")
    raise SystemExit(1)
print("PASS: specification structure, traceability, phase packets, and dependency DAG are consistent.")
