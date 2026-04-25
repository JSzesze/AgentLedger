# Roadmap

AgentLedger is evolving toward a remote-worker flow for GitHub issues:

```text
OpenClaw dispatcher -> AgentLedger interpretation/archive -> Cursor implementation -> PR/review loop
```

This roadmap tracks the staged path without pulling too much into the first iteration.

## Stage 1: Assigned remote-worker contract

**Scope:** One issue at a time for now. Trigger is explicit issue input (URL or number) plus repo path. Later, the same contract can be wired to a label (e.g. `agent-ledger`) or assignment to a bot account.

**Intake**

- OpenClaw may help the human clarify or reformulate the issue before handoff.
- AgentLedger still receives the **raw** GitHub issue body and human comments as the source of truth for interpretation.

**Interpretation**

- AgentLedger’s interpreter is the authority for confidence, blockers, acceptance criteria, and whether to stop at the clarity gate.
- If the interpreter surfaces blockers, OpenClaw tries to resolve them from the repo, docs, or existing comments first, then asks the human only when still blocked.

**Execution**

- In **assigned-worker mode**, runs are **real** by default: interpretation, coding agent, checks, and archive. Use `agent-ledger run ... --dry-run` only to **preview** the interpretation archive without launching Cursor or posting.
- Manual or review-only use of `--dry-run` remains valid; it is not the default path for an assigned worker.

**Communication (target behavior)**

- Eventually, an assigned worker should post status like a remote developer: claimed, blocked, running, completed, failed — in addition to interpretation and completion artifacts under `.agent-ledger/runs/`.

## Stage 2: Claims, branches, and PRs

Goal: prevent duplicate work and produce the normal output of a remote developer: a pull request.

- Add a claim mechanism with TTL so repeat runs do not double-start the same issue.
- Check existing AgentLedger archives for the issue.
- Check existing branches, e.g. `agent-ledger/issue-123`.
- Check existing open PRs that reference the issue.
- Create a dedicated branch before implementation.
- Commit focused changes after Cursor finishes.
- Push the branch and open a PR.
- Link PR URL, changed files, checks, summary, confidence, and risks in the issue/PR.

Open question: whether branch/PR orchestration belongs in AgentLedger directly or in OpenClaw using AgentLedger’s archive as the source of truth.

## Stage 3: Review loop

Goal: behave like a remote developer after opening the PR.

- Watch PR reviews, inline comments, and PR issue comments.
- Filter for actionable feedback.
- Ignore approvals, CI noise, and already-addressed comments.
- Hand actionable feedback back to AgentLedger/Cursor as a focused follow-up.
- Push review fixes to the same branch.
- Reply with what changed, commit SHA, and any comments that need manual judgment.

## Stage 4: QA evidence

Goal: add self-QA proof without making the initial worker flow too heavy.

- Launch a Cursor Cloud Agent against the PR for QA.
- Ask it to inspect acceptance criteria, run relevant checks, and capture screenshots/videos for user-visible changes.
- Download Cursor Cloud artifacts immediately because presigned URLs expire.
- Mirror artifacts to durable storage before posting.
- Add QA result, artifact links, tests run, and caveats to the PR and AgentLedger archive.

## Design principles

- OpenClaw owns dispatch, queueing, clarification, claims, notifications, and review/QA loops.
- AgentLedger owns issue interpretation, Cursor execution, checks, reconciliation, and durable archives.
- Cursor owns code changes.
- Raw issue context should remain available to AgentLedger; OpenClaw may clarify before handoff but should not replace the source context.
- Secrets should come from environment/config injection, not chat or hand-parsed config files.
- Keep each stage auditable in `.agent-ledger/runs/<runId>/`.
