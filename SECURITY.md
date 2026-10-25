# Security policy

AudioGubbins opens audio files you didn't make, keeps your projects on your own machine, and can be
given access to folders on your disk. If you find a way to misuse any of that, please tell us
privately so it can be fixed before anyone else finds it.

## Reporting a security problem

**Please report it privately. Don't open a public issue or discussion.**

1. Go to the [Security tab](https://github.com/BootBlock/AudioGubbins/security) of this repository.
2. Click **Report a vulnerability**.
3. Fill in the form, using the list below as a guide.

Only the maintainer can see your report. You'll get a reply as soon as possible, and we ask that
you give us a reasonable time to release a fix before you talk about it publicly.

## What to include

- The AudioGubbins version (shown in About AudioGubbins).
- Whether you were using the Windows app or a web browser, and which browser and version.
- Your operating system.
- What the problem is and what someone could do with it.
- The steps to make it happen.
- A small example file, if you have one. Please make it from a test sound rather than real work.

## Keep personal details out

A report may be published once the problem is fixed, so please don't include anything you'd want
kept private:

- Never include a password, key, token or other secret.
- Replace your name in folder paths: write `C:\Users\<user>\...` instead of `C:\Users\yourname\...`.
- Leave out your computer's name and email addresses, and crop any screenshot that shows them.
- Don't attach audio or a project you couldn't share publicly.

## Security problem or ordinary bug?

It's a security problem if **someone other than you** could use it: for example, a file that makes
AudioGubbins run code, read or write outside the folders you gave it, or send your audio or details
off your machine without asking.

If AudioGubbins loses or damages your work with nobody else involved, that's a bug, and an
important one. Please [report it as a bug](https://github.com/BootBlock/AudioGubbins/issues/new?template=bug_report.yml)
so it can be fixed in the open.

## Supported versions

Only the latest release gets security fixes. Please check the problem still happens in it before
you report.
