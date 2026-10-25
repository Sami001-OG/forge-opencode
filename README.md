```
                    .    *   .   '   *    .
                 *    .   \  |  /   .   *
                   .   -- \ \|/ / --   .
                 ___________\_|_/___________
                /  _______________________  \
               /__/                       \__\
                   \________     ________/
                    ________|   |________
                   /____________________ \
                   |_____________________|

   ███████╗ ██████╗ ██████╗  ██████╗ ███████╗
   ██╔════╝██╔═══██╗██╔══██╗██╔════╝ ██╔════╝
   █████╗  ██║   ██║██████╔╝██║  ███╗█████╗
   ██╔══╝  ██║   ██║██╔══██╗██║   ██║██╔══╝
   ██║     ╚██████╔╝██║  ██║╚██████╔╝███████╗
   ╚═╝      ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝
        one prompt in. a verified product out.
```

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-green.svg"></a>
  <img alt="OpenCode 2.x" src="https://img.shields.io/badge/OpenCode-2.x-000000.svg">
  <img alt="Node 18+" src="https://img.shields.io/badge/node-%E2%89%A518-339933.svg">
  <img alt="Verification tools" src="https://img.shields.io/badge/verification%20tools-145-blue.svg">
  <img alt="Zero dependencies" src="https://img.shields.io/badge/dependencies-0-brightgreen.svg">
  <a href="https://github.com/Sami001-OG/forge-opencode/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Sami001-OG/forge-opencode/actions/workflows/ci.yml/badge.svg"></a>
</p>

**Forge** turns OpenCode into a self-driving build loop. You describe what you want once. Forge keeps
the agent working, inspects the *real running result* with real tools (browser, test runners, scanners,
profilers), and only stops when a **supervisor**, an **adversarial critic**, **hard checks**, and the
builder's own **sign-off** all agree the result meets a world-class bar.

No second LLM and no API key to configure: the builder, supervisor, critic, planner, and toolsmith are
all the OpenCode model you already use. The plugin itself has zero npm dependencies.

