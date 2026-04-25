import { readFile, writeFile } from "node:fs/promises";
import type { Reconciliation, WorkOrder } from "./types.js";

export function formatInterpretationMarkdown(workOrder: WorkOrder) {
  return formatInterpretationMarkdownWithFooter(workOrder, "will-run");
}

function formatInterpretationMarkdownWithFooter(
  workOrder: WorkOrder,
  footer: "will-run" | "needs-clarification" | "execute-next" | "none",
  runIdForNext?: string
) {
  const footerText =
    footer === "will-run"
      ? "Cursor will now implement this interpreted scope. If this interpretation is wrong, reply on the issue and rerun AgentLedger with the updated context."
      : footer === "needs-clarification"
        ? "Cursor was not launched. Reply on the issue with clarification, then rerun AgentLedger with the updated context."
        : footer === "execute-next" && runIdForNext
          ? `Cursor was not started for the coding run. To implement this work order: \`agent-ledger execute --run-id ${runIdForNext} --repo <path-to-same-clone>\`. (Or use one-step \`agent-ledger run\` with \`--yes\` for non-interactive runs.)`
        : "";

  return `## AgentLedger Interpretation

I interpreted this issue as the following coding-agent work order.

### Task Type
${workOrder.taskType}

### Interpreted Goal
${workOrder.interpretedGoal}

### Problem
${workOrder.problemStatement}

### Repository Reconnaissance
${formatRepoEvidence(workOrder)}

### Acceptance Criteria
${workOrder.acceptanceCriteria.map((item) => `- [ ] ${item.text}`).join("\n")}

### Excluded From This Run
${formatList(workOrder.nonGoals, "_No explicit non-goals were found._")}

### Constraints
${formatList(workOrder.constraints)}

### Blocking Questions
${formatList(workOrder.openQuestions, "_None. AgentLedger recorded any non-blocking assumptions in the coding-agent instructions._")}

### Confidence
${titleCase(workOrder.confidence)}

${footerText}
`;
}

export function buildCursorPromptFromWorkOrder(workOrder: WorkOrder) {
  return `You are working from an interpreted GitHub issue.

Implement the following work order only. The structured work order is authoritative; do not expand scope based on vague issue language.

${formatInterpretationMarkdownWithFooter(workOrder, "none")}

## Coding Agent Instructions
${workOrder.implementationNotes.map((note) => `- ${note}`).join("\n")}
- Do not implement non-goals.
- If a requirement is ambiguous but not listed as a blocking question, make the smallest safe implementation and note the assumption.
- Preserve existing behavior outside this interpreted scope.
- Add or update tests when appropriate.
- Do not post to GitHub. AgentLedger owns GitHub comments.
`;
}

function resolveFooter(
  willRun: boolean | undefined,
  nextRunId?: string
): "will-run" | "needs-clarification" | "execute-next" | "none" {
  if (nextRunId) {
    return "execute-next";
  }
  if (willRun === false) {
    return "needs-clarification";
  }
  return "will-run";
}

export async function writeWorkOrderFiles(args: {
  workOrder: WorkOrder;
  interpretationFile: string;
  workOrderFile: string;
  cursorPromptFile: string;
  willRun?: boolean;
  /** If set, interpretation footer points to `agent-ledger execute` (e.g. `interpret` subcommand). */
  nextRunIdForFooter?: string;
}) {
  const footer = resolveFooter(args.willRun, args.nextRunIdForFooter);
  await Promise.all([
    writeFile(
      args.interpretationFile,
      formatInterpretationMarkdownWithFooter(
        args.workOrder,
        footer,
        args.nextRunIdForFooter
      )
    ),
    writeFile(args.workOrderFile, `${JSON.stringify(args.workOrder, null, 2)}\n`),
    writeFile(args.cursorPromptFile, buildCursorPromptFromWorkOrder(args.workOrder)),
  ]);
}

