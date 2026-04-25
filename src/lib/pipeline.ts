import { createInterface } from "node:readline/promises";
import { readFile, realpath, writeFile, mkdir } from "node:fs/promises";
import { stdin as input, stdout as output } from "node:process";
import { existsSync } from "node:fs";
import path from "node:path";
import { execa } from "execa";
import {
  collectIssueAttachments,
  formatAttachmentsMarkdown,
  loadCursorImages,
} from "./attachments.js";
import { runChecks } from "./checks.js";
import { runCursorAgent, runCursorCloudInterpreter, runCursorInterpreter } from "./cursor.js";
import { loadAgentLedgerConfig } from "./config.js";
import { runPreflight, printPreflightHuman } from "./preflight.js";
import { buildRunMeta, readRunMetaFile, writeRunMeta } from "./runMeta.js";
import { captureChangedFiles, captureDiff, captureGitStatus } from "./git.js";
import {
  getIssueContext,
  hasGithubCommentLogType,
  postIssueComment,
  resolveIssueRef,
  writeGithubCommentLog,
  hasAgentLedgerInterpretationComment,
} from "./github.js";
import { gatherRepoContext, writeRepoContextFiles } from "./repoContext.js";
import {
  buildRunArchivePaths,
  createRunArchive,
  formatIssueMarkdown,
  formatPromptMarkdown,
  initializeArchiveFiles,
} from "./runArchive.js";
import { writeSummary } from "./summary.js";
import type { CursorRunResult, RunArchive, WorkOrder, IssueContext, InterpreterMode } from "./types.js";
import {
  buildCursorPromptFromWorkOrder,
  reconcileWorkOrder,
  writeReconciliationFile,
  writeWorkOrderFiles,
} from "./workOrder.js";
import { tryParseWorkOrderJson } from "./workOrderSchema.js";
import type { BasePipelineOptions } from "./types.js";
import { z } from "zod";

const baseSchema = z.object({
  issue: z.string().min(1),
  repo: z.string().min(1),
  prompt: z.string().min(1),
  check: z.array(z.string()).default([]),
  dryRun: z.boolean().optional(),
  post: z.boolean().optional(),
  runtime: z.enum(["local", "cloud"]).default("local"),
  clarity: z.enum(["off", "auto", "required"]).default("auto"),
  interpreter: z.enum(["cursor", "cursor-cloud"]).default("cursor"),
  interpreterModel: z.string().min(1).default("composer-2"),
  cursorModel: z.string().min(1).default("composer-2"),
  branch: z.string().optional(),
  verbose: z.boolean().optional(),
  json: z.boolean().optional(),
  doctor: z.boolean().optional(),
  yes: z.boolean().optional(),
});

export type InterpretPipelineResult = {
  type: "interpret";
  workOrder: WorkOrder;
  archive: RunArchive;
  issue: Awaited<ReturnType<typeof getIssueContext>>;
  repoPath: string;
  shouldStopForClarity: boolean;
  preflight?: Awaited<ReturnType<typeof runPreflight>>;
  postStatus: CommentPostStatus;
};

export type CommentPostStatus = "posted" | "skipped_dry_run" | "skipped_no_post" | "skipped_duplicate";

export type ExecutionPipelineResult = {
  ok: boolean;
  summaryFile: string;
  agentFailed: boolean;
  checkFailed: boolean;
  failureReason?: string;
  postStatus: CommentPostStatus;
};

/**
 * Run optional doctor, then create archive, gather context, and run Cursor interpreter only.
 * @param interpretOnly - if true, interpretation footer points to `execute` (e.g. `agent-ledger interpret`); does not affect Cursor interpreter behavior.
 */
