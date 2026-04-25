import { appendFile, readFile, writeFile } from "node:fs/promises";
import { Agent } from "@cursor/february/agent";
import { execa } from "execa";
import type { AgentLedgerConfig } from "./config.js";
import type { CursorRunResult, IssueContext, RepoContext, RunArchive, WorkOrder } from "./types.js";
import type { CursorImageInput } from "./attachments.js";
import { tryParseWorkOrderJson } from "./workOrderSchema.js";
import { appendJsonLine } from "./runArchive.js";
import { formatIssueMarkdown, isAgentLedgerComment } from "./runArchive.js";
import { formatRepoContextMarkdown } from "./repoContext.js";
import { buildCursorPromptFromWorkOrder } from "./workOrder.js";

export async function runCursorAgent(args: {
  repoPath: string;
  prompt: string;
  archive: RunArchive;
  model: string;
  images?: CursorImageInput[];
  phase?: "coding" | "interpreter";
  verbose?: boolean;
}): Promise<CursorRunResult> {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    throw new Error("CURSOR_API_KEY is required to run the Cursor local agent.");
  }

  const agent = Agent.create({
    apiKey,
    model: { id: args.model },
    local: { cwd: args.repoPath },
  });

  const startedAt = Date.now();
  const logFiles = cursorLogFiles(args.archive, args.phase ?? "coding");
  let run:
    | Awaited<ReturnType<typeof agent.send>>
    | undefined;

  try {
    const prompt =
      args.images && args.images.length > 0
        ? { text: args.prompt, images: args.images }
        : args.prompt;
    run = await agent.send(prompt, {
      onDelta: async ({ update }) => {
        await appendJsonLine(logFiles.eventsFile, {
          source: "delta",
          timestamp: new Date().toISOString(),
          update,
        });
      },
    });

    await writeFile(
      logFiles.agentFile,
      `${JSON.stringify({ agentId: agent.agentId, runId: run.id, runtime: "local", model: args.model, phase: args.phase ?? "coding" }, null, 2)}\n`
    );

    for await (const event of run.stream()) {
      await appendJsonLine(logFiles.eventsFile, {
        source: "stream",
        timestamp: new Date().toISOString(),
        event,
      });

      await persistReadableEvent(event, logFiles);
      printProgress(event, Boolean(args.verbose));
    }

    const result = await run.wait();
    return {
      agentId: agent.agentId,
      runId: run.id,
      status: String(result.status),
      durationMs:
        "durationMs" in result && typeof result.durationMs === "number"
          ? result.durationMs
          : Date.now() - startedAt,
      usage: "usage" in result ? result.usage : undefined,
      git: "git" in result ? result.git : undefined,
    };
  } finally {
    await agent[Symbol.asyncDispose]();
  }
}

export async function runCursorInterpreter(args: {
  repoPath: string;
  issue: IssueContext;
  repoContext: RepoContext;
  archive: RunArchive;
  userPrompt: string;
  runKey: string;
  model: string;
  images?: CursorImageInput[];
  verbose?: boolean;
  config?: AgentLedgerConfig | null;
}): Promise<WorkOrder> {
  const beforeStatus = await nonLedgerGitStatus(args.repoPath);
  const prompt = buildCursorInterpreterPrompt(args);

  await runCursorAgent({
    repoPath: args.repoPath,
    prompt,
    archive: args.archive,
    model: args.model,
    images: args.images,
    phase: "interpreter",
    verbose: args.verbose,
  });

  const afterStatus = await nonLedgerGitStatus(args.repoPath);
  if (beforeStatus !== afterStatus) {
    throw new Error(
      "Cursor interpreter modified tracked repo state outside the AgentLedger archive. Aborting before coding run."
    );
  }

  const raw = await readFile(args.archive.workOrderFile, "utf8");
  const parsed = tryParseWorkOrderJson(raw, args.archive.workOrderFile);
  return normalizeCursorWorkOrder(parsed, {
    issue: args.issue,
    repoContext: args.repoContext,
    userPrompt: args.userPrompt,
    runKey: args.runKey,
    config: args.config ?? null,
  });
}

