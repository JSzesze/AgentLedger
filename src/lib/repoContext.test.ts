import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execa } from "execa";
import { gatherRepoContext } from "./repoContext.js";
import type { IssueContext } from "./types.js";

test("repo reconnaissance favors strong path anchors over noisy generic content", async () => {
  const repoPath = await mkdtemp(path.join(os.tmpdir(), "agent-ledger-repo-context-"));
  await execa("git", ["init"], { cwd: repoPath });
  await mkdir(path.join(repoPath, "app/services"), { recursive: true });
  await mkdir(path.join(repoPath, "web/components/admin/rhythms"), { recursive: true });

  await writeFile(
    path.join(repoPath, "app/services/planScheduleService.ts"),
    Array.from({ length: 80 }, (_, index) => `const day${index} = "week day";`).join("\n")
  );
  await writeFile(
    path.join(repoPath, "web/components/admin/rhythms/RhythmDayRailPanel.tsx"),
    [
      "export function RhythmDayRailPanel() {",
      "  return <section>Selected rhythm day panel</section>;",
      "}",
    ].join("\n")
  );
  await execa("git", ["add", "."], { cwd: repoPath });

  const context = await gatherRepoContext({
    repoPath,
    issue: issueContext({
      title: "Update rhythm page",
      body: "Can we implement a day at a time in the rhythms panel instead of all week?",
    }),
  });

  assert.equal(context.likelyFiles[0]?.path, "web/components/admin/rhythms/RhythmDayRailPanel.tsx");
});

function issueContext(args: { title: string; body: string }): IssueContext {
  return {
    owner: "agentledger",
    repo: "example",
    issueNumber: 1,
    title: args.title,
    body: args.body,
    url: "https://github.com/agentledger/example/issues/1",
    comments: [],
  };
}
