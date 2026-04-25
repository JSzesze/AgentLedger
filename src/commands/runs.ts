import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { readRunMetaFile } from "../lib/runMeta.js";

export type RunsListItem = {
  runId: string;
  mtimeMs: number;
  issueUrl?: string;
  createdAt?: string;
};

/**
 * List run directories under `.agent-ledger/runs` (newest first).
 */
export async function runsListCommand(options: {
  repo: string;
  json?: boolean;
  limit?: number;
}): Promise<void> {
  const repoPath = await realpath(options.repo);
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);
  const runsDir = path.join(repoPath, ".agent-ledger", "runs");

  let names: string[];
  try {
    names = await readdir(runsDir);
  } catch {
    if (options.json) {
      console.log(JSON.stringify({ repoPath, runs: [], message: "No .agent-ledger/runs directory." }));
    } else {
      console.log(`No .agent-ledger/runs under ${repoPath}`);
    }
    return;
  }

  const items: RunsListItem[] = [];
  for (const name of names) {
    const full = path.join(runsDir, name);
    try {
      const st = await stat(full);
      if (!st.isDirectory()) {
        continue;
      }
      const metaPath = path.join(full, "run-meta.json");
      let issueUrl: string | undefined;
      let createdAt: string | undefined;
      try {
        const meta = await readRunMetaFile(metaPath);
        issueUrl = meta.issue.url;
        createdAt = meta.createdAt;
      } catch {
        try {
          const raw = await readFile(metaPath, "utf8");
          const j = JSON.parse(raw) as { issue?: { url?: string }; createdAt?: string };
          issueUrl = typeof j.issue?.url === "string" ? j.issue.url : undefined;
          createdAt = typeof j.createdAt === "string" ? j.createdAt : undefined;
        } catch {
          // skip meta
        }
      }
      items.push({
        runId: name,
        mtimeMs: st.mtimeMs,
        issueUrl,
        createdAt,
      });
    } catch {
      // skip
    }
  }

  items.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const runs = items.slice(0, limit);

  if (options.json) {
    console.log(JSON.stringify({ repoPath, runs }, null, 2));
    return;
  }

  if (runs.length === 0) {
    console.log(`No runs under ${runsDir}`);
    return;
  }

  console.log(`Runs in ${runsDir} (newest first, max ${limit}):`);
  for (const r of runs) {
    const extra = [r.createdAt, r.issueUrl].filter(Boolean).join(" · ");
    console.log(`  ${r.runId}${extra ? `  ${extra}` : ""}`);
  }
}