export async function runCursorCloudInterpreter(args: {
  issue: IssueContext;
  repoContext: RepoContext;
  archive: RunArchive;
  userPrompt: string;
  runKey: string;
  model: string;
  images?: CursorImageInput[];
  verbose?: boolean;
  config?: AgentLedgerConfig | null;
}): Promise<WorkOrder> {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    throw new Error("CURSOR_API_KEY is required to run the Cursor cloud interpreter.");
  }

  const agent = Agent.create({
    apiKey,
    model: { id: args.model },
    cloud: {
      repos: [{ url: `https://github.com/${args.issue.owner}/${args.issue.repo}` }],
      autoCreatePR: false,
    },
  });

  const prompt = buildCursorCloudInterpreterPrompt(args);
  let assistantText = "";

  try {
    const run = await agent.send(
      args.images && args.images.length > 0 ? { text: prompt, images: args.images } : prompt
    );
    await appendJsonLine(args.archive.interpreterEventsFile, {
      source: "cursor_interpreter_cloud",
      timestamp: new Date().toISOString(),
      event: { type: "run", agentId: agent.agentId, runId: run.id, model: args.model },
    });
    await writeFile(
      args.archive.cursorInterpreterAgentFile,
      `${JSON.stringify({ agentId: agent.agentId, runId: run.id, runtime: "cloud", model: args.model, phase: "interpreter" }, null, 2)}\n`
    );

    for await (const event of run.stream()) {
      await appendJsonLine(args.archive.interpreterEventsFile, {
        source: "cursor_interpreter_cloud",
        timestamp: new Date().toISOString(),
        event,
      });

      if (event.type === "assistant") {
        for (const block of event.message.content) {
          if (block.type === "text") {
            assistantText += block.text;
            await appendFile(args.archive.interpreterTranscriptFile, block.text);
            if (args.verbose) process.stdout.write(block.text);
          }
        }
      }

      if (event.type === "status" && args.verbose) {
        console.log(`[interpreter status] ${event.status}`);
      }
    }

    const result = await run.wait();
    if (String(result.status).toLowerCase() === "error") {
      throw new Error("Cursor cloud interpreter run ended with error status.");
    }

    const parsed = tryParseWorkOrderJson(extractJsonObject(assistantText), "cloud interpreter");
    return normalizeCursorWorkOrder(parsed, {
      issue: args.issue,
      repoContext: args.repoContext,
      userPrompt: args.userPrompt,
      runKey: args.runKey,
      config: args.config ?? null,
    });
  } finally {
    await agent[Symbol.asyncDispose]();
  }
}

type CursorLogFiles = {
  agentFile: string;
  eventsFile: string;
  transcriptFile: string;
  toolCallsFile: string;
};

function cursorLogFiles(archive: RunArchive, phase: "coding" | "interpreter"): CursorLogFiles {
  if (phase === "interpreter") {
    return {
      agentFile: archive.cursorInterpreterAgentFile,
      eventsFile: archive.interpreterEventsFile,
      transcriptFile: archive.interpreterTranscriptFile,
      toolCallsFile: archive.interpreterToolCallsFile,
    };
  }

  return {
    agentFile: archive.cursorAgentFile,
    eventsFile: archive.eventsFile,
    transcriptFile: archive.transcriptFile,
    toolCallsFile: archive.toolCallsFile,
  };
}

async function persistReadableEvent(event: unknown, files: CursorLogFiles) {
  if (!event || typeof event !== "object" || !("type" in event)) {
    return;
  }

  const typed = event as {
    type: string;
    message?: { content?: Array<{ type?: string; text?: string }> };
    text?: string;
    name?: string;
    status?: string;
    call_id?: string;
    args?: unknown;
    result?: unknown;
  };

  if (typed.type === "assistant" && typed.message?.content) {
    for (const block of typed.message.content) {
      if (block.type === "text" && block.text) {
        await appendFile(files.transcriptFile, block.text);
        if (!block.text.endsWith("\n")) {
          await appendFile(files.transcriptFile, "\n");
        }
      }
    }
  }

  if (typed.type === "thinking" && typed.text) {
    await appendFile(files.transcriptFile, `\n[thinking]\n${typed.text}\n`);
  }

  if (typed.type === "task" && typed.text) {
    await appendFile(files.transcriptFile, `\n[task]\n${typed.text}\n`);
  }

  if (typed.type === "tool_call") {
    await appendJsonLine(files.toolCallsFile, {
      timestamp: new Date().toISOString(),
      callId: typed.call_id,
      name: typed.name,
      status: typed.status,
      args: typed.args,
      result: typed.result,
    });
  }
}

