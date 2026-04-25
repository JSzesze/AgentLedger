import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import type { IssueContext, RepoContext, RepoContextFile } from "./types.js";

const TEXT_FILE_PATTERN =
  /\.(ts|tsx|js|jsx|mjs|cjs|json|md|mdx|css|scss|html|yml|yaml)$/i;

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "agent",
  "also",
  "all",
  "before",
  "can",
  "could",
  "coding",
  "fix",
  "following",
  "from",
  "here",
  "implement",
  "interpreted",
  "interpretation",
  "agentledger",
  "instead",
  "issue",
  "maybe",
  "page",
  "please",
  "should",
  "that",
  "the",
  "this",
  "time",
  "update",
  "with",
  "work",
  "would",
]);

export async function gatherRepoContext(args: {
  repoPath: string;
  issue: IssueContext;
}): Promise<RepoContext> {
  const commandsRun: string[] = [];
  const sourceText = [
    args.issue.title,
    args.issue.body,
    ...args.issue.comments.filter(isRelevantHumanComment).map((comment) => comment.body),
  ].join("\n\n");
  const tokens = extractSearchTokens(sourceText);
  const files = await listRepoFiles(args.repoPath, commandsRun);
  const textFiles = files.filter(isSearchablePath);
  const scored = new Map<string, RepoContextFile>();
  const changedFiles = await listChangedFiles(args.repoPath, commandsRun);

  for (const file of textFiles) {
    const pathScore = scorePath(file, tokens);
    if (pathScore > 0) {
      const pathTokens = matchedPathTokens(file, tokens);
      scored.set(file, {
        path: file,
        score: pathScore,
        reasons:
          pathTokens.length > 0
            ? [`Path matched issue terms: ${pathTokens.join(", ")}`]
            : ["Path matched common implementation locations"],
        excerpts: [],
      });
    }
  }

  await addContentMatches({
    repoPath: args.repoPath,
    tokens,
    scored,
    commandsRun,
  });
  boostChangedFiles({ changedFiles, tokens, scored });

  const likelyFiles = [...scored.values()]
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, 10);
  await enrichLikelyFiles(args.repoPath, likelyFiles, tokens);
  const packageFiles = await readPackageFiles(args.repoPath, files);
  const findings = buildFindings(likelyFiles, packageFiles, tokens);

  return {
    repoPath: args.repoPath,
    packageFiles,
    likelyFiles,
    findings,
    commandsRun,
  };
}

export async function writeRepoContextFiles(args: {
  repoContext: RepoContext;
  markdownFile: string;
  jsonFile: string;
}) {
  await Promise.all([
    writeFile(args.markdownFile, formatRepoContextMarkdown(args.repoContext)),
    writeFile(args.jsonFile, `${JSON.stringify(args.repoContext, null, 2)}\n`),
  ]);
}