export async function runInterpretationPhase(
  raw: BasePipelineOptions,
  interpretOnly = false
): Promise<InterpretPipelineResult> {
  const options = baseSchema.parse(raw);
  if (options.runtime !== "local") {
    throw new Error("Only --runtime local is implemented.");
  }

  const repoPath = await realpath(options.repo);
  let preflight: Awaited<ReturnType<typeof runPreflight>> | undefined;
  if (options.doctor !== false) {
    const pre = await runPreflight({ issue: options.issue, repo: repoPath });
    preflight = pre;
    if (!options.json) {
      printPreflightHuman(pre);
    }
    if (!pre.ok) {
      const err = new Error("Pre-flight checks failed. Fix the issues above and retry.");
      (err as Error & { exitCode: number }).exitCode = 1;
      throw err;
    }
  }

  await assertGitRepo(repoPath);
  const issueRef = await resolveIssueRef(options.issue, repoPath);
  const issue = await getIssueContext(issueRef);
  const config = await loadAgentLedgerConfig(repoPath);

  const archive = await createRunArchive(repoPath, issue);
  await mkdir(archive.dir, { recursive: true });
  await initializeArchiveFiles(archive);
  const attachments = await collectIssueAttachments({ issue, archive });
  const cursorImages = await loadCursorImages(attachments);

  const repoContext = await gatherRepoContext({ repoPath, issue });
  const workOrder = await buildWorkOrderWithConfig({
    mode: options.interpreter,
    issue,
    repoContext,
    userPrompt: options.prompt,
    runKey: archive.runId,
    interpreterModel: options.interpreterModel,
    repoPath,
    archive,
    images: cursorImages,
    verbose: options.verbose,
    config,
  });

  const shouldStopForClarity =
    !interpretOnly &&
    (options.clarity === "required" || (options.clarity === "auto" && workOrder.confidence === "low"));

  const agentPrompt = buildCursorPromptFromWorkOrder(workOrder);
  await Promise.all([
    writeFile(
      archive.issueFile,
      `${formatIssueMarkdown(issue)}\n${formatAttachmentsMarkdown(attachments)}`
    ),
    writeRepoContextFiles({
      repoContext,
      markdownFile: archive.repoContextFile,
      jsonFile: archive.repoContextJsonFile,
    }),
    writeFile(archive.promptFile, formatPromptMarkdown(agentPrompt)),
    writeWorkOrderFiles({
      workOrder,
      interpretationFile: archive.interpretationFile,
      workOrderFile: archive.workOrderFile,
      cursorPromptFile: archive.cursorPromptFile,
      willRun: interpretOnly || options.dryRun ? false : !shouldStopForClarity,
      nextRunIdForFooter: interpretOnly || options.dryRun ? archive.runId : undefined,
    }),
    captureGitStatus(repoPath, archive.gitStatusBeforeFile),
  ]);

  const meta = buildRunMeta({
    runId: archive.runId,
    repoPath,
    issue: { owner: issue.owner, repo: issue.repo, issueNumber: issue.issueNumber, url: issue.url },
    userPrompt: options.prompt,
    interpreter: options.interpreter,
    interpreterModel: options.interpreterModel,
    cursorModel: options.cursorModel,
    clarity: options.clarity,
    check: options.check,
  });
  await writeRunMeta(archive, meta);

  let postStatus: CommentPostStatus = options.dryRun
    ? "skipped_dry_run"
    : options.post === false
      ? "skipped_no_post"
      : "posted";
  if (postStatus === "posted") {
    const duplicateWarning = hasAgentLedgerInterpretationComment(issue);
    if (duplicateWarning && !options.json) {
      console.warn("Warning: the issue already has an AgentLedger interpretation comment. This run will add another.");
    }
    if (await hasGithubCommentLogType(archive.githubCommentsFile, "interpretation")) {
      postStatus = "skipped_duplicate";
    } else {
      await postIssueComment({
        owner: issue.owner,
        repo: issue.repo,
        issueNumber: issue.issueNumber,
        bodyFile: archive.interpretationFile,
      });
      await writeGithubCommentLog(archive.githubCommentsFile, [
        {
          type: "interpretation",
          bodyFile: archive.interpretationFile,
          postedAt: new Date().toISOString(),
        },
      ]);
    }
  }

  if (!options.json) {
    console.log(`AgentLedger run ${archive.runId}`);
    console.log(`Archive: ${archive.dir}`);
    console.log(`Interpretation confidence: ${workOrder.confidence}`);
  }

  return {
    type: "interpret",
    workOrder,
    archive,
    issue,
    repoPath,
    shouldStopForClarity: interpretOnly ? true : shouldStopForClarity,
    preflight,
    postStatus,
  };
}

/**
 * After `interpret`, run coding agent, checks, reconciliation, summary, optional post.
 */
export async function runExecutionPhase(args: {
  raw: BasePipelineOptions;
  interpret: Pick<InterpretPipelineResult, "workOrder" | "archive" | "issue" | "repoPath">;
}): Promise<ExecutionPipelineResult> {
  const options = baseSchema.parse(args.raw);
  return await runCodingAndReportPhase({
    options,
    workOrder: args.interpret.workOrder,
    archive: args.interpret.archive,
    issue: args.interpret.issue,
    repoPath: args.interpret.repoPath,
  });
}