function printProgress(event: unknown, verbose: boolean) {
  if (!event || typeof event !== "object" || !("type" in event)) {
    return;
  }

  const typed = event as {
    type: string;
    message?: { content?: Array<{ type?: string; text?: string }> };
    text?: string;
    name?: string;
    status?: string;
  };

  if (typed.type === "assistant" && typed.message?.content) {
    for (const block of typed.message.content) {
      if (block.type === "text" && block.text) {
        process.stdout.write(block.text);
      }
    }
    return;
  }

  if (typed.type === "tool_call") {
    const status = typed.status ? ` ${typed.status}` : "";
    console.log(`\n[tool] ${typed.name ?? "unknown"}${status}`);
    return;
  }

  if (typed.type === "status") {
    console.log(`\n[status] ${typed.status}`);
    return;
  }

  if (verbose) {
    console.log(`\n[event] ${typed.type}`);
  }
}

function buildCursorInterpreterPrompt(args: {
  issue: IssueContext;
  repoContext: RepoContext;
  archive: RunArchive;
  userPrompt: string;
  runKey: string;
}) {
  return `You are AgentLedger's read-only issue interpreter.

Your job:
- Inspect the local repository as needed.
- Interpret the GitHub issue into a precise coding-agent work order.
- Ground your interpretation in actual files and current implementation details.
- Do not edit application/source files.
- Do not implement the task.
- Write exactly one JSON file: ${args.archive.workOrderFile}

Allowed write path:
- ${args.archive.workOrderFile}

Forbidden:
- Do not modify files outside ${args.archive.dir}
- Do not run destructive commands.
- Do not post to GitHub.

The JSON must match this TypeScript shape:
{
  "runKey": string,
  "taskType": string,
  "interpretedGoal": string,
  "problemStatement": string,
  "acceptanceCriteria": [{"id": "AC1", "text": string}],
  "nonGoals": string[],
  "constraints": string[],
  "openQuestions": string[],
  "confidence": "high" | "medium" | "low",
  "implementationNotes": string[],
  "source": {
    "issueUrl": string,
    "issueTitle": string,
    "userPrompt": string,
    "commentsConsidered": number
  },
  "repoContext": {
    "likelyFiles": string[],
    "findings": string[],
    "packageScripts": string[]
  }
}

Guidance:
- Treat the repository context below as hints, not truth. Verify likely files by reading the code before you include them.
- Do not simply paraphrase the GitHub issue. Explain what the issue means in the product, workflow, or user/editor experience.
- The interpreted goal should be outcome-oriented and specific enough for a coding agent to execute.
- The problem statement should explain why the current behavior is painful or limiting, grounded in the code you inspected.
- Acceptance criteria should describe observable behavior after implementation, not implementation tasks.
- Keep non-goals honest; do not invent broad product scope.
- Use openQuestions only for true blockers that should stop the coding run.
- Treat unclear target surface as a true blocker when the issue/repo could reasonably mean different products or apps (for example admin web vs mobile app, public page vs internal tool, client vs backend).
- Do not resolve target-surface ambiguity from code likelihood alone. If the issue title/body/comments do not explicitly name the target surface and you find multiple plausible surfaces, add a blocking open question naming the likely surface and the alternative.
- When target surface is a blocking question, confidence must not be "high".
- Do not ask interactive scope-confirmation questions when the code supports a conservative interpretation. Put non-blocking uncertainty in implementationNotes as assumptions to record.
- If the issue has a clear X-instead-of-Y request, prefer medium/high confidence and a conservative scope over asking for confirmation, unless the code contradicts the request.

# GitHub Issue
${formatIssueMarkdown(args.issue, { includeAgentLedgerComments: false })}

${formatRepoContextMarkdown(args.repoContext)}

# Required Metadata
- runKey: ${args.runKey}
- userPrompt: ${args.userPrompt}

After writing ${args.archive.workOrderFile}, stop.`;
}

