import { readFile, writeFile } from "node:fs/promises";
import { execa } from "execa";
import { z } from "zod";
import type { IssueContext, IssueRef } from "./types.js";

const issueViewSchema = z.object({
  title: z.string().default(""),
  body: z.string().nullable().default(""),
  url: z.string().url(),
  comments: z
    .array(
      z.object({
        author: z
          .object({
            login: z.string().optional(),
          })
          .optional(),
        body: z.string().nullable().default(""),
        createdAt: z.string().default(""),
      })
    )
    .default([]),
});

export async function resolveIssueRef(issueInput: string, repoPath: string): Promise<IssueRef> {
  const parsed = parseGitHubIssueUrl(issueInput);
  if (parsed) {
    return parsed;
  }

  const issueNumber = Number(issueInput);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new Error(`Invalid issue value: ${issueInput}`);
  }

  const remote = await getGitHubRemote(repoPath);
  return { ...remote, issueNumber };
}

export function parseGitHubIssueUrl(input: string): IssueRef | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  if (url.hostname !== "github.com") {
    throw new Error(`Only github.com issue URLs are supported: ${input}`);
  }

  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/);
  if (!match) {
    throw new Error(`Expected a GitHub issue URL like https://github.com/org/repo/issues/184`);
  }

  return {
    owner: match[1]!,
    repo: match[2]!,
    issueNumber: Number(match[3]),
  };
}

/**
 * True if a human/comment already has an AgentLedger interpretation (not counting empty bodies).
 */
export function hasAgentLedgerInterpretationComment(issue: IssueContext): boolean {
  return issue.comments.some(
    (c) => c.body?.trim().startsWith("## AgentLedger Interpretation")
  );
}

export async function getIssueContext(ref: IssueRef): Promise<IssueContext> {
  const result = await execa("gh", [
    "issue",
    "view",
    String(ref.issueNumber),
    "--repo",
    `${ref.owner}/${ref.repo}`,
    "--json",
    "title,body,comments,url",
  ]);

  const parsed = issueViewSchema.parse(JSON.parse(result.stdout));
  return {
    ...ref,
    title: parsed.title,
    body: parsed.body ?? "",
    url: parsed.url,
    comments: parsed.comments.map((comment) => ({
      author: comment.author?.login ?? "unknown",
      body: comment.body ?? "",
      createdAt: comment.createdAt,
    })),
  };
}

export async function postIssueComment(args: {
  owner: string;
  repo: string;
  issueNumber: number;
  bodyFile: string;
}): Promise<void> {
  await execa("gh", [
    "issue",
    "comment",
    String(args.issueNumber),
    "--repo",
    `${args.owner}/${args.repo}`,
    "--body-file",
    args.bodyFile,
  ]);
}

export async function writeGithubCommentLog(file: string, comments: Array<Record<string, unknown>>) {
  const existing = await readGithubCommentLog(file);
  existing.push(...comments);
  await writeFile(file, `${JSON.stringify(existing, null, 2)}\n`);
}

export async function readGithubCommentLog(file: string): Promise<Array<Record<string, unknown>>> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];
  } catch {
    return [];
  }
}

export async function hasGithubCommentLogType(file: string, type: string): Promise<boolean> {
  const comments = await readGithubCommentLog(file);
  return comments.some((comment) => comment.type === type);
}

async function getGitHubRemote(repoPath: string): Promise<Pick<IssueRef, "owner" | "repo">> {
  const result = await execa("git", ["remote", "get-url", "origin"], { cwd: repoPath });
  const remote = result.stdout.trim();

  const httpsMatch = remote.match(/^https:\/\/github\.com\/([^/]+)\/(.+)$/);
  if (httpsMatch) {
    return { owner: httpsMatch[1]!, repo: stripGitSuffix(httpsMatch[2]!) };
  }

  const sshMatch = remote.match(/^git@github\.com:([^/]+)\/(.+)$/);
  if (sshMatch) {
    return { owner: sshMatch[1]!, repo: stripGitSuffix(sshMatch[2]!) };
  }

  throw new Error(`Could not infer GitHub owner/repo from origin remote: ${remote}`);
}

function stripGitSuffix(repo: string) {
  return repo.endsWith(".git") ? repo.slice(0, -4) : repo;
}
