import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z, prettifyError } from "zod";
import type { ClarityMode, InterpreterMode, RunArchive } from "./types.js";

const runMetaSchema = z
  .object({
    version: z.number().int().min(1).default(1),
    runId: z.string().min(1),
    repoPath: z.string().min(1),
    issue: z.object({
      owner: z.string().min(1),
      repo: z.string().min(1),
      issueNumber: z.number().int().positive(),
      url: z.string().min(1),
    }),
    userPrompt: z.string().min(1),
    interpreter: z.enum(["cursor", "cursor-cloud"]),
    interpreterModel: z.string().min(1),
    cursorModel: z.string().min(1),
    clarity: z.enum(["off", "auto", "required"]),
    check: z.array(z.string()),
    createdAt: z.string().min(1),
  })
  .strict();

export type RunMeta = z.infer<typeof runMetaSchema>;

export async function writeRunMeta(archive: RunArchive, meta: RunMeta): Promise<void> {
  await writeFile(archive.runMetaFile, `${JSON.stringify(meta, null, 2)}\n`);
}

export async function readRunMetaFile(filePath: string): Promise<RunMeta> {
  const raw = await readFile(filePath, "utf8");
  let data: unknown;
  try {
    data = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(
      `Failed to parse run-meta.json: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const parsed = runMetaSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Invalid run-meta.json: ${prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export function resolveArchiveDirForRunId(repoPath: string, runId: string): string {
  return path.join(repoPath, ".agent-ledger", "runs", runId);
}

export function buildRunMeta(args: {
  runId: string;
  repoPath: string;
  issue: { owner: string; repo: string; issueNumber: number; url: string };
  userPrompt: string;
  interpreter: InterpreterMode;
  interpreterModel: string;
  cursorModel: string;
  clarity: ClarityMode;
  check: string[];
}): RunMeta {
  return {
    version: 1,
    runId: args.runId,
    repoPath: args.repoPath,
    issue: args.issue,
    userPrompt: args.userPrompt,
    interpreter: args.interpreter,
    interpreterModel: args.interpreterModel,
    cursorModel: args.cursorModel,
    clarity: args.clarity,
    check: args.check,
    createdAt: new Date().toISOString(),
  };
}
