import assert from "node:assert/strict";
import test from "node:test";
import { reconcileWorkOrder } from "./workOrder.js";
import type { WorkOrder } from "./types.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("reconciliation requires implementation evidence, not transcript-only mentions", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-ledger-reconcile-"));
  const transcriptFile = path.join(dir, "transcript.md");
  const diffFile = path.join(dir, "diff.patch");
  const changedFilesFile = path.join(dir, "changed-files.txt");

  await writeFile(transcriptFile, "I handled weekly recurrence and monthly recurrence.\n");
  await writeFile(diffFile, "");
  await writeFile(changedFilesFile, "");

  const reconciliation = await reconcileWorkOrder({
    workOrder: workOrderWithCriteria([
      "User can create weekly recurring reminders.",
      "User can create monthly recurring reminders.",
    ]),
    transcriptFile,
    diffFile,
    changedFilesFile,
    checkFailed: false,
    agentFailed: false,
  });

  assert.equal(reconciliation.acceptanceCriteria[0]?.status, "needs_review");
  assert.equal(reconciliation.acceptanceCriteria[1]?.status, "needs_review");
});

function workOrderWithCriteria(criteria: string[]): WorkOrder {
  return {
    runKey: "test-run",
    taskType: "Feature implementation",
    interpretedGoal: "Add recurring reminders.",
    problemStatement: "Users need reminders to repeat.",
    acceptanceCriteria: criteria.map((text, index) => ({ id: `AC${index + 1}`, text })),
    nonGoals: [],
    constraints: [],
    openQuestions: [],
    confidence: "medium",
    implementationNotes: [],
    source: {
      issueUrl: "https://github.com/agentledger/example/issues/1",
      issueTitle: "Recurring reminders",
      userPrompt: "Fix the issue described here",
      commentsConsidered: 0,
    },
  };
}