function buildCursorCloudInterpreterPrompt(args: {
  issue: IssueContext;
  repoContext: RepoContext;
  userPrompt: string;
  runKey: string;
}) {
  return `You are AgentLedger's Cursor Cloud issue interpreter.

Inspect the connected GitHub repository as needed, but do not implement code changes and do not open a PR.

Return only valid JSON matching this TypeScript shape:
{
  "runKey": string,
  "taskType": string,
  "interpretedGoal": string,
  "problemStatement": string,
  "acceptanceCriteria": [{"id": "AC1", "text": string}],
  "nonGoals": string[],
  "constraints": string[],
  "openQuestions": string[],
  "confidence": "high" | "medium" | "low",
  "implementationNotes": string[],
  "source": {
    "issueUrl": string,
    "issueTitle": string,
    "userPrompt": string,
    "commentsConsidered": number
  },
  "repoContext": {
    "likelyFiles": string[],
    "findings": string[],
    "packageScripts": string[]
  }
}

Rules:
- Treat repository context as hints, then ground the interpretation in actual repository files.
- Do not simply paraphrase the GitHub issue. Explain what the issue means in the product, workflow, or user/editor experience.
- Write an outcome-oriented goal and observable acceptance criteria.
- Use openQuestions only for true blockers that should stop the coding run.
- Treat unclear target surface as a true blocker when the issue/repo could reasonably mean different products or apps (for example admin web vs mobile app, public page vs internal tool, client vs backend).
- Do not resolve target-surface ambiguity from code likelihood alone. If the issue title/body/comments do not explicitly name the target surface and you find multiple plausible surfaces, add a blocking open question naming the likely surface and the alternative.
- When target surface is a blocking question, confidence must not be "high".
- Do not ask interactive scope-confirmation questions when the code supports a conservative interpretation. Put non-blocking uncertainty in implementationNotes as assumptions to record.
- If the issue has a clear X-instead-of-Y request, prefer medium/high confidence and a conservative scope over asking for confirmation, unless the code contradicts the request.
- Do not invent requirements.
- Output JSON only, no markdown fence.

# GitHub Issue
${formatIssueMarkdown(args.issue, { includeAgentLedgerComments: false })}

${formatRepoContextMarkdown(args.repoContext)}

# Required Metadata
- runKey: ${args.runKey}
- userPrompt: ${args.userPrompt}`;
}

function normalizeCursorWorkOrder(
  parsed: WorkOrder,
  context: {
    issue: IssueContext;
    repoContext: RepoContext;
    userPrompt: string;
    runKey: string;
    config: AgentLedgerConfig | null;
  }
): WorkOrder {
  const workOrder: WorkOrder = {
    ...parsed,
    runKey: parsed.runKey || context.runKey,
    taskType: parsed.taskType || "Implementation task",
    interpretedGoal: parsed.interpretedGoal || context.issue.title,
    problemStatement: parsed.problemStatement || context.issue.body || context.issue.title,
    acceptanceCriteria: parsed.acceptanceCriteria?.length
      ? parsed.acceptanceCriteria.map((criterion, index) => ({
          id: criterion.id || `AC${index + 1}`,
          text: criterion.text,
        }))
      : [],
    nonGoals: parsed.nonGoals ?? [],
    constraints: parsed.constraints ?? [],
    openQuestions: parsed.openQuestions ?? [],
    confidence: parsed.confidence ?? "medium",
    implementationNotes: parsed.implementationNotes ?? [],
    source: {
      ...parsed.source,
      issueUrl: parsed.source?.issueUrl ?? context.issue.url,
      issueTitle: parsed.source?.issueTitle ?? context.issue.title,
      userPrompt: parsed.source?.userPrompt ?? context.userPrompt,
      commentsConsidered: parsed.source?.commentsConsidered ?? context.issue.comments.length,
    },
    repoContext:
      parsed.repoContext ??
      {
        likelyFiles: context.repoContext.likelyFiles.map((file) => file.path),
        findings: context.repoContext.findings,
        packageScripts: context.repoContext.packageFiles.flatMap((pkg) =>
          Object.keys(pkg.scripts).map((script) => `${pkg.path}:${script}`)
        ),
      },
  };
  return applyTargetSurfaceGuard(workOrder, context);
}

