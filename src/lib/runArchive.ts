import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { IssueContext, RunArchive } from "./types.js";

export function buildRunArchivePaths(repoPath: string, runId: string): RunArchive {
  const dir = path.join(repoPath, ".agent-ledger", "runs", runId);
  return {
    runId,
    dir,
    runMetaFile: path.join(dir, "run-meta.json"),
    attachmentsDir: path.join(dir, "attachments"),
    attachmentsManifestFile: path.join(dir, "attachments.json"),
    issueFile: path.join(dir, "issue.md"),
    repoContextFile: path.join(dir, "repo-context.md"),
    repoContextJsonFile: path.join(dir, "repo-context.json"),
    interpretationFile: path.join(dir, "interpretation.md"),
    workOrderFile: path.join(dir, "work-order.json"),
    cursorPromptFile: path.join(dir, "cursor-prompt.md"),
    promptFile: path.join(dir, "prompt.md"),
    cursorInterpreterAgentFile: path.join(dir, "cursor-interpreter-agent.json"),
    interpreterEventsFile: path.join(dir, "interpreter-events.jsonl"),
    interpreterTranscriptFile: path.join(dir, "interpreter-transcript.md"),
    interpreterToolCallsFile: path.join(dir, "interpreter-tool-calls.jsonl"),
    cursorAgentFile: path.join(dir, "cursor-agent.json"),
    eventsFile: path.join(dir, "events.jsonl"),
    transcriptFile: path.join(dir, "transcript.md"),
    toolCallsFile: path.join(dir, "tool-calls.jsonl"),
    gitStatusBeforeFile: path.join(dir, "git-status-before.txt"),
    gitStatusAfterFile: path.join(dir, "git-status-after.txt"),
    changedFilesFile: path.join(dir, "changed-files.txt"),
    diffFile: path.join(dir, "diff.patch"),
    checksFile: path.join(dir, "checks.log"),
    reconciliationFile: path.join(dir, "reconciliation.md"),
    summaryFile: path.join(dir, "summary.md"),
    githubCommentsFile: path.join(dir, "github-comments.json"),
  };
}

export async function createRunArchive(repoPath: string, issue: IssueContext): Promise<RunArchive> {
  const runId = `${formatTimestamp(new Date())}-issue-${issue.issueNumber}`;
  const paths = buildRunArchivePaths(repoPath, runId);
  await mkdir(paths.dir, { recursive: true });
  return paths;
}

export async function initializeArchiveFiles(archive: RunArchive) {
  await mkdir(archive.attachmentsDir, { recursive: true });
  await Promise.all([
    writeFile(archive.attachmentsManifestFile, "[]\n"),
    writeFile(archive.interpreterEventsFile, ""),
    writeFile(archive.interpreterTranscriptFile, ""),
    writeFile(archive.interpreterToolCallsFile, ""),
    writeFile(archive.cursorInterpreterAgentFile, "{}\n"),
    writeFile(archive.eventsFile, ""),
    writeFile(archive.transcriptFile, ""),
    writeFile(archive.toolCallsFile, ""),
    writeFile(archive.cursorAgentFile, "{}\n"),
    writeFile(archive.checksFile, ""),
    writeFile(archive.githubCommentsFile, "[]\n"),
  ]);
}

export async function appendJsonLine(file: string, value: unknown) {
  await appendFile(file, `${JSON.stringify(value)}\n`);
}

export function formatIssueMarkdown(
  issue: IssueContext,
  options: { includeAgentLedgerComments?: boolean } = {}
) {
  const relevantComments =
    options.includeAgentLedgerComments === false
      ? issue.comments.filter((comment) => !isAgentLedgerComment(comment.body))
      : issue.comments;
  const comments = relevantComments.length
    ? relevantComments
        .map(
          (comment) =>
            `### ${comment.author} at ${comment.createdAt}\n\n${comment.body || "_No body._"}`
        )
        .join("\n\n")
    : "_No comments._";

  return `# ${issue.title}

${issue.url}

## Body

${issue.body || "_No body._"}

## Comments

${comments}
`;
}

export function isAgentLedgerComment(body: string) {
  return body.trim().startsWith("## AgentLedger Interpretation");
}

export function formatPromptMarkdown(prompt: string) {
  return `# Agent Prompt

${prompt}
`;
}

function formatTimestamp(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}
