# Troubleshooting

## `gh` or issue access

- `gh auth login` and `gh auth status -h github.com`
- For `issue/number` without a full URL, `origin` must point at `github.com` for the right repo

## `CURSOR_API_KEY`

- Export in the shell or use a project `.env` in the AgentLedger working directory
- The CLI does not read `.env` from the **target** `--repo` automatically

## Ripgrep / ignore mapping (Cursor SDK)

You may see non-fatal messages like `Ripgrep path not configured` from `@cursor/february`. They are emitted by the SDK; runs can still complete.

## Dirty working tree

`doctor` and preflight warn when there are uncommitted files outside `.agent-ledger/`. Stash, commit, or use `--fail-on-dirty` with `doctor` to fail the check in scripts.

## Invalid `work-order.json`

The interpreter is expected to write valid JSON matching the [work order schema](../src/lib/workOrderSchema.ts). If parsing fails, the error will reference Zod `prettifyError` output for the field that failed.

## Target surface (monorepos)

For multiple plausible apps (e.g. web vs mobile) and no explicit product area in the issue, add a `.agent-ledger/config.json` in the **target** repo. See [examples/agent-ledger.config.json](../examples/agent-ledger.config.json).
