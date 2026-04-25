import { writeFile } from "node:fs/promises";
import { execa } from "execa";

export async function captureGitStatus(repoPath: string, outputFile: string) {
  const result = await execa("git", ["status", "--short"], { cwd: repoPath });
  await writeFile(outputFile, result.stdout ? `${result.stdout}\n` : "");
}

export async function captureChangedFiles(repoPath: string, outputFile: string) {
  const files = await listChangedFiles(repoPath);
  await writeFile(outputFile, files.length ? `${files.join("\n")}\n` : "");
}

export async function captureDiff(repoPath: string, outputFile: string) {
  const diff = await execa("git", ["diff", "--no-ext-diff", "HEAD", "--"], {
    cwd: repoPath,
  });
  const untrackedPatches = await captureUntrackedPatches(repoPath);
  const sections = [diff.stdout, ...untrackedPatches].filter(Boolean);
  await writeFile(outputFile, sections.length ? `${sections.join("\n\n")}\n` : "");
}

async function listChangedFiles(repoPath: string) {
  const result = await execa("git", ["status", "--porcelain=v1"], { cwd: repoPath });
  const files = result.stdout
    .split("\n")
    .map((line) => parseStatusPath(line))
    .filter((file): file is string => Boolean(file) && !file.startsWith(".agent-ledger/"));
  return [...new Set(files)].sort();
}

async function captureUntrackedPatches(repoPath: string) {
  const result = await execa("git", ["ls-files", "--others", "--exclude-standard"], {
    cwd: repoPath,
  });
  const files = result.stdout
    .split("\n")
    .map((file) => file.trim())
    .filter((file) => file && !file.startsWith(".agent-ledger/"));
  const patches: string[] = [];

  for (const file of files) {
    const patch = await execa("git", ["diff", "--no-index", "--", "/dev/null", file], {
      cwd: repoPath,
      reject: false,
    });
    if (patch.stdout.trim()) {
      patches.push(patch.stdout);
    }
  }

  return patches;
}

function parseStatusPath(line: string) {
  if (!line.trim()) {
    return "";
  }

  const rawPath = line.slice(3).trim();
  const renamePath = rawPath.match(/^(.+?)\s+->\s+(.+)$/);
  return stripQuotes(renamePath?.[2] ?? rawPath);
}

function stripQuotes(value: string) {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"');
  }
  return value;
}
