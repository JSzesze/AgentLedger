import { z } from "zod";
import { executeFromRunId } from "../lib/pipeline.js";
import { printJson } from "../lib/cliOutput.js";

const optionsSchema = z.object({
  runId: z.string().min(1),
  repo: z.string().min(1),
  prompt: z.string().optional(),
  check: z.array(z.string()).default([]),
  dryRun: z.boolean().optional(),
  post: z.boolean().optional(),
  cursorModel: z.string().optional(),
  verbose: z.boolean().optional(),
  json: z.boolean().optional(),
  doctor: z.boolean().optional(),
});

export async function executeCommandOnly(raw: unknown) {
  const o = optionsSchema.parse(raw);
  const result = await executeFromRunId({
    runId: o.runId,
    repo: o.repo,
    prompt: o.prompt,
    check: o.check,
    dryRun: o.dryRun,
    post: o.post,
    cursorModel: o.cursorModel,
    verbose: o.verbose,
    json: o.json,
    doctor: o.doctor,
  });
  if (o.json) {
    printJson({ command: "execute", ...result });
  }
}
