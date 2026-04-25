# Example: OpenClaw skill using AgentLedger

This file is **documentation** for operators. Adapt the front matter and body to your gateway’s skill format (OpenClaw / ClawHub conventions may differ).

## Purpose

Run the **AgentLedger** CLI from a skill or exec environment so issues get interpreted, implemented with Cursor, and archived under `<repo>/.agent-ledger/runs/`. Pair with **non-interactive** flags.

## Prerequisites on the skill host

- `agent-ledger` on `PATH` (`npm install -g` from a built clone, or use `npx` with a pinned version).
- `CURSOR_API_KEY` in the environment.
- `gh` authenticated if you use issue URLs and GitHub APIs.
- A git clone at `REPO_PATH` the skill can access.

## Environment variables (suggested)

| Variable | Example | Role |
| -------- | ------- | ---- |
| `AGENT_LEDGER_ISSUE` | `https://github.com/org/repo/issues/42` | Issue to process |
| `AGENT_LEDGER_REPO` | `/home/user/projects/repo` | Local clone |
| `CURSOR_API_KEY` | `(secret)` | Cursor API |

## Command (full run, no prompts, JSON on stdout)

```bash
agent-ledger run \
  --issue "${AGENT_LEDGER_ISSUE}" \
  --repo "${AGENT_LEDGER_REPO}" \
  --yes \
  --json \
  --no-post
```

Omit `--no-post` when you want AgentLedger to post interpretation and completion comments on the issue.

## Viewing the paper trail in CTL

If you use [ctl](https://github.com/JSzesze/ctl), set on the **ctl server**:

- `AGENT_LEDGER_DEFAULT_REPO=/same/path/as/AGENT_LEDGER_REPO`

Then open the **Agent ledger** page in ctl to browse `summary.md`, `work-order.json`, and related files for each run.

## Split runs

1. `agent-ledger interpret --issue ... --repo ... --json --no-post`
2. Later: `agent-ledger execute --run-id ... --repo ... --yes --json`

See [openclaw.md](openclaw.md) and [commands.md](commands.md).
