import assert from "node:assert/strict";
import test from "node:test";
import { extractIssueImageReferences } from "./attachments.js";
import type { IssueContext } from "./types.js";

test("extracts markdown and html issue image references excluding AgentLedger comments", () => {
  const references = extractIssueImageReferences({
    owner: "agentledger",
    repo: "example",
    issueNumber: 1,
    title: "Image issue",
    url: "https://github.com/agentledger/example/issues/1",
    body: [
      "Here is the mockup:",
      "![desktop mock](https://github.com/user-attachments/assets/abc123)",
      '<img alt="mobile" src="https://user-images.githubusercontent.com/1/mobile.png">',
    ].join("\n"),
    comments: [
      {
        author: "human",
        createdAt: "2026-04-25T00:00:00Z",
        body: "Follow-up image ![state](https://example.com/state.webp)",
      },
      {
        author: "agentledger",
        createdAt: "2026-04-25T00:01:00Z",
        body: "## AgentLedger Interpretation\n![ignore](https://example.com/ignore.png)",
      },
    ],
  } satisfies IssueContext);

  assert.deepEqual(
    references.map((reference) => ({
      source: reference.source,
      url: reference.url,
      altText: reference.altText,
    })),
    [
      {
        source: "issue body",
        url: "https://github.com/user-attachments/assets/abc123",
        altText: "desktop mock",
      },
      {
        source: "issue body",
        url: "https://user-images.githubusercontent.com/1/mobile.png",
        altText: "mobile",
      },
      {
        source: "comment by human at 2026-04-25T00:00:00Z",
        url: "https://example.com/state.webp",
        altText: "state",
      },
    ]
  );
});
