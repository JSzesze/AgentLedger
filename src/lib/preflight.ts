import { realpath } from "node:fs/promises";
import { execa, type ExecaError } from "execa";
import { extractIssueImageReferences } from "./attachments.js";
import { getIssueContext, resolveIssueRef } from "./github.js";
import type { IssueContext } from "./types.js";
import { z } from "zod";

export type PreflightCheckId =
  | "gh_installed"
  | "gh_authenticated"
  | "cursor_api_key"
  | "git_repo"
  | "issue_access"
  | "issue_images_parse"
  | "repo_dirty_warning";

export type PreflightCheck = {
  id: PreflightCheckId;
  ok: boolean;
  message: string;
  details?: string;
};

export type PreflightResult = {
  ok: boolean;
  checks: PreflightCheck[];
};

/**
 * Verifies `gh` + auth, optional GitHub issue access, Cursor API key, and git working tree.
 */
export async function runPreflight(args: {
  issue?: string;
  repo?: string;
  /** When true, fail if the repo has uncommitted changes outside `.agent-ledger/`. */
  failOnDirty?: boolean;
}): Promise<PreflightResult> {
  const checks: PreflightCheck[] = [];

  if (!args.repo && !args.issue) {
    const ghInstalled = await checkGhInstalled();
    checks.push(ghInstalled);
    if (!ghInstalled.ok) {
      return { ok: false, checks };
    }
    const ghAuth = await checkGhAuth();
    checks.push(ghAuth);
    if (!ghAuth.ok) {
      return { ok: false, checks };
    }
    const cursorKey = checkCursorApiKey();
    checks.push(cursorKey);
    return { ok: cursorKey.ok, checks };
  }

  const ghInstalled = await checkGhInstalled();
  checks.push(ghInstalled);
  if (!ghInstalled.ok) {
    return { ok: false, checks };
  }

  const ghAuth = await checkGhAuth();
  checks.push(ghAuth);
  if (!ghAuth.ok) {
    return { ok: false, checks };
  }

  const cursorKey = checkCursorApiKey();
  checks.push(cursorKey);
  if (!cursorKey.ok) {
    return { ok: false, checks };
  }

  if (args.repo) {
    const gitRepo = await checkGitRepository(args.repo);
    checks.push(gitRepo);
    if (!gitRepo.ok) {
      return { ok: false, checks };
    }

    const dirty = await checkRepoDirtyWarning(await realpath(args.repo));
    checks.push(dirty);
    if (args.failOnDirty && !dirty.ok) {
      return { ok: false, checks };
    }
  }

  if (args.issue && args.repo) {
    const issueAccess = await checkIssueAccess(args.issue, await realpath(args.repo));
    checks.push(issueAccess);
    if (!issueAccess.ok) {
      return { ok: false, checks };
    }
  }

  if (args.issue && args.repo) {
    const issue = await getIssueForPreflight(args.issue, await realpath(args.repo));
    if (issue) {
      const imgParse = checkIssueImageParse(issue);
      checks.push(imgParse);
    }
  }

  return { ok: checks.every((c) => c.ok), checks };
}

async function checkGhInstalled(): Promise<PreflightCheck> {
  try {
    const result = await execa("gh", ["--version"], { reject: false });
    if (result.exitCode !== 0) {
      return {
        id: "gh_installed",
        ok: false,
        message: "GitHub CLI (gh) is not working.",
        details: result.stderr || result.stdout,
      };
    }
    return {
      id: "gh_installed",
      ok: true,
      message: "GitHub CLI (gh) is available.",
      details: result.stdout.split("\n")[0]?.trim(),
    };
  } catch (error) {
    return {
      id: "gh_installed",
      ok: false,
      message: "GitHub CLI (gh) not found. Install: https://cli.github.com/",
      details: String(error),
    };
  }
}

const ghAuthStatusSchema = z
  .object({
    user_login: z.string().optional().nullable(),
    message: z.string().optional().nullable(),
  })
  .passthrough();

async function checkGhAuth(): Promise<PreflightCheck> {
  try {
    const result = await execa("gh", ["auth", "status", "-h", "github.com", "--json", "user_login,message"], {
      reject: false,
    });
    if (result.exitCode !== 0) {
      return {
        id: "gh_authenticated",
        ok: false,
        message: "Not authenticated to GitHub. Run: gh auth login",
        details: result.stderr || result.stdout,
      };
    }
    const parsed = ghAuthStatusSchema.safeParse(JSON.parse(result.stdout));
    const user = parsed.success && parsed.data.user_login ? ` (@${parsed.data.user_login})` : "";
    return {
      id: "gh_authenticated",
      ok: true,
      message: `GitHub auth OK${user}.`,
    };
  } catch (error) {
    return {
      id: "gh_authenticated",
      ok: false,
      message: "Failed to read gh auth status.",
      details: String(error),
    };
  }
}

