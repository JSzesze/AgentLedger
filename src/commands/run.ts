import { z } from "zod";
import {
  runInterpretationPhase,
  runExecutionPhase,
  maybePromptContinue,
} from "../lib/pipeline.js";
import { printJson } from "../lib/cliOutput.js";
import type { BasePipelineOptions, RunCommandOptions } from "../lib/types.js";

const runSchema = z.object({
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
  /** false when using --no-doctor */
  doctor: z.boolean().optional(),
  yes: z.boolean().optional(),
});

/**
 * Full pipeline: preflight, interpret, optional approval, coding agent, reconciliation, post.
 */
export async function runCommand(raw: RunCommandOptions) {
  const o = runSchema.parse(raw);
  if (o.runtime !== "local") {
    throw new Error("Only --runtime local is implemented.");
  }

  const base: BasePipelineOptions = {
    issue: o.issue,
    repo: o.repo,
    prompt: o.prompt,
    check: o.check,
    dryRun: o.dryRun,
    post: o.post,
    runtime: o.runtime,
    branch: o.branch,
    verbose: o.verbose,
    clarity: o.clarity,
    interpreter: o.interpreter,
    interpreterModel: o.interpreterModel,
    cursorModel: o.cursorModel,
    json: o.json,
    doctor: o.doctor !== false,
    yes: o.yes,
  };

  const result = await runInterpretationPhase(base, false);

  // In JSON mode, emit one document at the end so scripts can parse stdout directly.

  if (result.shouldStopForClarity) {
    if (o.json) {
      printJson({
        ok: true,
        command: "run",
        runId: result.archive.runId,
        archive: result.archive.dir,
        repoPath: result.repoPath,
        dryRun: Boolean(o.dryRun),
        preflight: result.preflight,
        interpretation: {
          confidence: result.workOrder.confidence,
          blockingQuestions: result.workOrder.openQuestions,
          shouldStopForClarity: true,
          postStatus: result.postStatus,
        },
        execution: null,
        next: "Clarity gate: reply on the issue and rerun, or change --clarity.",
      });
    }
    if (!o.json) {
      console.log("Cursor was not launched because AgentLedger stopped at the clarity gate.");
    }
    process.exitCode = 2;
    return;
  }

  if (o.dryRun) {
    const next = `agent-ledger execute --run-id ${result.archive.runId} --repo ${result.repoPath}`;
    if (o.json) {
      printJson({
        ok: true,
        command: "run",
        runId: result.archive.runId,
        archive: result.archive.dir,
        repoPath: result.repoPath,
        dryRun: true,
        preflight: result.preflight,
        interpretation: {
          confidence: result.workOrder.confidence,
          blockingQuestions: result.workOrder.openQuestions,
          shouldStopForClarity: false,
          postStatus: result.postStatus,
        },
        execution: null,
        next,
      });
    } else {
      console.log("Dry run: coding agent, checks, and GitHub posting were skipped.");
      console.log(`When ready: ${next}`);
    }
    return;
  }

  if (o.json && !o.yes) {
    printJson({
      ok: true,
      command: "run",
      runId: result.archive.runId,
      archive: result.archive.dir,
      repoPath: result.repoPath,
      dryRun: false,
      preflight: result.preflight,
      interpretation: {
        confidence: result.workOrder.confidence,
        blockingQuestions: result.workOrder.openQuestions,
        shouldStopForClarity: false,
        postStatus: result.postStatus,
      },
      execution: null,
      next: "Re-run with --yes to run the coding agent, or use `agent-ledger execute --run-id <runId> --repo <path>`.",
    });
    return;
  }

  if (!o.yes) {
    const cont = await maybePromptContinue({ json: false, yes: false });
    if (!cont) {
      if (!o.json) {
        console.log(
          `Aborted. When ready: agent-ledger execute --run-id ${result.archive.runId} --repo ${result.repoPath}`
        );
      }
      return;
    }
  }

  const execution = await runExecutionPhase({ raw: base, interpret: result });
  if (o.json) {
    printJson({
      ok: execution.ok,
      command: "run",
      runId: result.archive.runId,
      archive: result.archive.dir,
      repoPath: result.repoPath,
      dryRun: false,
      preflight: result.preflight,
      interpretation: {
        confidence: result.workOrder.confidence,
        blockingQuestions: result.workOrder.openQuestions,
        shouldStopForClarity: false,
        postStatus: result.postStatus,
      },
      execution,
    });
  }
}
