# Commands

## `run`

End-to-end: preflight, Cursor interpreter, optional local approval, Cursor coding run, checks, summary, and GitHub comments (unless disabled).

| Option | Description |
|--------|-------------|
| `--issue` | GitHub issue URL or number (with `gh`-resolvable `origin` if using a number) |
| `--repo` | Path to a git clone of the app |
| `--prompt` | Extra instruction for the agent (default: generic fix text) |
| `--check` | Repeatable. Shell command to run after the agent (e.g. `npm test`) |
| `--clarity` | `off` \| `auto` \| `required` — when to stop before the coding run |
| `--interpreter` | `cursor` \| `cursor-cloud` |
| `--interpreter-model` / `--cursor-model` | Cursor model ids |
| `-y, --yes` | Skip the local "Continue?" prompt; run the coding agent after interpret |
| `--json` | One JSON object on stdout for automation; pair with `--yes` to run the full pipeline without prompts |
| `--no-doctor` | Skip preflight (gh, key, issue access, dirty check) |
| `--dry-run` | Write the interpretation archive but skip the coding agent, checks, and GitHub posting |
| `--no-post` | Run normally but do not post to GitHub |

**Exit codes:** `0` success, `1` error, `2` clarity gate (no coding run).

## `interpret`

Only the interpreter: writes `work-order.json`, `run-meta.json`, and related files. Does not start the coding agent.

Examples:

```bash
agent-ledger interpret --issue https://github.com/org/repo/issues/184 --repo /path/to/repo --json
agent-ledger interpret --issue 184 --repo /path/to/repo --check "npm test" --no-post
```

## `execute`

Takes `--run-id` and `--repo`, loads a prior `interpret` run, and runs the coding + reporting steps.
Use `--dry-run` to validate the archive and print the resume target without launching Cursor, running checks, or posting.

Examples:

```bash
agent-ledger execute --run-id <run-id> --repo /path/to/repo --json
agent-ledger execute --run-id <run-id> --repo /path/to/repo --check "npm test" --no-post
agent-ledger execute --run-id <run-id> --repo /path/to/repo --dry-run --json
```

## `doctor`

Checks `gh`, `CURSOR_API_KEY`, optional issue access, and (with `--repo`) git state and dirty working tree. Can run with no options for a minimal `gh` + key check.

Examples:

```bash
agent-ledger doctor
agent-ledger doctor --repo /path/to/repo --issue 184 --json
agent-ledger doctor --repo /path/to/repo --fail-on-dirty
```

## `runs list`

Lists run directory names under `<repo>/.agent-ledger/runs/` (newest first). Use `--json` for scripts or to mirror what the CTL paper trail UI can show.

| Option | Description |
|--------|-------------|
| `--repo` | Path to a git repository that has AgentLedger runs |
| `--json` | Print `{ repoPath, runs: [{ runId, mtimeMs, issueUrl?, createdAt? }] }` |
| `--limit` | Max runs (1–500, default 200) |

Examples:

```bash
agent-ledger runs list --repo /path/to/repo
agent-ledger runs list --repo /path/to/repo --limit 20 --json
```

## Paper trail on disk

See [archive-contract.md](archive-contract.md) for the file layout and third-party consumers.
