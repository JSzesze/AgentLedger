import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAndValidateWorkOrder, tryParseWorkOrderJson } from "./workOrderSchema.js";

describe("workOrderSchema", () => {
  it("accepts a minimal valid work order", () => {
    const w = {
      runKey: "k",
      taskType: "t",
      interpretedGoal: "g",
      problemStatement: "p",
      acceptanceCriteria: [{ id: "AC1", text: "criterion" }],
      nonGoals: [],
      constraints: [],
      openQuestions: [],
      confidence: "medium" as const,
      implementationNotes: [],
      source: {
        issueUrl: "https://github.com/a/b/issues/1",
        issueTitle: "title",
        userPrompt: "u",
        commentsConsidered: 0,
      },
    };
    const out = parseAndValidateWorkOrder(w, "test");
    assert.equal(out.runKey, "k");
  });

  it("rejects bad confidence", () => {
    const w = {
      runKey: "k",
      taskType: "t",
      interpretedGoal: "g",
      problemStatement: "p",
      acceptanceCriteria: [],
      nonGoals: [],
      constraints: [],
      openQuestions: [],
      confidence: "nope",
      implementationNotes: [],
      source: {
        issueUrl: "https://github.com/a/b/issues/1",
        issueTitle: "t",
        userPrompt: "u",
        commentsConsidered: 0,
      },
    };
    assert.throws(() => parseAndValidateWorkOrder(w, "x"), /Invalid work order/);
  });

  it("tryParseWorkOrderJson parses a string", () => {
    const raw = `{"runKey":"r","taskType":"t","interpretedGoal":"g","problemStatement":"p","acceptanceCriteria":[],"nonGoals":[],"constraints":[],"openQuestions":[],"confidence":"high","implementationNotes":[],"source":{"issueUrl":"https://github.com/a/b/issues/1","issueTitle":"i","userPrompt":"u","commentsConsidered":0}}`;
    const w = tryParseWorkOrderJson(raw, "f");
    assert.equal(w.confidence, "high");
  });
});
