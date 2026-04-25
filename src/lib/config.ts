import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const configSchema = z
  .object({
    $schema: z.string().optional(),
    version: z.number().optional().default(1),
    targetSurface: z
      .object({
        /** Regex patterns (as strings) matched against issue title/body + human comments. */
        explicitNamePatterns: z.array(z.string()).optional(),
        /** Surfaces used when the issue does not name a target; if multiple match repo paths, the guard can add a blocking question. */
        surfaces: z
          .array(
            z.object({
              id: z.string(),
              label: z.string(),
              pathPrefixes: z.array(z.string()).optional(),
              pathIncludes: z.array(z.string()).optional(),
            })
          )
          .optional(),
      })
      .optional(),
  })
  .passthrough();

export type AgentLedgerConfig = z.infer<typeof configSchema>;

const CONFIG_FILENAMES = [".agent-ledger/config.json", ".agent-ledger/config.local.json"] as const;

/**
 * Load optional per-repo AgentLedger config from `<repo>/.agent-ledger/config.json`.
 * Missing file returns null.
 */
export async function loadAgentLedgerConfig(repoPath: string): Promise<AgentLedgerConfig | null> {
  for (const name of CONFIG_FILENAMES) {
    const file = path.join(repoPath, name);
    try {
      const raw = await readFile(file, "utf8");
      const json = JSON.parse(raw) as unknown;
      return configSchema.parse(json);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "ENOENT") {
        continue;
      }
      throw new Error(
        `Invalid AgentLedger config at ${file}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return null;
}
