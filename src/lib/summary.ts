import { readFile, writeFile } from "node:fs/promises";
import type {
  CheckResult,
  CursorRunResult,
  IssueContext,
  Reconciliation,
  RunArchive,
  WorkOrder,
} from "./types.js";

export async function buildStartedComment(args: {
  issue: IssueContext;
  archive: RunArchive;
  task: string;
  branch?: string;
  repoPath: string;
}) {
  return `## Agent Run Started

**Task:** ${args.task}
**Run ID:** \`${args.archive.runId}\`
**Runtime:** Cursor local agent
**Repo:** \`${args.issue.owner}/${args.issue.repo}\`
${args.branch ? `**Branch:** \`${args.branch}\`\n` : ""}**Started:** ${new Date().toLocaleString()}

### Issue Context Used
- Issue title and body
- Existing issue comments
- Current local repository state

### Instructions Sent to Coding Agent
The agent was asked to inspect the repo, fix the issue, keep the change focused, and add/update tests where appropriate.

AgentLedger will post a completion or failure report when the run finishes.
`;
}

export async function writeSummary(args: {
  archive: RunArchive;
  issue: IssueContext;
  task: string;
  workOrder: WorkOrder;
  reconciliation: Reconciliation;
  cursorResult?: CursorRunResult;
  checks: CheckResult[];
  agentFailed: boolean;
  failureReason?: string;
}) {
  const [changedFilesRaw, transcriptRaw] = await Promise.all([
    readOptional(args.archive.changedFilesFile),
    readOptional(args.archive.transcriptFile),
  ]);

  const changedFiles = changedFilesRaw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const transcriptExcerpt = excerpt(transcriptRaw);
  const checksMarkdown = formatChecks(args.checks);
  const status = args.agentFailed
    ? "Failed"
    : checksHaveFailures(args.checks)
      ? "Completed with check failures"
      : "Completed";
  const title = args.agentFailed ? "Agent Run Failed" : "Agent Run Complete";

  const summary = `## ${title}

**Run ID:** \`${args.archive.runId}\`
**Status:** ${status}
${args.cursorResult?.durationMs ? `**Duration:** ${formatDuration(args.cursorResult.durationMs)}\n` : ""}
${formatCursorGit(args.cursorResult)}
### Task
${args.task}

### Issue
[${args.issue.title}](${args.issue.url})

### Summary
${buildDeterministicImplementationSummary(changedFiles, transcriptExcerpt, args.failureReason)}

### Interpreted Work Order
**Task Type:** ${args.workOrder.taskType}
**Confidence:** ${titleCase(args.workOrder.confidence)}

### Matched Acceptance Criteria
${formatReconciledCriteria(args.reconciliation)}

### Drift / Interpretation Differences
${formatDrift(args.reconciliation)}

### Files Changed
${changedFiles.length ? changedFiles.map((file) => `- \`${file}\``).join("\n") : "_No tracked diff files were changed._"}

### Checks
${checksMarkdown}

### Human Review Needed
- Review the diff and validate behavior before merging.
- Confirm any failed or skipped checks before handing this work off.

### Paper Trail
Interpretation, work order, reconciliation, raw run logs, transcript, checks, and diff were saved under \`${args.archive.dir}\`.
`;

  await writeFile(args.archive.summaryFile, summary);
  return summary;
}

function buildDeterministicImplementationSummary(
  changedFiles: string[],
  transcriptExcerpt: string,
  failureReason?: string
) {
  if (failureReason) {
    return `The run did not complete successfully. Failure point: ${failureReason}`;
  }

  if (transcriptExcerpt) {
    return `Cursor produced the following relevant transcript excerpt:\n\n> ${transcriptExcerpt.replace(/\n/g, "\n> ")}`;
  }

  if (changedFiles.length > 0) {
    return `The run changed ${changedFiles.length} tracked file${changedFiles.length === 1 ? "" : "s"}. Review the saved diff for implementation details.`;
  }

  return "The run completed, but AgentLedger did not detect tracked file changes in the git diff.";
}

function formatChecks(checks: CheckResult[]) {
  if (checks.length === 0) {
    return "_No checks were requested._";
  }

  return checks
    .map((check) => {
      const icon = check.status === "passed" ? "PASS" : check.status === "failed" ? "FAIL" : "SKIP";
      const exitCode = typeof check.exitCode === "number" ? ` (exit ${check.exitCode})` : "";
      return `- \`${check.command}\` ${icon}${exitCode}`;
    })
    .join("\n");
}

function formatReconciledCriteria(reconciliation: Reconciliation) {
  if (reconciliation.acceptanceCriteria.length === 0) {
    return "_No acceptance criteria were generated._";
  }

  return reconciliation.acceptanceCriteria
    .map((item) => {
      const marker = item.status === "likely_matched" ? "[x]" : "[ ]";
      return `- ${marker} ${item.text}`;
    })
    .join("\n");
}

function formatDrift(reconciliation: Reconciliation) {
  return reconciliation.drift.length > 0
    ? reconciliation.drift.map((item) => `- ${item}`).join("\n")
    : "_No likely scope drift was detected automatically._";
}

function checksHaveFailures(checks: CheckResult[]) {
  return checks.some((check) => check.status === "failed");
}

function formatCursorGit(cursorResult?: CursorRunResult) {
  const git = cursorResult?.git;
  if (!git || typeof git !== "object") {
    return "";
  }

  const details = git as { branch?: unknown; repos?: Array<{ prUrl?: unknown; url?: unknown }> };
  const lines: string[] = [];
  if (typeof details.branch === "string" && details.branch) {
    lines.push(`**Cursor Branch:** \`${details.branch}\``);
  }
  const prUrls = details.repos
    ?.map((repo) => repo.prUrl)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  if (prUrls?.length) {
    lines.push(`**Cursor PR:** ${prUrls.join(", ")}`);
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}

function excerpt(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length > 500 ? `${normalized.slice(0, 497)}...` : normalized;
}

async function readOptional(file: string) {
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

function formatDuration(ms: number) {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function titleCase(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