function applyTargetSurfaceGuard(
  workOrder: WorkOrder,
  context: {
    issue: IssueContext;
    repoContext: RepoContext;
    config: AgentLedgerConfig | null;
  }
) {
  const config = context.config;
  const issueText = [
    context.issue.title,
    context.issue.body,
    ...context.issue.comments
      .filter((comment) => !isAgentLedgerComment(comment.body))
      .map((comment) => comment.body),
  ].join("\n");
  if (namesTargetSurface(issueText, config)) {
    return workOrder;
  }

  const surfaces = plausibleTargetSurfacesFromConfig(context.repoContext, config);
  if (surfaces.length < 2) {
    return workOrder;
  }

  const likelySurface = inferLikelySurfaceFromConfig(workOrder, surfaces, config);
  const alternatives = surfaces.filter((surface) => surface !== likelySurface);
  const question = `Confirm the target surface: should this run change ${likelySurface}, or one of the other plausible surfaces (${alternatives.join(", ")})?`;

  return {
    ...workOrder,
    openQuestions: workOrder.openQuestions.includes(question)
      ? workOrder.openQuestions
      : [question, ...workOrder.openQuestions],
    confidence: workOrder.confidence === "high" ? "medium" : workOrder.confidence,
  };
}

const DEFAULT_EXPLICIT_SURFACE = /\b(admin|web admin|next\.?js|mobile|expo|ios|android|public|marketing|backend|convex|api|server)\b/i;

function namesTargetSurface(value: string, config: AgentLedgerConfig | null) {
  if (config?.targetSurface?.explicitNamePatterns?.length) {
    for (const pattern of config.targetSurface.explicitNamePatterns) {
      try {
        if (new RegExp(pattern, "i").test(value)) {
          return true;
        }
      } catch {
        // ignore invalid config regex
      }
    }
    return false;
  }
  return DEFAULT_EXPLICIT_SURFACE.test(value);
}

function plausibleTargetSurfacesFromConfig(repoContext: RepoContext, config: AgentLedgerConfig | null) {
  const surfaceDefs = config?.targetSurface?.surfaces;
  if (!surfaceDefs || surfaceDefs.length === 0) {
    return [];
  }
  const matches = new Set<string>();
  for (const def of surfaceDefs) {
    const hit = repoContext.likelyFiles.some((f) => pathMatchesSurface(f.path, def));
    if (hit) {
      matches.add(def.label);
    }
  }
  return [...matches];
}

function pathMatchesSurface(
  filePath: string,
  surface: { pathPrefixes?: string[]; pathIncludes?: string[] }
) {
  if (surface.pathPrefixes?.length) {
    for (const p of surface.pathPrefixes) {
      const prefix = p.replace(/^\//, "");
      if (filePath === prefix || filePath.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`)) {
        return true;
      }
    }
  }
  if (surface.pathIncludes?.length) {
    for (const part of surface.pathIncludes) {
      if (filePath.includes(part)) {
        return true;
      }
    }
  }
  return false;
}

function inferLikelySurfaceFromConfig(
  workOrder: WorkOrder,
  surfaceLabels: string[],
  config: AgentLedgerConfig | null
) {
  if (surfaceLabels.length === 0) {
    return "the likely target surface";
  }
  const text = [
    workOrder.interpretedGoal,
    workOrder.problemStatement,
    ...(workOrder.repoContext?.likelyFiles ?? []),
  ]
    .join("\n")
    .toLowerCase();
  for (const def of config?.targetSurface?.surfaces ?? []) {
    if (!surfaceLabels.includes(def.label)) {
      continue;
    }
    if (def.id && text.includes(def.id.toLowerCase())) {
      return def.label;
    }
  }
  return surfaceLabels[0] ?? "the likely target surface";
}

async function nonLedgerGitStatus(repoPath: string) {
  const result = await execa("git", ["status", "--short"], { cwd: repoPath });
  return result.stdout
    .split("\n")
    .filter((line) => line.trim() && !line.includes(" .agent-ledger/") && !line.includes("?? .agent-ledger/"))
    .sort()
    .join("\n");
}

function extractJsonObject(value: string) {
  const trimmed = value.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Cursor interpreter did not return a JSON object.");
  }
  return trimmed.slice(start, end + 1);
}