function checkCursorApiKey(): PreflightCheck {
  const key = process.env.CURSOR_API_KEY;
  if (!key || !key.trim()) {
    return {
      id: "cursor_api_key",
      ok: false,
      message: "CURSOR_API_KEY is not set. Add it to the environment or a .env file.",
    };
  }
  return {
    id: "cursor_api_key",
    ok: true,
    message: "CURSOR_API_KEY is set.",
  };
}

async function checkGitRepository(repo: string): Promise<PreflightCheck> {
  try {
    const top = await execa("git", ["rev-parse", "--show-toplevel"], { cwd: repo });
    return {
      id: "git_repo",
      ok: true,
      message: "Directory is a git repository.",
      details: top.stdout.trim(),
    };
  } catch (error) {
    const ex = error as ExecaError;
    const errDetail = ex?.stderr;
    const message =
      errDetail == null
        ? String(error)
        : typeof errDetail === "string"
          ? errDetail
          : String(errDetail);
    return {
      id: "git_repo",
      ok: false,
      message: "Not a git repository. Pass --repo to a clone of the target app.",
      details: message,
    };
  }
}

/**
 * Returns ok: false if there are non-.agent-ledger working tree changes (warning = still ok: true in default mode).
 */
export async function checkRepoDirtyWarning(repoPath: string): Promise<PreflightCheck> {
  const result = await execa("git", ["status", "--porcelain=v1"], { cwd: repoPath });
  const lines = result.stdout
    .split("\n")
    .map((l) => l.trimEnd())
    .filter(Boolean);
  const outside = lines.filter((line) => {
    const pathPart = line.length >= 4 ? line.slice(3) : line;
    const p = pathPart.replace(/^"([\s\S]*)"$/, "$1");
    return !p.startsWith(".agent-ledger/") && p !== ".agent-ledger";
  });
  if (outside.length > 0) {
    return {
      id: "repo_dirty_warning",
      ok: false,
      message:
        "Working tree has uncommitted changes outside .agent-ledger/. Commit, stash, or use a clean clone for predictable runs.",
      details: outside.slice(0, 12).join("\n") + (outside.length > 12 ? "\n…" : ""),
    };
  }
  return {
    id: "repo_dirty_warning",
    ok: true,
    message: "No uncommitted changes outside .agent-ledger/ (or working tree is clean).",
  };
}

async function checkIssueAccess(issue: string, repoPath: string): Promise<PreflightCheck> {
  try {
    const ref = await resolveIssueRef(issue, repoPath);
    await getIssueContext(ref);
    return {
      id: "issue_access",
      ok: true,
      message: `Can read issue #${ref.issueNumber} in ${ref.owner}/${ref.repo}.`,
    };
  } catch (error) {
    return {
      id: "issue_access",
      ok: false,
      message: "Cannot read the GitHub issue. Check URL, remote, and repo access.",
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

async function getIssueForPreflight(issue: string, repoPath: string): Promise<IssueContext | null> {
  try {
    const ref = await resolveIssueRef(issue, repoPath);
    return await getIssueContext(ref);
  } catch {
    return null;
  }
}

function checkIssueImageParse(issue: IssueContext): PreflightCheck {
  try {
    const refs = extractIssueImageReferences(issue);
    return {
      id: "issue_images_parse",
      ok: true,
      message: `Found ${refs.length} image reference(s) in the issue (markdown/HTML).`,
    };
  } catch (error) {
    return {
      id: "issue_images_parse",
      ok: false,
      message: "Failed to parse image references from the issue body/comments.",
      details: String(error),
    };
  }
}

export function printPreflightHuman(result: PreflightResult) {
  for (const c of result.checks) {
    const icon = c.ok ? "ok" : "no";
    console.log(`[${icon}] ${c.id}: ${c.message}`);
    if (c.details) {
      console.log(`      ${c.details.split("\n").join("\n      ")}`);
    }
  }
  console.log(result.ok ? "\nAll checks passed." : "\nSome checks failed.");
}
