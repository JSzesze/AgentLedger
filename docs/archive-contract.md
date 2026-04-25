# On-disk archive contract (paper trail)

AgentLedger writes each run under a directory derived from the repository root and a run id:

```text
<repo>/.agent-ledger/runs/<runId>/
```

The run id format is generated in [`src/lib/runArchive.ts`](../src/lib/runArchive.ts) (`createRunArchive`). File names are defined by `buildRunArchivePaths` on the same module.

## Stable file names (v1)

| File | Role |
| ---- | ---- |
| `run-meta.json` | Structured metadata (issue URL, models, clarity, timestamps). Validated when read by the CLI. |
| `work-order.json` | Interpreted work order for the coding agent. |
| `interpretation.md` | Human-readable interpretation. |
| `issue.md` | Snapshot of the GitHub issue context. |
| `repo-context.md` / `repo-context.json` | Repository reconnaissance. |
| `cursor-prompt.md`, `prompt.md` | Prompts passed to Cursor. |
| `summary.md` | Run summary posted to or prepared for the issue. |
| `reconciliation.md` | Acceptance criteria vs implementation. |
| `diff.patch`, `changed-files.txt`, `git-status-*.txt` | Git and change capture. |
| `transcript.md`, `events.jsonl`, `tool-calls.jsonl` | Agent streams (coding). |
| `interpreter-*.md/jsonl` | Interpreter-only streams. |
| `attachments.json`, `attachments/` | Downloaded issue attachments. |
| `checks.log` | Post-run check commands. |
| `github-comments.json` | Record of posted comments. |

## Third-party consumers (e.g. CTL)

The [JSzesze/ctl](https://github.com/JSzesze/ctl) **Agent ledger** page reads this layout from allowlisted repository roots via server-side API routes. Set `AGENT_LEDGER_DEFAULT_REPO` or `AGENT_LEDGER_REPO_ROOTS` on the CTL host so the server can `readdir` / `readFile` under `.agent-ledger/runs/`.

For scripts, you can also use:

```bash
agent-ledger runs list --repo /path/to/repo --json
```

This lists run ids and basic metadata without implementing directory logic yourself. The AgentLedger CLI project lives at [github.com/JSzesze/AgentLedger](https://github.com/JSzesze/AgentLedger).
