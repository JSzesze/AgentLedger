---
name: agent-ledger
description: Interpret GitHub issues into AgentLedger work orders, run or preview AgentLedger non-interactively against a local repository clone, and inspect archived AgentLedger runs. Use when the user asks to process a GitHub issue with AgentLedger, preview a dry run, execute a saved run, run doctor or preflight checks, or list AgentLedger paper trail archives.
user-invocable: true
metadata:
  openclaw:
    requires:
      bins: [agent-ledger, gh, git]
    apiKey:
      source: env
      provider: default
      id: CURSOR_API_KEY
---

# AgentLedger

Use the `agent-ledger` CLI to turn GitHub issues into structured work orders, optionally run Cursor against a local clone, and save a paper trail under `<repo>/.agent-ledger/runs/<runId>/`.

## Requirements

- Ensure `agent-ledger`, `gh`, and `git` are available where the command runs.
- Ensure `CURSOR_API_KEY` is set where the command runs.
- Use an existing local clone for `--repo`.
- Ensure `gh` is authenticated when reading issues or posting comments. In CI and many OpenClaw sandboxes there is no interactive login: set **`GH_TOKEN` or `GITHUB_TOKEN`** in the same environment as the skill (GitHub’s accepted names for the CLI).
- In sandboxed runs, install the binaries and provide `CURSOR_API_KEY` and (if needed) `GH_TOKEN` inside the sandbox too.

## Gateway or chat → one run

Set paths from the user’s message, then call the helper (absolute `<skill-dir>` is the folder containing this `SKILL.md`):

```bash
export CURSOR_API_KEY=…
export AGENT_LEDGER_ISSUE="https://github.com/org/repo/issues/184"   # or issue number in that repo
export AGENT_LEDGER_REPO="/path/to/local/clone"
<skill-dir>/scripts/agent-ledger-openclaw.sh preview   # interpretation only
# or
<skill-dir>/scripts/agent-ledger-openclaw.sh run      # full run, still --no-post unless AGENT_LEDGER_POST=true
```

**Preflight (bins + `gh` auth) without a repo or issue:** `<skill-dir>/scripts/agent-ledger-openclaw.sh check`

**Drop-in config for OpenClaw** (merge with your `openclaw.json`): `openclaw.config.example.json5` next to this file.

## Safety defaults

- Use **`agent-ledger run ... --dry-run --json` or the helper `preview`** only when the user wants to **review interpretation** (archive without Cursor, checks, or posting). Do not use dry-run as the normal “worker finished” path.
- Use **`agent-ledger run ... --yes --json` or the helper `run`** as the default when the user asks AgentLedger to **proceed** with a full non-interactive run.
- Default **GitHub comment posting off**: pass **`--no-post`** for generic or manual use. Set **`AGENT_LEDGER_POST=true`** (or omit `--no-post` in direct CLI) only when the user explicitly wants comments, or when acting as the **assigned remote worker** that should post to the issue.
- Do not invent repository paths, issue URLs, or run ids. Ask for missing values.
- Treat JSON stdout as the source of truth. Each command emits one parseable JSON object in `--json` mode.

## Core commands

Preview a full workflow without launching Cursor or posting:

```bash
agent-ledger run \
  --issue "https://github.com/org/repo/issues/184" \
  --repo "/path/to/local/clone" \
  --dry-run \
  --json
```

Run the full workflow without prompts and without GitHub comments:

```bash
agent-ledger run \
  --issue "https://github.com/org/repo/issues/184" \
  --repo "/path/to/local/clone" \
  --yes \
  --json \
  --no-post
```

Interpret only:

```bash
agent-ledger interpret \
  --issue "https://github.com/org/repo/issues/184" \
  --repo "/path/to/local/clone" \
  --json \
  --no-post
```

Execute a saved interpretation:

```bash
agent-ledger execute \
  --run-id "<run-id>" \
  --repo "/path/to/local/clone" \
  --json \
  --no-post
```

List archived runs:

```bash
agent-ledger runs list --repo "/path/to/local/clone" --json
```

Run preflight checks:

```bash
agent-ledger doctor --repo "/path/to/local/clone" --issue "184" --json
```

## Helper and reference files

- Use `scripts/agent-ledger-openclaw.sh` for `check`, preview, run, interpret, execute, list, and doctor.
- Read `references/cli.md` when you need the helper environment variables, direct CLI variants, exit codes, or the JSON contract.

## Output handling

For `run`, inspect:

- `ok`
- `runId`
- `archive`
- `interpretation.confidence`
- `interpretation.blockingQuestions`
- `interpretation.postStatus`
- `execution.ok`
- `execution.summaryFile`
- `next`

If `execution` is `null`, Cursor did not run. Follow `next` when present.

## Posting policy

- Default **no** GitHub comments: `--no-post` in direct CLI, or do not set `AGENT_LEDGER_POST` for the helper.
- Set **`AGENT_LEDGER_POST=true`** when the user or assigned-worker mode should post interpretation and completion (and future status) on the issue.

If posting is enabled, AgentLedger records posted comment types in `github-comments.json` and skips duplicate completion posts for retried `execute` commands.
