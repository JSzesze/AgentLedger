import { z } from "zod";
import { runPreflight, printPreflightHuman } from "../lib/preflight.js";
import { printJson } from "../lib/cliOutput.js";
import { realpath } from "node:fs/promises";

const optionsSchema = z.object({
  issue: z.string().optional(),
  repo: z.string().optional(),
  failOnDirty: z.boolean().optional(),
  json: z.boolean().optional(),
});

export async function doctorCommand(raw: unknown) {
  const options = optionsSchema.parse(raw);
  const repo = options.repo ? await realpath(options.repo) : undefined;
  const pre = await runPreflight({
    issue: options.issue,
    repo,
    failOnDirty: options.failOnDirty,
  });
  if (options.json) {
    printJson({ ok: pre.ok, checks: pre.checks });
  } else {
    printPreflightHuman(pre);
  }
  if (!pre.ok) {
    process.exitCode = 1;
  }
}
