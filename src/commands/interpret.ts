import { z } from "zod";
import { runInterpretationPhase } from "../lib/pipeline.js";
import { printJson } from "../lib/cliOutput.js";
import type { BasePipelineOptions } from "../lib/types.js";

const optionsSchema = z.object({
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
});

/**
 * `interpret` — Cursor interpreter + archive + post; does not run the coding agent.
 */
export async function interpretCommand(raw: unknown) {
  const o = optionsSchema.parse(raw);
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
    doctor: o.doctor,
  };

  const result = await runInterpretationPhase(base, true);

  if (o.json) {
    printJson({
      ok: true,
      runId: result.archive.runId,
      archive: result.archive.dir,
      confidence: result.workOrder.confidence,
      blockingQuestions: result.workOrder.openQuestions,
    });
  } else {
    console.log("Interpretation only — coding agent was not run.");
    console.log(`To implement: agent-ledger execute --run-id ${result.archive.runId} --repo ${result.repoPath}`);
  }
}
