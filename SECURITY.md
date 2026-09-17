# Security policy

AudioGubbins decodes audio files you did not write, keeps your projects in your browser's own
storage, and can be given access to folders on your disk. That is a larger surface than most web
pages have, so security reports are very welcome.

It runs locally. Editing and rendering work offline, it implements no usage analytics, and it sends
no diagnostics, logs, project data or audio anywhere without your explicit permission. What it does
do is parse files you open, run compiled DSP and codec code in the browser, write to the storage
you grant it, and exchange project data with the Godot editor addon.

## Reporting a vulnerability

**Report a vulnerability privately. Do not open a public issue.**

1. Open the [Security tab](https://github.com/BootBlock/AudioGubbins/security) of this repository.
2. Click **Report a vulnerability**.
3. Describe the issue, its impact, and how to reproduce it.

You will get a response as soon as reasonably possible. Please allow reasonable time for a fix
before disclosing publicly.

**Redact your paths before you write the report.** A private advisory becomes public when it is
published, so replace anything like `C:\Users\yourname\...` with `C:\Users\<user>\...`, and check
any screenshot for the same. Describing a folder by what owns it is usually clearer than the
literal path, and always safer. Do not attach audio or a project you cannot publish.

## What counts as a vulnerability here

Report privately if you have found a way for **someone or something other than the user** to
influence what AudioGubbins reads, writes or runs:

- A crafted audio, project or metadata file that makes a decoder, parser or DSP module read or
  write outside its buffer, run code, or hang the tab in a way a user cannot recover from.
- A name or path in a project or asset that escapes the storage AudioGubbins was granted, reaching
  another project's data or a folder outside a granted directory handle.
- Anything that sends project data, audio, file names or machine details off the machine without
  explicit permission, including through a cached request, a diagnostics bundle or a dependency.
- Project text, marker names, file names or Godot interchange data that is rendered as markup or
  evaluated instead of shown as text.
- A route by which another page, tab, extension or origin reads a project, or defeats the
  permission prompt that guards a folder.
- Anything in the Godot addon that lets project data run code in the editor or reach outside the
  Godot project folder.
- A real filesystem path, user name or machine name written into an exported file, a diagnostics
  bundle or a log, where it can leave the machine.

## What is an ordinary bug, not a vulnerability

**AudioGubbins losing, corrupting or mis-rendering your work, with no attacker involved, is a bug
report.** It is the most important kind, and it has its own
[issue template](https://github.com/BootBlock/AudioGubbins/issues/new/choose). File it publicly,
with the paths redacted, so it can be fixed in the open.

The dividing line is whether someone other than the user can trigger it.

## What to include

- Which subsystem is affected: import, a codec, storage, the editor, an effect, export, the PWA
  shell, or the Godot integration.
- The browser and version, the operating system, and whether you had installed the app.
- The AudioGubbins version you were running.
- The steps to reproduce, with every path redacted.
- A minimal proof of concept, if you have one. Build it from synthetic audio, and do not include
  one that destroys real work.

## Supported versions

This is an actively developed project. Only the latest `main`, and the most recent release built
from it, is supported. Fixes land on `main`, so please retest there before reporting.
