import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execa } from "execa";
import { captureChangedFiles, captureDiff } from "./git.js";

test("git capture includes staged and untracked files", async () => {
  const repoPath = await mkdtemp(path.join(os.tmpdir(), "agent-ledger-git-"));
  await execa("git", ["init"], { cwd: repoPath });
  await writeFile(path.join(repoPath, "existing.txt"), "original\n");
  await execa("git", ["add", "existing.txt"], { cwd: repoPath });
  await execa(
    "git",
    ["-c", "user.name=AgentLedger", "-c", "user.email=agentledger@example.com", "commit", "-m", "initial"],
    { cwd: repoPath }
  );

  await writeFile(path.join(repoPath, "existing.txt"), "changed\n");
  await execa("git", ["add", "existing.txt"], { cwd: repoPath });
  await writeFile(path.join(repoPath, "new-file.txt"), "new content\n");

  const changedFilesFile = path.join(repoPath, "changed-files.txt");
  const diffFile = path.join(repoPath, "diff.patch");
  await captureChangedFiles(repoPath, changedFilesFile);
  await captureDiff(repoPath, diffFile);

  const changedFiles = await readFile(changedFilesFile, "utf8");
  const diff = await readFile(diffFile, "utf8");

  assert.match(changedFiles, /existing\.txt/);
  assert.match(changedFiles, /new-file\.txt/);
  assert.match(diff, /changed/);
  assert.match(diff, /new content/);
});
