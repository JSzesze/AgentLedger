# Example: OpenClaw Skill Using AgentLedger

The repository includes a ready-to-use OpenClaw skill at [`../skills/agent-ledger/SKILL.md`](../skills/agent-ledger/SKILL.md). This file is an operator-oriented copy/paste reference for the same workflow.

**`<skill-dir>`** in the command examples is the **absolute** path to that skill folder (the directory containing `SKILL.md` and `scripts/`), e.g. `.../AgentLedger/skills/agent-ledger` on disk.

## Minimal `SKILL.md` Frontmatter

```markdown
---
name: agent-ledger
description: Interpret GitHub issues into AgentLedger work orders, run or preview AgentLedger non-interactively against a local repository clone, and inspect archived AgentLedger runs. Use when the user asks to process a GitHub issue with AgentLedger, preview a dry run, execute a saved run, run doctor or preflight checks, or list AgentLedger paper trail archives.
---
```

## Purpose

Run the **AgentLedger** CLI from a skill or exec environment so issues get interpreted, implemented with Cursor, and archived under `<repo>/.agent-ledger/runs/`. Pair with **non-interactive** flags.

- **Preview** (`--dry-run` / `preview` helper) is for validating interpretation and archive **before** a real run — not the default for an end-to-end “worker completed the issue” path.
- **Full run** (`--yes` / `run` helper) is the normal command when the operator wants Cursor and a completed archive.

## Prerequisites on the skill host

- `agent-ledger` on `PATH` (`npm install -g` from a built clone, or use `npx` with a pinned version).
- `CURSOR_API_KEY` in the environment.
- `gh` authenticated if you use issue URLs and GitHub APIs.
- A git clone at `REPO_PATH` the skill can access.
- In sandboxed OpenClaw runs, install `agent-ledger`, `gh`, and `git` inside the sandbox and pass `CURSOR_API_KEY` through the sandbox config.

## Environment variables (suggested)

| Variable | Example | Role |
| -------- | ------- | ---- |
| `AGENT_LEDGER_ISSUE` | `https://github.com/org/repo/issues/42` | Issue to process |
| `AGENT_LEDGER_REPO` | `/home/user/projects/repo` | Local clone |
| `CURSOR_API_KEY` | `(secret)` | Cursor API |

## Command (preview, no Cursor run)

Using the bundled helper:

```bash
AGENT_LEDGER_ISSUE="${AGENT_LEDGER_ISSUE}" \
AGENT_LEDGER_REPO="${AGENT_LEDGER_REPO}" \
<skill-dir>/scripts/agent-ledger-openclaw.sh preview
```

Direct CLI equivalent:

```bash
agent-ledger run \
  --issue "${AGENT_LEDGER_ISSUE}" \
  --repo "${AGENT_LEDGER_REPO}" \
  --dry-run \
  --json
```

## Command (full run, no prompts, JSON on stdout)

Using the bundled helper:

```bash
AGENT_LEDGER_ISSUE="${AGENT_LEDGER_ISSUE}" \
AGENT_LEDGER_REPO="${AGENT_LEDGER_REPO}" \
<skill-dir>/scripts/agent-ledger-openclaw.sh run
```

Direct CLI equivalent:

```bash
agent-ledger run \
  --issue "${AGENT_LEDGER_ISSUE}" \
  --repo "${AGENT_LEDGER_REPO}" \
  --yes \
  --json \
  --no-post
```

`--json` emits one parseable JSON object. Omit `--no-post` only when you want AgentLedger to post interpretation and completion comments on the issue.

## Viewing the paper trail in CTL

If you use [ctl](https://github.com/JSzesze/ctl), set on the **ctl server**:

- `AGENT_LEDGER_DEFAULT_REPO=/same/path/as/AGENT_LEDGER_REPO`

Then open the **Agent ledger** page in ctl to browse `summary.md`, `work-order.json`, and related files for each run.

## Split runs

1. `agent-ledger interpret --issue ... --repo ... --json --no-post`
2. Later: `agent-ledger execute --run-id ... --repo ... --json --no-post`

`execute` has no approval prompt and does not accept `--yes`.

## Slash Commands

OpenClaw exposes user-invocable skills through `/skill agent-ledger ...` and, where supported, a native sanitized command such as `/agent-ledger`.

See [openclaw.md](openclaw.md) and [commands.md](commands.md).
