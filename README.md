# AgentLedger

AgentLedger turns messy GitHub issues into **structured work orders** using Cursor, runs a **Cursor coding agent** in your local clone, and posts a **paper trail** back to the issue (interpretation, then completion).

**Source:** [github.com/JSzesze/AgentLedger](https://github.com/JSzesze/AgentLedger). **License:** MIT. **Third party:** the CLI depends on [`@cursor/february`](https://www.npmjs.com/package/@cursor/february) and your `CURSOR_API_KEY` — see Cursor’s [terms](https://cursor.com/terms-of-service). This repo is source-first: clone, `npm install`, and `npm run build`.

- Docs: [Quickstart](docs/quickstart.md) · [Commands](docs/commands.md) · [OpenClaw](docs/openclaw.md) · [Roadmap](ROADMAP.md) · [Archive contract](docs/archive-contract.md) (paper trail layout) · [Troubleshooting](docs/troubleshooting.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)
- Optional per-app config for monorepos: copy [examples/agent-ledger.config.json](examples/agent-ledger.config.json) to **your app repo** at `.agent-ledger/config.json` (not required for simple repos).

## Install

```bash
npm install
npm run build
```

Requirements:

- `gh` installed and authenticated
- `git` available
- `CURSOR_API_KEY` set in the shell or in a project `.env` file
- A local clone of the target repository

Create a local `.env` file if you want the CLI to load the Cursor key automatically:

```bash
cp .env.example .env
```

Then edit `.env`:

```bash
CURSOR_API_KEY=your_cursor_api_key_here
AGENT_LEDGER_INTERPRETER_MODEL=composer-2
AGENT_LEDGER_CURSOR_MODEL=composer-2
```

## Commands (overview)

| Command | Purpose |
|--------|---------|
| `doctor` | Preflight: `gh`, `CURSOR_API_KEY`, optional issue + repo checks |
| `interpret` | Run Cursor interpreter only; writes `work-order.json` and `run-meta.json` |
| `execute` | Resume coding with `--run-id` from a previous `interpret` |
| `run` | Full flow: preflight → interpret → optional local **approval** (unless `--yes`) → coding run → post |

**Automation / OpenClaw:** use `--json` and `--yes` for non-interactive full runs, or `interpret` then `execute`. JSON mode emits one parseable object per command. See [docs/openclaw.md](docs/openclaw.md).

## Usage

```bash
# Full run (stops to confirm before the coding run unless you pass -y)
agent-ledger run \
  --issue https://github.com/org/repo/issues/184 \
  --repo /path/to/local/repo \
  --prompt "Fix the bug described in this issue" \
  --clarity auto \
  --check "npm run typecheck" \
  --check "npm test"
```

**Non-interactive (e.g. scripts / skills):**

```bash
agent-ledger run --issue ... --repo ... --yes --json --no-post
```

**Preview without launching the coding agent:**

```bash
agent-ledger run --issue ... --repo ... --dry-run --json
```

**Split interpret + code:**

```bash
agent-ledger interpret --issue ... --repo ...
agent-ledger execute --run-id <id-from-log> --repo ...
```

For local development:

```bash
npm run dev -- run \
  --issue https://github.com/org/repo/issues/184 \
  --repo /path/to/local/repo \
  --prompt "Fix the bug described in this issue" \
  --dry-run
```

## What It Saves

Each run creates:

```text
.agent-ledger/runs/<timestamp>-issue-<number>/
  issue.md
  attachments/
  attachments.json
  repo-context.md
  repo-context.json
  interpretation.md
  work-order.json
  cursor-prompt.md
  prompt.md
  cursor-interpreter-agent.json
  interpreter-events.jsonl
  interpreter-transcript.md
  interpreter-tool-calls.jsonl
  cursor-agent.json
  events.jsonl
  transcript.md
  tool-calls.jsonl
  git-status-before.txt
  git-status-after.txt
  changed-files.txt
  diff.patch
  checks.log
  reconciliation.md
  summary.md
  github-comments.json
  run-meta.json
```

`run-meta.json` is written for **resume** with `agent-ledger execute --run-id ... --repo ...`.

## Interpretation Loop

Before Cursor edits code, AgentLedger downloads supported image attachments from the issue body and human comments into `attachments/`, records them in `attachments.json`, and passes them to Cursor as image inputs. Then it runs a lightweight repository reconnaissance pass. It ranks likely files, extracts code excerpts, and records relevant package scripts in `repo-context.md`.

Then AgentLedger uses Cursor in a read-only interpretation pass to turn messy issue text, human comments, and repository context into:

- task type
- interpreted goal
- problem statement
- acceptance criteria
- non-goals
- constraints
- open questions
- confidence level
- coding-agent implementation notes
- likely files and codebase findings

That interpretation is saved to `interpretation.md`, saved structurally as `work-order.json`, and posted to GitHub before the Cursor run starts. Cursor receives `cursor-prompt.md`, which treats the interpreted work order as authoritative.

After Cursor finishes, AgentLedger writes `reconciliation.md` and includes the matched acceptance criteria and likely scope drift in `summary.md`. Interpreter logs are saved separately from coding-agent logs so completion reconciliation only uses evidence from the implementation run, diff, and changed files.

### Clarity Gate

`--clarity` controls whether AgentLedger stops after posting the interpretation:

- `--clarity auto` stops before Cursor only when interpretation confidence is low. This is the default.
- `--clarity required` always posts the interpretation and exits before Cursor, so a human can reply first.
- `--clarity off` always runs Cursor after posting the interpretation.

When the clarity gate stops the run, AgentLedger exits with code `2` and does not launch Cursor.

### Cursor Interpreter

AgentLedger uses Cursor itself as the default repo-aware interpreter:

```bash
agent-ledger run \
  --issue ... \
  --repo ... \
  --interpreter cursor \
  --interpreter-model composer-2 \
  --cursor-model composer-2
```

Cursor runs a read-only interpretation pass first. AgentLedger checks that tracked repo state did not change before it posts the interpretation or launches the Composer coding run.

### Cursor Model

Cursor model selection is separate from AgentLedger interpretation. The local Cursor coding agent defaults to Composer:

```bash
agent-ledger run --issue ... --repo ... --cursor-model composer-2
```

The model ID must be available in Cursor for your `CURSOR_API_KEY`.

## Scope

This MVP intentionally does not include: GitHub App auth, project boards, queues, dashboards, or in-issue reaction-based approval. The coding agent is **local** via `--runtime local` (default). A split `interpret` / `execute` flow supports resuming from an archive.
