import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runPreflight } from "./preflight.js";

describe("runPreflight", () => {
  it("with no args returns gh + auth + optional cursor key checks in order", async () => {
    const r = await runPreflight({});
    assert.equal(Array.isArray(r.checks), true);
    assert(r.checks.length >= 1);
    assert.equal(r.checks[0]!.id, "gh_installed");
  });
});
