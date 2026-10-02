> **Status:** Done. 2026-10-02: the owner chose option 2. A whole history is
> exported at every provenance level and keeps its undo and redo: its state,
> kept states and changes are stripped with one placeholder for each linked
> file's name, handle and path, through the port the project commands declare
> (`6a5a903`, `5b8523b`); media a change names inside a nested value is found,
> which the replay test showed was not (`8e0c07b`); and the export dialogue
> and commands offer every level for a whole history (the commit that moves
> this note here). A snapshot's author's name, left open here, is kept only
> at full: below it the name is left out, the dialogue says so, and the
> reader refuses a snapshot that keeps one.

# Exporting a whole history with less provenance

## The question

A person can export the current state alone with all, some or none of where
its audio came from (REQ-STOR-166). A whole history is exported with all of it:
the export dialogue shows the level fixed at "Keep all of it" with the reason,
and the export commands refuse a whole history asked for less, rather than
writing more than was asked. Should a whole history be exportable with less?

## Why it is not a matter of stripping the states

The history's changes carry provenance themselves: adding an asset carries its
source, original file name included, and relinking or adopting a file carries
the file's identity, its name, kept handle and path among them. Stripping the
kept states alone would leave undo and redo restoring what was stripped, which
is why the unpacked tree holds a history only at full provenance
(`project-tree-header.ts`).

Stripping the changes too rewrites what the history records, and has to keep
every change replayable to the stripped states:

- Adopting a new version of a linked file is refused unless the file is known
  by a kept handle or path that matches, so dropping handles and paths breaks
  the replay of every adoption. They would have to be replaced by placeholders
  that keep which files were the same, consistently across every state and
  change of the export, and the reader would have to check, not strip again, so
  a bundle unpacked and packed again stays the same bundle.
- Which arguments of which commands hold provenance is known only to the
  project commands, so each would declare it, and storage would be given the
  rewrite as a port.
- Stripped states have new fingerprints, which the history's nodes and
  snapshots name before the states in a tree, so the export reads its kept
  states once more to learn them.

## Options

1. Keep a whole history at full provenance (today), shown and explained.
2. Rewrite the changes with placeholders for names, handles and paths, as
   above, with a replay test over random sessions at each level.
3. Offer a whole history at a lower level as a history that cannot be undone
   past the export: compact it to its current state first.

The recommendation is option 2, which honours every level without losing undo;
it changes what an exported history records of the person's changes, which is
the owner's call.
