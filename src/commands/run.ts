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

  if (o.json) {
    printJson({
      stage: "interpret",
      runId: result.archive.runId,
      archive: result.archive.dir,
      confidence: result.workOrder.confidence,
      blockingQuestions: result.workOrder.openQuestions,
      shouldStopForClarity: result.shouldStopForClarity,
      next:
        result.shouldStopForClarity
          ? "Clarity gate: reply on the issue and rerun, or change --clarity."
          : !o.yes
            ? "Re-run with --yes to run the coding agent, or use `agent-ledger execute --run-id <runId> --repo <path>`. "
            : "Running coding agent.",
    });
  } else {
    console.log(`AgentLedger run ${result.archive.runId}`);
    console.log(`Archive: ${result.archive.dir}`);
    console.log(`Interpretation confidence: ${result.workOrder.confidence}`);
  }

  if (result.shouldStopForClarity) {
    if (!o.json) {
      console.log("Cursor was not launched because AgentLedger stopped at the clarity gate.");
    }
    process.exitCode = 2;
    return;
  }

  if (o.json && !o.yes) {
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

  await runExecutionPhase({ raw: base, interpret: result });
}