async function runCodingAndReportPhase(args: {
  options: z.infer<typeof baseSchema>;
  workOrder: WorkOrder;
  archive: RunArchive;
  issue: IssueContext;
  repoPath: string;
}): Promise<ExecutionPipelineResult> {
  const options = args.options;
  const { workOrder, archive, issue, repoPath } = args;

  const preAttach = await collectIssueAttachments({ issue, archive });
  const cursorImages = await loadCursorImages(preAttach);

  const agentPrompt = buildCursorPromptFromWorkOrder(workOrder);
  let cursorResult: CursorRunResult | undefined;
  let failureReason: string | undefined;
  try {
    cursorResult = await runCursorAgent({
      repoPath,
      prompt: agentPrompt,
      archive,
      model: options.cursorModel,
      images: cursorImages,
      verbose: options.verbose,
    });
  } catch (error) {
    failureReason = error instanceof Error ? error.message : String(error);
    if (!options.json) {
      console.error(`Cursor run failed: ${failureReason}`);
    }
  }

  await Promise.all([
    captureGitStatus(repoPath, archive.gitStatusAfterFile),
    captureChangedFiles(repoPath, archive.changedFilesFile),
    captureDiff(repoPath, archive.diffFile),
  ]);

  const checkResults = await runChecks(repoPath, options.check, archive.checksFile);
  const agentFailed = Boolean(failureReason);
  const checkFailed = checkResults.some((r) => r.status === "failed");
  const reconciliation = await reconcileWorkOrder({
    workOrder,
    transcriptFile: archive.transcriptFile,
    diffFile: archive.diffFile,
    changedFilesFile: archive.changedFilesFile,
    checkFailed,
    agentFailed,
  });
  await writeReconciliationFile(archive.reconciliationFile, reconciliation);

  await writeSummary({
    archive,
    issue,
    task: workOrder.interpretedGoal,
    workOrder,
    reconciliation,
    cursorResult,
    checks: checkResults,
    agentFailed,
    failureReason,
  });

  const completionType = agentFailed ? "failed" : checkFailed ? "completed_with_check_failures" : "completed";
  let postStatus: CommentPostStatus = options.dryRun
    ? "skipped_dry_run"
    : options.post === false
      ? "skipped_no_post"
      : "posted";
  if (postStatus === "posted") {
    const completionTypes = ["failed", "completed_with_check_failures", "completed"];
    const alreadyPosted = (
      await Promise.all(
        completionTypes.map((type) => hasGithubCommentLogType(archive.githubCommentsFile, type))
      )
    ).some(Boolean);
    if (alreadyPosted) {
      postStatus = "skipped_duplicate";
    } else {
      await postIssueComment({
        owner: issue.owner,
        repo: issue.repo,
        issueNumber: issue.issueNumber,
        bodyFile: archive.summaryFile,
      });
      await writeGithubCommentLog(archive.githubCommentsFile, [
        {
          type: completionType,
          bodyFile: archive.summaryFile,
          postedAt: new Date().toISOString(),
        },
      ]);
    }
  }

  if (!options.json) {
    console.log(`Summary: ${archive.summaryFile}`);
  }

  if (agentFailed || checkFailed) {
    process.exitCode = 1;
  }
  return {
    ok: !agentFailed && !checkFailed,
    summaryFile: archive.summaryFile,
    agentFailed,
    checkFailed,
    failureReason,
    postStatus,
  };
}

export async function maybePromptContinue(args: { json?: boolean; yes?: boolean }): Promise<boolean> {
  if (args.json || args.yes) {
    return true;
  }
  if (!input.isTTY) {
    throw new Error(
      "Not running in a TTY: pass --yes to continue to the coding run, or use `agent-ledger execute --run-id ...`."
    );
  }
  const rl = createInterface({ input, output, terminal: true });
  const answer = await rl.question("Launch Cursor to implement this work order? [y/N] ");
  rl.close();
  const a = answer.trim().toLowerCase();
  return a === "y" || a === "yes";
}

/**
 * Load `work-order.json` and `run-meta.json` from a prior `interpret` run, then run the coding agent.
 */
