import { appendFile } from "node:fs/promises";
import { execa } from "execa";
import type { CheckResult } from "./types.js";

export async function runChecks(
  repoPath: string,
  checks: string[],
  outputFile: string
): Promise<CheckResult[]> {
  if (checks.length === 0) {
    await appendFile(outputFile, "No checks were requested.\n");
    return [];
  }

  const results: CheckResult[] = [];

  for (const command of checks) {
    await appendFile(outputFile, `\n$ ${command}\n`);
    const startedAt = Date.now();
    const result = await execa(command, {
      cwd: repoPath,
      shell: true,
      reject: false,
      all: true,
    });
    const durationMs = Date.now() - startedAt;
    const status = result.exitCode === 0 ? "passed" : "failed";

    await appendFile(
      outputFile,
      [
        `exitCode: ${result.exitCode}`,
        `status: ${status}`,
        `durationMs: ${durationMs}`,
        "",
        result.all ?? "",
        "\n",
      ].join("\n")
    );

    results.push({
      command,
      status,
      exitCode: result.exitCode,
    });
  }

  return results;
}
