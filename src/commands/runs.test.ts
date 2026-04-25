import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { runsListCommand } from "./runs.js";

const MIN_RUN_META = {
  version: 1,
  runId: "run-a",
  repoPath: "/tmp",
  issue: {
    owner: "o",
    repo: "r",
    issueNumber: 1,
    url: "https://github.com/o/r/issues/1",
  },
  userPrompt: "p",
  interpreter: "cursor" as const,
  interpreterModel: "m1",
  cursorModel: "m2",
  clarity: "off" as const,
  check: [] as string[],
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("runsListCommand", () => {
  let tmpRoot: string | undefined;

  it("lists run directories and returns json with mtime and meta", async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "al-runs-test-"));
    const base = await realpath(tmpRoot);
    const runDir = join(base, ".agent-ledger", "runs", "20260102-issue-1");
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, "run-meta.json"), `${JSON.stringify({ ...MIN_RUN_META, runId: "20260102-issue-1" }, null, 2)}\n`, "utf8");

    const lines: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(
        args
          .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
          .join(" ")
      );
    };
    try {
      await runsListCommand({ repo: base, json: true, limit: 10 });
    } finally {
      console.log = orig;
    }

    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]!) as {
      repoPath: string;
      runs: Array<{ runId: string; mtimeMs: number; issueUrl?: string }>;
    };
    assert.equal(parsed.runs.length, 1);
    assert.equal(parsed.runs[0]!.runId, "20260102-issue-1");
    assert.equal(parsed.runs[0]!.issueUrl, "https://github.com/o/r/issues/1");
  });

  after(async () => {
    if (tmpRoot) {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });
});
