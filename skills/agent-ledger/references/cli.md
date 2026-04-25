# AgentLedger CLI Reference

Use this reference when the compact skill instructions are not enough.

## Common Env

- `AGENT_LEDGER_REPO`: local git clone.
- `AGENT_LEDGER_ISSUE`: GitHub issue URL or issue number.
- `CURSOR_API_KEY`: Cursor API key for the `agent-ledger` process.
- `AGENT_LEDGER_POST=true`: post interpretation/completion to GitHub (assigned worker or explicit “post to issue”). If unset, the helper uses `--no-post` by default.
- `AGENT_LEDGER_CHECK`: one check command for the helper wrapper. Call `agent-ledger` directly when multiple `--check` flags are needed.

## Helper

Let `<skill-dir>` mean the absolute path to this skill directory.

Prefer the helper for normal OpenClaw usage:

```bash
<skill-dir>/scripts/agent-ledger-openclaw.sh preview
<skill-dir>/scripts/agent-ledger-openclaw.sh run
<skill-dir>/scripts/agent-ledger-openclaw.sh interpret
<skill-dir>/scripts/agent-ledger-openclaw.sh execute <run-id>
<skill-dir>/scripts/agent-ledger-openclaw.sh list 20
<skill-dir>/scripts/agent-ledger-openclaw.sh doctor
```

## Direct CLI

**Preview** (`--dry-run`): interpretation and archive only — no Cursor run, no checks execution as a full run, no posting. Use for **reviewing** the work order before a real run.

**Run** (full non-interactive pipeline): `agent-ledger run ... --yes` — normal path when the operator wants Cursor and checks. Pair with `--no-post` unless posting is intended.

Preview:

```bash
agent-ledger run --issue "$AGENT_LEDGER_ISSUE" --repo "$AGENT_LEDGER_REPO" --dry-run --json
```

Full run without posting:

```bash
agent-ledger run --issue "$AGENT_LEDGER_ISSUE" --repo "$AGENT_LEDGER_REPO" --yes --json --no-post
```

`execute` has **no** approval step and does **not** accept `--yes`; it continues a saved `interpret` or dry-run with the given `--run-id`.

Interpret only:

```bash
agent-ledger interpret --issue "$AGENT_LEDGER_ISSUE" --repo "$AGENT_LEDGER_REPO" --json --no-post
```

Execute saved interpretation:

```bash
agent-ledger execute --run-id "<run-id>" --repo "$AGENT_LEDGER_REPO" --json --no-post
```

List runs:

```bash
agent-ledger runs list --repo "$AGENT_LEDGER_REPO" --limit 50 --json
```

## JSON Contract

Each command emits one parseable JSON object on success in `--json` mode. For `run`, inspect:

- `ok`
- `runId`
- `archive`
- `repoPath`
- `dryRun`
- `interpretation.confidence`
- `interpretation.blockingQuestions`
- `interpretation.postStatus`
- `execution`
- `next`

If `execution` is `null`, Cursor did not run. Use `next` when present.

## Exit Codes

- `0`: success
- `1`: error or failed execution/check
- `2`: clarity gate stopped before the coding run

