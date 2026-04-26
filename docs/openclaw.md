# OpenClaw and automation

Use **non-interactive** flags so no TTY is required. AgentLedger is packaged as an OpenClaw-compatible skill at [`../skills/agent-ledger/SKILL.md`](../skills/agent-ledger/SKILL.md).

## Two operating modes

**Manual or safe use** (local testing, no GitHub side effects, or review before coding):

- Interpretation preview only, no Cursor run:

  ```bash
  agent-ledger run --issue "https://github.com/org/repo/issues/1" --repo /path/to/clone --dry-run --json
  ```

- Full pipeline without posting comments:

  ```bash
  agent-ledger run --issue "https://github.com/org/repo/issues/1" --repo /path/to/clone --yes --json --no-post
  ```

**Assigned remote-worker** (intended end state: issue assigned or labeled, OpenClaw helps clarify first):

- OpenClaw can help the human turn the issue into a clear spec; AgentLedger still ingests the **raw** GitHub issue and comments.
- The worker path runs for **real** by default: interpret, Cursor, checks, archive — not `--dry-run` unless you are only previewing interpretation.
- Posting and status on the issue (interpretation, completion, later “claimed / blocked / running”) are expected as that mode is built out. Until then, use `--no-post` or the helper with `AGENT_LEDGER_POST` unset when you want a silent run.

## Recommended Full Run

```bash
agent-ledger run \
  --issue "https://github.com/org/repo/issues/1" \
  --repo /path/to/clone \
  --yes \
  --json \
  --no-post
```

- `--json` — one parseable JSON object on stdout.
- `--yes` — required for full runs without a prompt. Without `--yes`, the CLI exits after interpret with a message to re-run with `--yes` or use `execute`.
- `--no-post` — if your skill should not post GitHub comments until you opt in, keep this on.

## Preview First

Use `--dry-run` when an operator or agent wants to validate inputs and create the interpretation archive without launching Cursor, running checks, or posting to GitHub:

```bash
agent-ledger run \
  --issue "https://github.com/org/repo/issues/1" \
  --repo /path/to/clone \
  --dry-run \
  --json
```

## Split runs

1. `interpret` with `--json` and `--no-post` to capture `runId` and archive path.
2. `execute --run-id ... --repo ... --json --no-post` when you want to start the coding run.

`execute` has no approval prompt, so it does not accept `--yes`.

## Environment

- `CURSOR_API_KEY` must be available in the environment the skill uses.
- `gh` should be authenticated if you resolve issues or post comments.
- In sandboxed OpenClaw runs, `agent-ledger`, `gh`, `git`, and `CURSOR_API_KEY` must also exist inside the sandbox. Host skill env injection does not automatically populate sandbox environments.

## OpenClaw Skill Install

For workspace-local use, keep this repository's `skills/agent-ledger/` folder under the OpenClaw workspace. OpenClaw exposes user-invocable skills through `/skill agent-ledger ...` and, where supported, native skill slash commands such as `/agent-ledger`.

If installing from another checkout, copy or sync `skills/agent-ledger/` into one of OpenClaw's skill roots, such as workspace `skills/` or `~/.openclaw/skills/`.

Example config override:

```json5
{
  skills: {
    entries: {
      "agent-ledger": {
        enabled: true,
        apiKey: { source: "env", provider: "default", id: "CURSOR_API_KEY" },
      },
    },
  },
}
```

## Operator UI (CTL)

[ctl](https://github.com/JSzesze/ctl) is a separate Next.js **OpenClaw Control** app. It does not replace `agent-ledger`; it complements the gateway (chat, skills, config, etc.). The **Agent ledger** page in ctl is a **read-only** view of paper trail files under `.agent-ledger/runs/` when you configure `AGENT_LEDGER_DEFAULT_REPO` or `AGENT_LEDGER_REPO_ROOTS` on the server running ctl. Same host (or shared volume) as the repo where skills run `agent-ledger` is required for the UI to see files.

See [archive-contract.md](archive-contract.md) for the file layout. List runs from a shell with `agent-ledger runs list --repo /path/to/clone --json`.

## Skill Command Pattern

In the snippets below, **`<skill-dir>`** is the **absolute** path to the `agent-ledger` skill directory: the folder that contains `SKILL.md` and `scripts/` (for example, the `skills/agent-ledger` folder in a clone of this repository, or the same layout under your OpenClaw workspace’s `skills/` root).

The skill includes a helper modeled after OpenClaw skills that ship scripts:

```bash
<skill-dir>/scripts/agent-ledger-openclaw.sh preview
<skill-dir>/scripts/agent-ledger-openclaw.sh run
<skill-dir>/scripts/agent-ledger-openclaw.sh execute "<run-id>"
```

The helper reads `AGENT_LEDGER_REPO`, `AGENT_LEDGER_ISSUE`, `CURSOR_API_KEY`, and optional settings from the environment. See [`../skills/agent-ledger/.env.example`](../skills/agent-ledger/.env.example).

For direct CLI use, a minimal full-run pattern is:

```bash
agent-ledger run \
  --issue "${ISSUE_URL}" \
  --repo "${REPO_PATH}" \
  --yes \
  --json \
  --no-post
```

Adjust `ISSUE_URL` / `REPO_PATH` to how your skill receives context. See [openclaw-agent-ledger.skill.example.md](openclaw-agent-ledger.skill.example.md) for a copy-paste oriented template.
