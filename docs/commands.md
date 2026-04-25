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
| `--json` | JSON on stdout for automation; pair with `--yes` to run the full pipeline without prompts |
| `--no-doctor` | Skip preflight (gh, key, issue access, dirty check) |
| `--dry-run` / `--no-post` | Do not post to GitHub |

**Exit codes:** `0` success, `1` error, `2` clarity gate (no coding run).

## `interpret`

Only the interpreter: writes `work-order.json`, `run-meta.json`, and related files. Does not start the coding agent.

## `execute`

Takes `--run-id` and `--repo`, loads a prior `interpret` run, and runs the coding + reporting steps.

## `doctor`

Checks `gh`, `CURSOR_API_KEY`, optional issue access, and (with `--repo`) git state and dirty working tree. Can run with no options for a minimal `gh` + key check.

## `runs list`

Lists run directory names under `<repo>/.agent-ledger/runs/` (newest first). Use `--json` for scripts or to mirror what the CTL paper trail UI can show.

| Option | Description |
|--------|-------------|
| `--repo` | Path to a git repository that has AgentLedger runs |
| `--json` | Print `{ repoPath, runs: [{ runId, mtimeMs, issueUrl?, createdAt? }] }` |
| `--limit` | Max runs (1–500, default 200) |

## Paper trail on disk

See [archive-contract.md](archive-contract.md) for the file layout and third-party consumers.