export async function reconcileWorkOrder(args: {
  workOrder: WorkOrder;
  transcriptFile: string;
  diffFile: string;
  changedFilesFile: string;
  checkFailed: boolean;
  agentFailed: boolean;
}): Promise<Reconciliation> {
  const [transcript, diff, changedFiles] = await Promise.all([
    readOptional(args.transcriptFile),
    readOptional(args.diffFile),
    readOptional(args.changedFilesFile),
  ]);
  const evidence = {
    transcript: transcript.toLowerCase(),
    diff: diff.toLowerCase(),
    changedFiles: changedFiles.toLowerCase(),
  };
  const haystack = `${evidence.transcript}\n${evidence.diff}\n${evidence.changedFiles}`;

  const acceptanceCriteria = args.workOrder.acceptanceCriteria.map((criterion) => {
    if (args.agentFailed) {
      return {
        ...criterion,
        status: "not_assessed" as const,
        evidence: "Cursor run failed before reconciliation could assess this criterion.",
      };
    }

    const keywords = meaningfulWords(criterion.text);
    const hits = keywords.filter((word) => haystack.includes(word));
    const implementationHits = keywords.filter(
      (word) => evidence.diff.includes(word) || evidence.changedFiles.includes(word)
    );
    if (
      keywords.length > 0 &&
      hits.length >= Math.min(2, keywords.length) &&
      implementationHits.length > 0
    ) {
      const sources = [
        implementationHits.length ? "diff/files" : "",
        hits.some((word) => evidence.transcript.includes(word)) ? "coding transcript" : "",
      ].filter(Boolean);
      return {
        ...criterion,
        status: "likely_matched" as const,
        evidence: `Found related ${sources.join(" and ")} evidence for: ${hits.slice(0, 5).join(", ")}.`,
      };
    }

    return {
      ...criterion,
      status: "needs_review" as const,
      evidence: implementationHits.length
        ? "Only weak implementation evidence was found; human review should confirm behavior."
        : "No implementation evidence found in changed files or diff.",
    };
  });

  const drift = detectPotentialDrift(args.workOrder, haystack);
  const reviewNotes = [
    "Automatic reconciliation is a review aid, not proof of correctness.",
    args.checkFailed
      ? "One or more checks failed; review failures before accepting the work."
      : "Review the diff against the interpreted work order before merging.",
  ];

  return {
    result: args.agentFailed
      ? "Failed"
      : args.checkFailed
        ? "Completed with check failures"
        : "Completed with review needed",
    acceptanceCriteria,
    drift,
    reviewNotes,
  };
}

export function formatReconciliationMarkdown(reconciliation: Reconciliation) {
  return `## AgentLedger Reconciliation

### Result
${reconciliation.result}

### Matched Acceptance Criteria
${reconciliation.acceptanceCriteria
  .map((item) => {
    const marker = item.status === "likely_matched" ? "[x]" : "[ ]";
    return `- ${marker} ${item.text}\n  - ${formatStatus(item.status)}: ${item.evidence}`;
  })
  .join("\n")}

### Drift / Interpretation Differences
${formatList(reconciliation.drift, "_No likely scope drift was detected automatically._")}

### Review Notes
${formatList(reconciliation.reviewNotes)}
`;
}

export async function writeReconciliationFile(file: string, reconciliation: Reconciliation) {
  await writeFile(file, formatReconciliationMarkdown(reconciliation));
}

function detectPotentialDrift(workOrder: WorkOrder, haystack: string) {
  const drift = workOrder.nonGoals
    .filter((nonGoal) => {
      const keywords = meaningfulWords(nonGoal);
      return keywords.length > 0 && keywords.some((keyword) => haystack.includes(keyword));
    })
    .map((nonGoal) => `Potential mention of non-goal in run output: ${nonGoal}`);
  return drift.slice(0, 6);
}

function isRelevantHumanComment(comment: { body: string }) {
  const body = comment.body.trim();
  return !(
    body.startsWith("## Agent Run") ||
    body.startsWith("## AgentLedger Interpretation") ||
    body.startsWith("## AgentLedger Interpretation Superseded") ||
    body.startsWith("## AgentLedger Reconciliation")
  );
}

function isGenericTitle(title: string) {
  return /^(update|fix|improve|refine|change|adjust)(\s+\w+){0,3}$/i.test(title.trim());
}

function meaningfulWords(value: string) {
  const stop = new Set([
    "and",
    "are",
    "for",
    "from",
    "into",
    "not",
    "that",
    "the",
    "this",
    "with",
    "without",
    "user",
    "users",
  ]);
  return stripMarkdown(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4 && !stop.has(word));
}

function stripMarkdown(value: string) {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

function formatList(values: string[], empty = "_None._") {
  return values.length > 0 ? values.map((value) => `- ${value}`).join("\n") : empty;
}

function formatRepoEvidence(workOrder: WorkOrder) {
  if (!workOrder.repoContext) {
    return "_Repository reconnaissance was not available._";
  }

  const findings = formatList(workOrder.repoContext.findings, "_No findings._");
  const likelyFiles =
    workOrder.repoContext.likelyFiles.length > 0
      ? workOrder.repoContext.likelyFiles.map((file) => `- \`${file}\``).join("\n")
      : "_No likely files identified._";
  const scripts =
    workOrder.repoContext.packageScripts.length > 0
      ? workOrder.repoContext.packageScripts
          .slice(0, 12)
          .map((script) => `- \`${script}\``)
          .join("\n")
      : "_No package scripts identified._";

  return `**Findings**
${findings}

**Likely Files**
${likelyFiles}

**Relevant Scripts**
${scripts}`;
}

function formatStatus(status: string) {
  return status.replace(/_/g, " ");
}

function titleCase(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

async function readOptional(file: string) {
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}