export async function executeFromRunId(args: {
  runId: string;
  repo: string;
  /** Override work-order user prompt in coding run (rare). */
  prompt?: string;
  check: string[];
  dryRun?: boolean;
  post?: boolean;
  cursorModel?: string;
  verbose?: boolean;
  json?: boolean;
  doctor?: boolean;
}): Promise<{
  ok: boolean;
  runId: string;
  archive: string;
  repoPath: string;
  dryRun: boolean;
  preflight?: Awaited<ReturnType<typeof runPreflight>>;
  execution?: ExecutionPipelineResult;
  next?: string;
}> {
  const repoPath = await realpath(args.repo);
  const archive = buildRunArchivePaths(repoPath, args.runId);
  if (!existsSync(archive.runMetaFile) || !existsSync(archive.workOrderFile)) {
    throw new Error(
      `No AgentLedger run found at ${archive.dir}. Check --run-id and --repo, or run \`agent-ledger interpret\` first.`
    );
  }
  let preflight: Awaited<ReturnType<typeof runPreflight>> | undefined;
  if (args.doctor !== false) {
    const metaPreview = await readRunMetaFile(archive.runMetaFile);
    const issueUrl = `https://github.com/${metaPreview.issue.owner}/${metaPreview.issue.repo}/issues/${metaPreview.issue.issueNumber}`;
    const pre = await runPreflight({ issue: issueUrl, repo: repoPath });
    preflight = pre;
    if (!args.json) {
      printPreflightHuman(pre);
    }
    if (!pre.ok) {
      const err = new Error("Pre-flight checks failed.");
      (err as Error & { exitCode: number }).exitCode = 1;
      throw err;
    }
  }

  const meta = await readRunMetaFile(archive.runMetaFile);
  if (path.resolve(meta.repoPath) !== path.resolve(repoPath)) {
    if (!args.json) {
      console.warn(
        `Warning: run-meta.json repoPath (${meta.repoPath}) differs from --repo (${repoPath}). Using current --repo.`
      );
    }
  }

  const issue = await getIssueContext({
    owner: meta.issue.owner,
    repo: meta.issue.repo,
    issueNumber: meta.issue.issueNumber,
  });
  const raw = await readFile(archive.workOrderFile, "utf8");
  const workOrder = tryParseWorkOrderJson(raw, archive.workOrderFile);

  const options = baseSchema.parse({
    issue: issue.url,
    repo: args.repo,
    prompt: args.prompt?.trim() ? args.prompt : meta.userPrompt,
    check: args.check.length > 0 ? args.check : meta.check,
    dryRun: args.dryRun,
    post: args.post,
    runtime: "local",
    clarity: meta.clarity,
    interpreter: meta.interpreter,
    interpreterModel: meta.interpreterModel,
    cursorModel: args.cursorModel?.trim() ? args.cursorModel : meta.cursorModel,
    verbose: args.verbose,
    json: args.json,
    doctor: false,
  });

  if (!args.json) {
    console.log(`Resuming run ${args.runId}`);
    console.log(`Archive: ${archive.dir}`);
  }

  if (args.dryRun) {
    if (!args.json) {
      console.log("Dry run: coding agent, checks, and GitHub posting were skipped.");
      console.log(`When ready: agent-ledger execute --run-id ${args.runId} --repo ${repoPath}`);
    }
    return {
      ok: true,
      runId: args.runId,
      archive: archive.dir,
      repoPath,
      dryRun: true,
      preflight,
      next: `agent-ledger execute --run-id ${args.runId} --repo ${repoPath}`,
    };
  }

  const execution = await runCodingAndReportPhase({ options, workOrder, archive, issue, repoPath });
  return {
    ok: execution.ok,
    runId: args.runId,
    archive: archive.dir,
    repoPath,
    dryRun: false,
    preflight,
    execution,
  };
}

async function buildWorkOrderWithConfig(args: {
  mode: InterpreterMode;
  issue: IssueContext;
  repoContext: Awaited<ReturnType<typeof gatherRepoContext>>;
  userPrompt: string;
  runKey: string;
  interpreterModel: string;
  repoPath: string;
  archive: RunArchive;
  images: Awaited<ReturnType<typeof loadCursorImages>>;
  verbose?: boolean;
  config: Awaited<ReturnType<typeof loadAgentLedgerConfig>>;
}): Promise<WorkOrder> {
  if (args.mode === "cursor") {
    return runCursorInterpreter({
      repoPath: args.repoPath,
      issue: args.issue,
      repoContext: args.repoContext,
      archive: args.archive,
      userPrompt: args.userPrompt,
      runKey: args.runKey,
      model: args.interpreterModel,
      images: args.images,
      verbose: args.verbose,
      config: args.config,
    });
  }
  if (args.mode === "cursor-cloud") {
    return runCursorCloudInterpreter({
      issue: args.issue,
      repoContext: args.repoContext,
      archive: args.archive,
      userPrompt: args.userPrompt,
      runKey: args.runKey,
      model: args.interpreterModel,
      images: args.images,
      verbose: args.verbose,
      config: args.config,
    });
  }
  throw new Error(`Unsupported interpreter mode: ${args.mode}`);
}

async function assertGitRepo(repoPath: string) {
  await execa("git", ["rev-parse", "--show-toplevel"], { cwd: repoPath });
}