export function formatRepoContextMarkdown(context: RepoContext) {
  return `# Repository Reconnaissance

## Findings
${formatList(context.findings, "_No repository findings were generated._")}

## Likely Files
${context.likelyFiles
  .map(
    (file) => `### ${file.path}
- Score: ${file.score}
- Reasons: ${file.reasons.join("; ")}
${file.excerpts.length > 0 ? `- Evidence:\n${file.excerpts.map((excerpt) => `  - ${excerpt}`).join("\n")}` : ""}`
  )
  .join("\n\n")}

## Package Scripts
${context.packageFiles
  .map((pkg) => {
    const scripts = Object.entries(pkg.scripts);
    return `### ${pkg.path}${pkg.name ? ` (${pkg.name})` : ""}
${scripts.length > 0 ? scripts.map(([name, command]) => `- \`${name}\`: \`${command}\``).join("\n") : "_No scripts._"}`;
  })
  .join("\n\n")}

## Commands Run
${formatList(context.commandsRun.map((command) => `\`${command}\``))}
`;
}

function extractSearchTokens(value: string) {
  const words = value
    .toLowerCase()
    .replace(/\ba time\b/g, "at a time")
    .split(/[^a-z0-9]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
  const expanded = new Set<string>();
  for (const word of words) {
    expanded.add(word);
    if (word.endsWith("s")) {
      expanded.add(word.slice(0, -1));
    } else {
      expanded.add(`${word}s`);
    }
  }
  return [...expanded].slice(0, 24);
}

async function listRepoFiles(repoPath: string, commandsRun: string[]) {
  const gitCommand = "git ls-files";
  commandsRun.push(gitCommand);
  const gitResult = await execa("git", ["ls-files"], {
    cwd: repoPath,
    reject: false,
  });
  if (gitResult.exitCode === 0 && gitResult.stdout.trim()) {
    return gitResult.stdout.split("\n").filter(Boolean);
  }

  const rgCommand = "rg --files";
  commandsRun.push(rgCommand);
  const rgResult = await execa("rg", ["--files"], { cwd: repoPath, reject: false });
  return rgResult.stdout.split("\n").filter(Boolean);
}

async function addContentMatches(args: {
  repoPath: string;
  tokens: string[];
  scored: Map<string, RepoContextFile>;
  commandsRun: string[];
}) {
  if (args.tokens.length === 0) {
    return;
  }

  const pattern = args.tokens.map(escapeRegExp).join("|");
  const primaryAnchorTokens = selectAnchorTokens(args.tokens);
  const gitGrepArgs = [
    "grep",
    "-n",
    "-i",
    "-E",
    pattern,
    "--",
    "*.ts",
    "*.tsx",
    "*.js",
    "*.jsx",
    "*.json",
    "*.md",
    "*.mdx",
    "*.css",
    "*.scss",
    "*.yml",
    "*.yaml",
  ];
  args.commandsRun.push(`git ${gitGrepArgs.join(" ")}`);
  let result = await execa("git", gitGrepArgs, {
    cwd: args.repoPath,
    reject: false,
    maxBuffer: 1024 * 1024 * 8,
  });

  if ((result.exitCode ?? 0) > 1) {
    const rgArgs = [
      "-n",
      "-i",
      "--glob",
      "*.{ts,tsx,js,jsx,json,md,mdx,css,scss,yml,yaml}",
      "--glob",
      "!node_modules/**",
      "--glob",
      "!.git/**",
      "--glob",
      "!.next/**",
      "--glob",
      "!dist/**",
      "--glob",
      "!build/**",
      "--glob",
      "!icej-by-the-book-*/**",
      pattern,
    ];
    args.commandsRun.push(`rg ${rgArgs.join(" ")}`);
    result = await execa("rg", rgArgs, {
      cwd: args.repoPath,
      reject: false,
      maxBuffer: 1024 * 1024 * 8,
    });
  }

  const seenPerFile = new Map<string, number>();
  const scoredMatchesPerFile = new Map<string, number>();
  for (const line of result.stdout.split("\n").filter(Boolean).slice(0, 2000)) {
    const match = line.match(/^(.+?):(\d+):(.*)$/);
    if (!match) continue;
    const [, file, lineNumber, body] = match;
    if (!file || !isSearchablePath(file)) continue;
    const normalizedBody = body.toLowerCase();
    const matchedTokens = args.tokens.filter((token) => normalizedBody.includes(token));
    const matchedAnchorTokens = primaryAnchorTokens.filter((token) => normalizedBody.includes(token));
    if (primaryAnchorTokens.length > 0 && !primaryAnchorTokens.some((token) => normalizedBody.includes(token))) {
      continue;
    }

    const current = args.scored.get(file) ?? {
      path: file,
      score: 0,
      reasons: [],
      excerpts: [],
    };
    const count = seenPerFile.get(file) ?? 0;
    if (count < 5) {
      current.excerpts.push(`L${lineNumber}: ${body.trim().slice(0, 220)}`);
      seenPerFile.set(file, count + 1);
    }
    const scoredMatches = scoredMatchesPerFile.get(file) ?? 0;
    if (scoredMatches < 12) {
      current.score += contentMatchScore(matchedTokens, matchedAnchorTokens);
      scoredMatchesPerFile.set(file, scoredMatches + 1);
    }
    if (!current.reasons.includes("Content matched issue terms")) {
      current.reasons.push("Content matched issue terms");
    }
    args.scored.set(file, current);
  }
}

function isRelevantHumanComment(comment: { body: string }) {
  const body = comment.body.trim();
  return !(
    body.startsWith("## Agent Run") ||
    body.startsWith("## AgentLedger Interpretation") ||
    body.startsWith("## AgentLedger Interpretation Superseded") ||
    body.startsWith("## AgentLedger Reconciliation")
  );
}

async function readPackageFiles(repoPath: string, files: string[]) {
  const packagePaths = files
    .filter((file) => file === "package.json" || file.endsWith("/package.json"))
    .filter((file) => !file.includes("node_modules/"))
    .slice(0, 8);

  const packages: RepoContext["packageFiles"] = [];
  for (const packagePath of packagePaths) {
    try {
      const raw = await readFile(path.join(repoPath, packagePath), "utf8");
      const parsed = JSON.parse(raw) as { name?: string; scripts?: Record<string, string> };
      packages.push({
        path: packagePath,
        name: parsed.name,
        scripts: parsed.scripts ?? {},
      });
    } catch {
      // Ignore malformed package files during reconnaissance.
    }
  }
  return packages;
}

function buildFindings(
  likelyFiles: RepoContextFile[],
  packageFiles: RepoContext["packageFiles"],
  tokens: string[]
) {
  const findings: string[] = [];
  if (likelyFiles.length > 0) {
    findings.push(
      `Most relevant files appear to be ${likelyFiles
        .slice(0, 5)
        .map((file) => `\`${file.path}\``)
        .join(", ")}.`
    );
  }
  if (tokens.length > 0) {
    findings.push(`Repository search terms: ${tokens.slice(0, 12).join(", ")}.`);
  }
  const usefulScripts = packageFiles.flatMap((pkg) =>
    Object.keys(pkg.scripts)
      .filter((script) => /^(test|lint|typecheck|build|dev)/.test(script))
      .map((script) => `${pkg.path}:${script}`)
  );
  if (usefulScripts.length > 0) {
    findings.push(`Relevant package scripts found: ${usefulScripts.slice(0, 10).join(", ")}.`);
  }
  return findings;
}

function isSearchablePath(file: string) {
  return (
    TEXT_FILE_PATTERN.test(file) &&
    !file.includes("node_modules/") &&
    !file.includes(".next/") &&
    !file.includes(".agent-ledger/") &&
    !file.startsWith("archive/") &&
    !file.includes("/dist/") &&
    !file.includes("/build/")
  );
}

function scorePath(file: string, tokens: string[]) {
  const normalizedPath = file.toLowerCase();
  const matchedTokens = matchedPathTokens(normalizedPath, tokens);
  const anchorTokens = selectAnchorTokens(tokens).filter((token) => normalizedPath.includes(token));
  const multiAnchorBonus = anchorTokens.length >= 2 ? anchorTokens.length * 50 : 0;
  return matchedTokens.length * 10 + anchorTokens.length * 25 + multiAnchorBonus + pathRelevanceBoost(file, tokens);
}

function matchedPathTokens(file: string, tokens: string[]) {
  const normalizedPath = file.toLowerCase();
  return tokens.filter((token) => normalizedPath.includes(token));
}

function pathRelevanceBoost(file: string, tokens: string[]) {
  const normalizedPath = file.toLowerCase();
  let score = 0;
  if (normalizedPath.includes("web/")) score += 14;
  if (normalizedPath.includes("src/")) score += 8;
  if (normalizedPath.includes("app/")) score += 6;
  if (normalizedPath.includes("components/")) score += 14;
  if (normalizedPath.includes("admin")) score += 16;
  if (normalizedPath.includes("lib/")) score += 4;
  if (normalizedPath.includes("api/") || normalizedPath.includes("routes/")) score += 4;
  if (normalizedPath.includes("test") || normalizedPath.includes("spec")) score += 3;
  if (normalizedPath.startsWith("archive/")) score -= 80;
  if (normalizedPath.includes("/legacy/")) score -= 50;
  if (tokens.some((token) => normalizedPath.includes(token))) score += 12;
  return score;
}

function contentMatchScore(matchedTokens: string[], matchedAnchorTokens: string[]) {
  return 2 + matchedTokens.length + matchedAnchorTokens.length * 8;
}

async function listChangedFiles(repoPath: string, commandsRun: string[]) {
  const command = "git status --porcelain=v1";
  commandsRun.push(command);
  const result = await execa("git", ["status", "--porcelain=v1"], {
    cwd: repoPath,
    reject: false,
  });
  return result.stdout
    .split("\n")
    .map((line) => parseStatusPath(line))
    .filter((file) => file && isSearchablePath(file));
}

function boostChangedFiles(args: {
  changedFiles: string[];
  tokens: string[];
  scored: Map<string, RepoContextFile>;
}) {
  for (const file of args.changedFiles) {
    const pathTokens = matchedPathTokens(file, args.tokens);
    const anchorTokens = selectAnchorTokens(args.tokens).filter((token) =>
      file.toLowerCase().includes(token)
    );
    if (pathTokens.length === 0 && anchorTokens.length === 0) {
      continue;
    }

    const current = args.scored.get(file) ?? {
      path: file,
      score: 0,
      reasons: [],
      excerpts: [],
    };
    current.score += 50 + anchorTokens.length * 20;
    if (!current.reasons.includes("Currently modified and matches issue terms")) {
      current.reasons.push("Currently modified and matches issue terms");
    }
    args.scored.set(file, current);
  }
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

async function enrichLikelyFiles(repoPath: string, files: RepoContextFile[], tokens: string[]) {
  for (const file of files) {
    if (file.excerpts.length >= 5) continue;
    try {
      const raw = await readFile(path.join(repoPath, file.path), "utf8");
      const lines = raw.split("\n");
      const structuralExcerpts = lines
        .map((body, index) => ({ lineNumber: index + 1, body: body.trim() }))
        .filter(({ body }) => isUsefulStructuralLine(body, tokens))
        .slice(0, 5 - file.excerpts.length)
        .map(({ lineNumber, body }) => `L${lineNumber}: ${body.slice(0, 220)}`);
      file.excerpts.push(...structuralExcerpts);
      if (structuralExcerpts.length > 0 && !file.reasons.includes("Structure matched likely UI implementation")) {
        file.reasons.push("Structure matched likely UI implementation");
      }
    } catch {
      // Ignore unreadable files during reconnaissance.
    }
  }
}

function isUsefulStructuralLine(body: string, tokens: string[]) {
  if (!body) return false;
  const normalized = body.toLowerCase();
  if (/^(import|export type|type )/.test(normalized)) return false;
  if (/export function|function |const \[|useState|useMemo|useCallback/.test(body)) return true;
  if (/\.map\(|class |interface |type |schema|route|handler|mutation|query/.test(body)) return true;
  return tokens.some((token) => normalized.includes(token)) && body.length < 180;
}

function selectAnchorTokens(tokens: string[]) {
  const generic = new Set([
    "app",
    "apps",
    "code",
    "data",
    "file",
    "files",
    "form",
    "make",
    "need",
    "needs",
    "new",
    "page",
    "repo",
    "run",
    "runs",
    "use",
    "uses",
  ]);
  return tokens.filter((token) => token.length >= 4 && !generic.has(token)).slice(0, 8);
}

function formatList(values: string[], empty = "_None._") {
  return values.length > 0 ? values.map((value) => `- ${value}`).join("\n") : empty;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
