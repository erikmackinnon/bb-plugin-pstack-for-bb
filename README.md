---
title: pstack for bb
tags: [pstack, skills, bb]
---

# pstack for bb

Use [Lauren Tan's pstack skills](https://github.com/cursor/plugins/tree/main/pstack) in [bb](https://github.com/get-bb), with a page for turning skills on or off globally and per project. This is an **unofficial mirror** of `cursor/plugins/pstack`, released automatically when upstream changes and adapted only where Cursor locations don't exist in bb. See [COMPATIBILITY.md](COMPATIBILITY.md) for every change.

> [!NOTE]
> This project is not affiliated with or endorsed by Lauren Tan, Cursor, or bb.

## Install

```sh
bb plugin install git:https://github.com/erikmackinnon/bb-plugin-pstack-for-bb.git@^0.1.6
```

bb picks the highest compatible release, installs the runtime dependencies with npm, and builds the plugin.

## Update

The plugin page tells you when a newer release exists. To check and update from the terminal:

```sh
bb plugin outdated
bb plugin update pstack-for-bb
```

## Use the skills

Open **pstack for bb** in the sidebar. Choose **Global** to set defaults for all projects, or select a project to inherit those defaults or customize its skills. The master switch turns off the whole set at the selected scope. New skills follow your global new-skills preference.

A skill can require other skills. Those dependencies stay on while a selected skill needs them, and the page shows which skills need them. Use the cascade option to turn off the dependants too.

Lauren marks almost every pstack skill `disable-model-invocation: true`, so agents don't pick them up on their own: you start them as slash commands. `/poteto-mode` is the main entry point and routes to the rest; `/poteto-help` lists everything. Run `/setup-pstack` once to choose which models pstack uses for each role.

Some workflows need tools such as `bun` or `gh`; the page shows which are missing, and installing the plugin does not install them. From the terminal:

```sh
bb pstack-for-bb --help
bb skill list
```

## Attribution

**pstack © 2026 Lauren Tan, MIT**, from `cursor/plugins` at path `pstack/`. Her [license](pstack/LICENSE) is included unchanged. **Plugin code © 2026 Erik MacKinnon, MIT**, under [LICENSE](LICENSE). See [NOTICE.md](NOTICE.md).

## Report an issue

- Skill content or workflow issues: [cursor/plugins issues](https://github.com/cursor/plugins/issues).
- Installation, toggles, bb compatibility, or update issues: [this repository's issues](https://github.com/erikmackinnon/bb-plugin-pstack-for-bb/issues). Include the plugin version, bundled upstream commit (shown on the plugin page), bb version, and any error output.
