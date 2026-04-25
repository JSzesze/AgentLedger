# OpenClaw and automation

Use **non-interactive** flags so no TTY is required.

## Recommended

```bash
agent-ledger run \
  --issue "https://github.com/org/repo/issues/1" \
  --repo /path/to/clone \
  --yes \
  --json \
  --no-post
```

- `--json` — structured output (stages: doctor + interpret, then execution summary as emitted by the pipeline).
- `--yes` — required for full runs without a prompt. Without `--yes`, the CLI exits after interpret with a message to re-run with `--yes` or use `execute`.
- `--no-post` — if your skill should not post GitHub comments until you opt in, keep this on.

## Split runs

1. `interpret` with `--json` and `--no-post` to capture `runId` and archive path.
2. `execute --run-id ... --repo ... --yes` when you want to start the coding run.

## Environment

- `CURSOR_API_KEY` must be available in the environment the skill uses.
- `gh` should be authenticated if you resolve issues or post comments.

## Operator UI (CTL)

[ctl](https://github.com/JSzesze/ctl) is a separate Next.js **OpenClaw Control** app. It does not replace `agent-ledger`; it complements the gateway (chat, skills, config, etc.). The **Agent ledger** page in ctl is a **read-only** view of paper trail files under `.agent-ledger/runs/` when you configure `AGENT_LEDGER_DEFAULT_REPO` or `AGENT_LEDGER_REPO_ROOTS` on the server running ctl. Same host (or shared volume) as the repo where skills run `agent-ledger` is required for the UI to see files.

See [archive-contract.md](archive-contract.md) for the file layout. List runs from a shell with `agent-ledger runs list --repo /path/to/clone --json`.

## Example skill (exec)

Use a gateway skill or exec step that invokes the CLI with non-interactive flags. Install `agent-ledger` on `PATH` in the skill environment. A minimal pattern:

```bash
agent-ledger run \
  --issue "${ISSUE_URL}" \
  --repo "${REPO_PATH}" \
  --yes \
  --json \
  --no-post
```

Adjust `ISSUE_URL` / `REPO_PATH` to how your skill receives context. See [openclaw-agent-ledger.skill.example.md](openclaw-agent-ledger.skill.example.md) for a copy-paste oriented template.
