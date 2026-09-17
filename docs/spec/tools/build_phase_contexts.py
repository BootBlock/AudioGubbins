#!/usr/bin/env python3
from pathlib import Path
import argparse, json, re, hashlib, sys

ROOT=Path(__file__).resolve().parents[1]
OUTDIR=ROOT/"generated/context"
ledger=json.loads((ROOT/"traceability/implementation-ledger.json").read_text(encoding="utf-8"))["phases"]

def requirement_blocks():
    blocks={}
    for p in sorted((ROOT/"requirements").glob("*.md")):
        if p.name=="README.md": continue
        text=p.read_text(encoding="utf-8")
        matches=list(re.finditer(r'^##\s+(REQ-[A-Z]+-\d{3})\s+—.*$', text, flags=re.M))
        for i,m in enumerate(matches):
            end=matches[i+1].start() if i+1<len(matches) else len(text)
            blocks[m.group(1)]=text[m.start():end].strip()
    return blocks

def adrs_for(ids):
    found=[]
    idset=set(ids)
    for p in sorted((ROOT/"adr").glob("ADR-*.md")):
        text=p.read_text(encoding="utf-8")
        if any(rid in text for rid in idset):
            found.append((p,text.strip()))
    return found

def build_phase(phase):
    key=f"{phase:02d}"
    entry=ledger[key]
    pf=ROOT/entry["phase_file"]
    phase_text=pf.read_text(encoding="utf-8").strip()
    ids=[]
    for rid in re.findall(r'`(REQ-[A-Z]+-\d{3})`', phase_text):
        if rid not in ids: ids.append(rid)
    blocks=requirement_blocks()
    missing=[rid for rid in ids if rid not in blocks]
    if missing:
        raise RuntimeError(f"Phase {key} references missing requirement blocks: {missing}")
    pieces=[
        f"# AudioGubbins Phase {key} Context Pack",
        "",
        "> **Generated artefact. Do not edit.**",
        "> This is the bounded context intended for a fresh implementation/review agent. Canonical source remains the modular specification.",
        "",
        "# Global Agent Execution Contract","",
        (ROOT/"contracts/agent-execution.md").read_text(encoding="utf-8").strip(),"",
        "# Global Architecture Invariants","",
        (ROOT/"contracts/architecture-invariants.md").read_text(encoding="utf-8").strip(),"",
        "# Current Phase Packet","",phase_text,"",
        "# Referenced Requirement Blocks","",
    ]
    for rid in ids:
        pieces += [blocks[rid],""]
    relevant_adrs=adrs_for(ids)
    if relevant_adrs:
        pieces += ["# Relevant Accepted ADRs",""]
        for p,text in relevant_adrs:
            pieces += [f"<!-- {p.relative_to(ROOT).as_posix()} -->","",text,""]
    handoffs=[]
    for d in entry["hard_dependencies"]:
        hp=ROOT/f"traceability/handoffs/phase-{d:02d}.md"
        if hp.exists():
            handoffs.append(hp)
    if handoffs:
        pieces += ["# Passed Dependency Handoffs",""]
        for hp in handoffs:
            pieces += [f"<!-- {hp.relative_to(ROOT).as_posix()} -->","",hp.read_text(encoding="utf-8").strip(),""]
    pieces += ["# Current Ledger Entry","",
               "```json",json.dumps(entry,indent=2),"```",""]
    return "\n".join(pieces).rstrip()+"\n"

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--phase", type=int, action="append")
    args=ap.parse_args()
    phases=args.phase if args.phase else list(range(16))
    OUTDIR.mkdir(parents=True,exist_ok=True)
    errors=[]
    for p in phases:
        built=build_phase(p)
        out=OUTDIR/f"phase-{p:02d}-context.md"
        if args.check:
            if not out.exists() or out.read_text(encoding="utf-8")!=built:
                errors.append(out.relative_to(ROOT).as_posix())
        else:
            out.write_text(built,encoding="utf-8")
            print(f"Wrote {out}")
    if errors:
        print("ERROR: stale/missing phase context packs:")
        for e in errors: print(" -",e)
        return 1
    if args.check:
        print("PASS: phase context packs are reproducible and current.")
    return 0

if __name__=="__main__":
    raise SystemExit(main())