> This is the OpenCode edition of [Sami001-OG/forge](https://github.com/Sami001-OG/forge). The
> verification engine and tool catalog are shared; the Claude Code hook layer has been replaced with
> native OpenCode plugins, agents, and commands.

## Contents

[Why](#why) · [Install](#install) · [Quick start](#quick-start) · [Commands](#commands) ·
[How a run works](#how-a-run-works) · [The gate](#the-gate) · [OpenCode integration](#opencode-integration) ·
[Tools](#tools) · [Safety](#safety-rails) · [Layout](#whats-in-the-repo) · [Troubleshooting](#troubleshooting) ·
[Develop](#develop) · [License](#license)

## Why

A coding agent normally stops when *it* thinks it is done, and it grades its own homework. Forge
separates the roles and puts a deterministic gate between "I think it's done" and "it's delivered":

| Role | Job |
|---|---|
| **Builder** | Your OpenCode session. Builds one stage at a time. |
| **Supervisor** | Runs the actual product, looks at screenshots, measures, scores every rubric axis, and writes the next instruction. Read-only. |
| **Critic** | Fresh context every round. Tries to break the product and find reasons to reject. Never sees the supervisor's verdict. |
| **Toolsmith** | Installs whatever is needed to see and control the product. |
| **Gate** | Plain Node code, not an LLM. Refuses to approve anything that was not observed or that fails a hard check. |

## Install

**Recommended — one line, no npm publish required:**

```sh
curl -fsSL https://raw.githubusercontent.com/Sami001-OG/forge-opencode/main/install.sh | bash
```

Or install from a checkout:

```sh
git clone https://github.com/Sami001-OG/forge-opencode
cd forge-opencode
./install.sh
```

The installer:

- puts the runtime in `~/.config/opencode/forge` (or `$XDG_CONFIG_HOME/opencode/forge`)
- installs the plugin at `~/.config/opencode/plugins/forge/index.ts`, where OpenCode auto-discovers it
- installs `/forge/*` commands and `forge/*` subagents in the global config directories
- links a `forge` CLI shim into `~/.local/bin` (skip with `--no-bin`)
- never touches any project's `.forge/` state

**Project-only install** — commit the config with the project:

```sh
./install.sh --local     # writes ./.opencode/{forge,agents,commands,plugins}
```

**Requirements:** OpenCode **2.x** (tested with 2.1.4), Node.js **18+**, git. Python 3 and Docker are
optional (some catalog tools use them). Run `/forge/doctor` to check.

After installing, open OpenCode in any project. If the `/forge/*` commands do not appear, run `/reload`
or restart OpenCode once.

### Upgrade

Re-run the installer. It replaces the plugin, commands, agents, and runtime, and leaves project state
alone.

### Uninstall

```sh
curl -fsSL https://raw.githubusercontent.com/Sami001-OG/forge-opencode/main/uninstall.sh | bash
# or, from a checkout:
./uninstall.sh          # global
./uninstall.sh --local  # project install
```

## Quick start

```
/forge/build a landing page and waitlist for a smart water bottle
```

Forge plans, asks you one confirmation question (skip it with `--auto`), installs the tools it needs to
see the product, and loops until it is done.

## Commands

| Command | What it does |
|---|---|
| `/forge/build <what to build> [flags]` | Start a loop |
| `/forge/ui <what to build>` | Same loop for UI/UX work, with the design stack and Playwright UI audits |
| `/forge/tweak <small change>` | Change something Forge already built; re-verifies only what the change affects |
| `/forge/status` | Stage, round, scores per axis, what is pending |
| `/forge/abort` | Stop the loop (state stays in `.forge/`) |
| `/forge/doctor` | Check prerequisites, the catalog, and installed tools |

| Flag | Default | Meaning |
|---|---|---|
| `--ui` | off | UI/UX mode (always on for `/forge/ui`): design stack plus UI audits |
| `--auto` | off | No confirmation questions; installs only tier-0 tools |
| `--bar N` | 9 | Quality bar (out of 10) for the last three stages |
| `--max-rounds N` | 40 | Hard cap on verify rounds |
| `--max-minutes N` | 240 | Hard cap on wall-clock time |
| `--verifier-model <alias>` | off | Cheaper model for routine verification rounds (final stage uses the session model) |
| `--plateau N` | 2 | Stop after N rounds of marginal, non-improving scores (0 disables) |

Run it in a project directory (an empty one is fine). For unattended runs, use a container or VM: the
builder runs commands and installs tools.

## How a run works

```
 your prompt
     |
     v
 PLAN       planner: classify the target, decide local vs remote, research best-in-class
            reference products, write rubric + stages + acceptance criteria + hard checks
            (you confirm once)
     |
     v
 PROVISION  toolsmith installs what is needed to see and control the product
     |
     v
 +-> BUILD  one stage:  skeleton > function > harden > polish > finish
 |       |
 |       |  the builder tries to stop
 |       v
 |   GATE (code)  "not accepted until verified. Run:"
 |       1. hard checks   build, tests, lint, smoke run
 |       2. supervisor    runs the product, screenshots, scores every axis
 |       3. critic        attacks it: bad input, mobile, restarts, scanners
 |       |
 |     approve?
 |     no  -> feedback goes to the builder, new round -----------------+
 |     yes -> next stage                                               |
 +---------------------------------------------------------------------+
     |  last stage approved
     v
 SIGN-OFF   the builder states honestly: complete or incomplete
     |
     v
 DELIVER    .forge/DELIVERY.md and a final summary: what was built, how to run it,
            final scores, known gaps
```

### Stages and default bars

| Stage | Goal | Bar |
|---|---|---|
| skeleton | Architecture, scaffold, one end-to-end slice running | 6 |
| function | Every feature works, with tests | 8 |
| harden | Edge cases, failure modes, security, performance | 9 |
| polish | Design system, states, interaction quality | 9 |
| finish | Docs, run/deploy instructions, cleanup, final verification | 9 |

The planner picks `lean` (2 stages), `standard` (3), or `full` (5) based on size and risk, so small
products are not forced through five verification rounds.

## The gate

A stage passes only if **all** of these hold:

1. Every **rubric axis** is at or above the stage bar. Supervisor and critic both score every axis and
   the **minimum** counts. Non-critical axes get one point of slack.
2. Every **acceptance criterion** in force was *actually observed* and passed, with evidence that exists
   on disk (a screenshot, a report, a hard-check result). An unobservable criterion is a blind spot and
   blocks approval; the toolsmith is called to provision what is missing.
3. All **hard checks** pass.
4. Supervisor and critic both approved.
5. On the final stage: the builder's own `signoff complete`.

## OpenCode integration

The Claude Code version used three hooks. The OpenCode edition maps them to supported V2 extension
points:

| Claude Code hook | OpenCode equivalent | Behaviour |
|---|---|---|
| `Stop` | `session.idle` event + `session.prompt` | Runs `scripts/gate.mjs --json`. If the stage is not accepted, the gate's reason is sent back into the same session as a new prompt. |
| `PreToolUse` | `tool.execute.before` | Refuses `write`, `edit`, `patch`, and shell redirection into `.forge/state.json`, checks, verdicts, scopes, signoffs, and tool approvals. |
| `SessionStart` | `shell.create.before` | Adds `.forge/tools`, the shared `~/.forge/tools` shim, and the tool library path to every shell invocation, and sets `FORGE_PROJECT_DIR`. |

Why this matters:

- **Same session, same model.** The gate injects a normal prompt, so the builder keeps its context and
  your selected model/agent.
- **One writer.** Loop state is still written only by `scripts/forge.mjs`, not by the plugin.
- **Fail-open.** If the gate crashes, times out, or Node is missing, it logs to `.forge/plugin-errors.log`
  and lets the session stop. It can never trap you.
- **Session-scoped.** The plugin binds the loop to the session that ran `forge init`/`start`/`tweak`, so
  subagent turns do not trigger the gate.
- **Leave via `/forge/abort`.** Pressing Esc stops the current turn, not the loop; the gate resumes on
  the next idle. Abort the loop explicitly if you want it to stop.

## Tools

`catalog/tools.json` contains 145 verification tools — browsers, test runners, linters, security
scanners, accessibility checkers, profilers, emulators, and more. The toolsmith installs only what a
criterion or check actually needs, version-pinned and shared per machine in `~/.forge/tools`.

Useful CLI commands (the same ones the agents use):

```sh
forge doctor                     # prerequisites and catalog
forge status [--json]            # stage, round, scores, scope, timings
forge checks                     # run the plan's hard checks
forge shot <url> [--mobile]      # screenshot + console/network errors
forge http <url>                 # status, headers, body
forge visual <url> --name home   # pixel-diff regression
forge assert-json report.json 'summary.errors' '==' 0
forge uiaudit <url> [--strict]   # breakpoints, dark mode, focus, tap targets, motion
forge design check               # conformance to .forge/design-system.md
forge tool list --search playwright
forge exec -- eslint .           # run anything with project-local tools on PATH
```

## Incremental verification

Forge fingerprints the files each acceptance criterion and hard check depends on. A result that passed
and whose files have not changed is **carried over**, not redone. Shared config changes
(`package.json`, lockfiles, `tsconfig`, `*.config.*`, `Dockerfile`, `.env*`), the first verification, or
more than 40% of files changed force a full pass. `/forge/status` shows re-verified versus carried-over
criteria. `/forge/tweak` is the fast path for a small change to a finished product.

## UI/UX mode

`/forge/ui` (or `--ui`) adds a design stack: Emil Kowalski's motion/details rules, Taste Skill's art
direction and anti-slop list, Impeccable's craft and critique workflow, and UI UX Pro Max for a grounded
design system (`.forge/design-system.md`). It also enables Playwright audits across breakpoints, dark
mode, reduced motion, focus, and tap targets. Each external skill pack is opt-in and installed by its
own upstream installer; installed skills run with full agent permissions, so approve them deliberately.

## Safety rails

- Fails open: a gate error never traps the session.
- Protected state: the builder cannot hand-edit loop state or fake a verdict; the CLI validates evidence
  and writes it.
- Tool tiers: tier 0 installs freely; tier 1/2 needs your approval; tier 3 reports the environment
  variable you must set and never handles secrets.
- No real-money or real-account side effects. Bots and integrations run in paper/sandbox mode.
- Unattended runs belong in a container or VM: the builder executes commands and installs tools.
- `--max-rounds`, `--max-minutes`, and a loop budget cap every run.

## What's in the repo

```
plugin/index.ts          OpenCode plugin: idle gate, state guard, tool PATH
agents/forge/*.md        planner, supervisor, critic, toolsmith (subagents)
commands/forge/*.md      /forge/build, ui, tweak, status, abort, doctor
scripts/forge.mjs        the CLI and the only writer of loop state
scripts/gate.mjs         gate entry point (`--json` for the plugin)
scripts/lib/             gate logic, planning, state, catalog, provisioning
catalog/                 tools, bundles, target playbooks, check templates
install.sh               global/project installer
uninstall.sh             removes the install, keeps project state
tests/                   gate, incremental verification, catalog, guard, versions
```

Per-project state lives in `.forge/` (gitignored): `state.json`, `rubric.md`, checks, verdicts, scopes,
evidence, and `DELIVERY.md`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `/forge/*` commands missing | Run `/reload`; confirm `~/.config/opencode/commands/forge/` exists. |
| Loop never resumes after a turn | Check `~/.config/opencode/plugins/forge/index.ts` exists, then `/reload`. Look at `.forge/plugin-errors.log`. |
| `forge: command not found` | Use the full path printed by the installer, or add `~/.local/bin` to `PATH`. |
| `node` not found | Forge runs on Node.js 18+, not the Bun runtime OpenCode embeds. Install Node. |
| Tools "not found" during verification | Run them through `forge exec -- <cmd>`; the plugin also adds the tool dirs to PATH. |
| UI audits fail | Install Playwright browsers via the toolsmith, or `forge tool install playwright`. |
| Loop keeps going after Esc | That is the design; run `/forge/abort`. |

## Develop

```sh
npm test                 # gate, incremental, catalog, guard, version tests
npm run smoke:catalog    # strict catalog smoke test
./install.sh --local     # test the installer in a project
```

The plugin is plain TypeScript with no imports beyond Node built-ins. The runtime and gate are plain
ES modules with zero npm dependencies.

## License

MIT. Forge is adapted from [Sami001-OG/forge](https://github.com/Sami001-OG/forge) (MIT). The optional
design skill packs keep their own licenses (Emil Kowalski MIT, Taste Skill MIT, Impeccable Apache-2.0,
UI UX Pro Max MIT).
