#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { runCommand } from "./commands/run.js";
import { doctorCommand } from "./commands/doctor.js";
import { interpretCommand } from "./commands/interpret.js";
import { executeCommandOnly } from "./commands/execute.js";
import { runsListCommand } from "./commands/runs.js";
import type { RunCommandOptions } from "./lib/types.js";

const program = new Command();

program
  .name("agent-ledger")
  .description(
    "Interpret GitHub issues into coding-agent work orders, run Cursor, and post a paper trail on the issue."
  )
  .version("0.1.0");

addRunCommand();
addInterpretCommand();
addExecuteCommand();
addRunsCommand();
addDoctorCommand();

await program.parseAsync(process.argv);

function collect(value: string, previous: string[]) {
  previous.push(value);
  return previous;
}

function rethrowError(error: unknown, options: { json?: boolean } = {}) {
  const message = error instanceof Error ? error.message : String(error);
  const exitCode =
    error &&
    typeof error === "object" &&
    "exitCode" in error &&
    typeof (error as { exitCode: number }).exitCode === "number"
      ? (error as { exitCode: number }).exitCode
      : 1;
  if (options.json) {
    console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  } else {
    console.error(`agent-ledger: ${message}`);
  }
  process.exitCode = exitCode;
}

function mapNoDoctor(options: { noDoctor?: boolean; doctor?: boolean }): { doctor: boolean } {
  if (options.noDoctor) {
    return { doctor: false };
  }
  return { doctor: options.doctor !== false };
}

function addRunCommand() {
  const cmd = program
    .command("run")
    .description("Interpret, optionally confirm, then run a Cursor agent and post results.")
    .requiredOption("--issue <issue>", "GitHub issue URL or issue number")
    .requiredOption("--repo <path>", "Local repository path")
    .option(
      "--prompt <prompt>",
      "Additional instruction for the coding agent",
      "Fix the issue described here"
    )
    .option("--check <command>", "Command to run after agent work. Repeatable.", collect, [] as string[])
    .option("--dry-run", "Preview only: write interpretation archive, skip coding agent, checks, and GitHub posting", false)
    .option("--no-post", "Do not post comments to GitHub")
    .option("--runtime <runtime>", "local | cloud", "local")
    .option(
      "--clarity <mode>",
      "Clarity gate: off | auto | required",
      "auto"
    )
    .option("--interpreter <mode>", "cursor | cursor-cloud", "cursor")
    .option(
      "--interpreter-model <model>",
      "Cursor model for issue interpretation",
      process.env.AGENT_LEDGER_INTERPRETER_MODEL ??
        process.env.AGENT_LEDGER_CURSOR_MODEL ??
        "composer-2"
    )
    .option(
      "--cursor-model <model>",
      "Cursor model for coding agent",
      process.env.AGENT_LEDGER_CURSOR_MODEL ?? "composer-2"
    )
    .option("--branch <branch>", "Optional branch for notes")
    .option("--verbose", "Print detailed stream events", false)
    .option("-y, --yes", "Skip local approval; run the coding agent after interpret", false)
    .option("--json", "Machine-readable output (OpenClaw / automation)", false)
    .option("--no-doctor", "Skip preflight checks (gh, key, issue)", false);

  cmd.addHelpText(
    "after",
    `
Examples:
  agent-ledger run --issue https://github.com/org/repo/issues/184 --repo /path/to/repo --yes --json --no-post
  agent-ledger run --issue 184 --repo /path/to/repo --check "npm test" --check "npm run typecheck"
  agent-ledger run --issue 184 --repo /path/to/repo --dry-run --json

Exit codes: 0 success, 1 error, 2 clarity gate (no coding run).
`
  );

  cmd.action(async (raw: Record<string, unknown>) => {
    try {
      const { noDoctor, ...rest } = raw;
      const doctorMap = noDoctor ? { doctor: false } : {};
      const opts: RunCommandOptions = {
        ...(rest as RunCommandOptions),
        ...doctorMap,
      } as RunCommandOptions;
      await runCommand(opts);
    } catch (error) {
      rethrowError(error, { json: Boolean(raw.json) });
    }
  });
}

function addInterpretCommand() {
  program
    .command("interpret")
    .description("Run interpreter only: save work order and `run-meta.json`; no coding run.")
    .requiredOption("--issue <issue>", "GitHub issue URL or number")
    .requiredOption("--repo <path>", "Local repository path")
    .option(
      "--prompt <prompt>",
      "Additional context",
      "Fix the issue described here"
    )
    .option(
      "--check <command>",
      "Checks are applied when you later run `execute` with the same run id. Repeatable.",
      collect,
      [] as string[]
    )
    .option("--dry-run", "Write local interpretation archive but do not post to GitHub", false)
    .option("--no-post", "Do not post comments to GitHub")
    .option("--runtime <runtime>", "local | cloud", "local")
    .option("--clarity <mode>", "Affects work-order wording in some cases", "auto")
    .option("--interpreter <mode>", "cursor | cursor-cloud", "cursor")
    .option(
      "--interpreter-model <model>",
      "Model for interpretation",
      process.env.AGENT_LEDGER_INTERPRETER_MODEL ?? "composer-2"
    )
    .option(
      "--cursor-model <model>",
      "Model stored for a later `execute`",
      process.env.AGENT_LEDGER_CURSOR_MODEL ?? "composer-2"
    )
    .option("--branch <branch>", "Optional")
    .option("--verbose", "Print interpreter details", false)
    .option("--json", "JSON output", false)
    .option("--no-doctor", "Skip preflight", false)
    .addHelpText(
      "after",
      `
Examples:
  agent-ledger interpret --issue https://github.com/org/repo/issues/184 --repo /path/to/repo --json
  agent-ledger interpret --issue 184 --repo /path/to/repo --check "npm test" --no-post
  agent-ledger execute --run-id <run-id> --repo /path/to/repo --no-post
`
    )
    .action(async (raw: Record<string, unknown>) => {
      try {
        const { noDoctor, ...rest } = raw;
        const doctor = noDoctor ? false : (rest as { doctor?: boolean }).doctor !== false;
        await interpretCommand({ ...rest, doctor, json: raw.json as boolean | undefined });
      } catch (error) {
        rethrowError(error, { json: Boolean(raw.json) });
      }
    });
}

function addExecuteCommand() {
  program
    .command("execute")
    .description("Run the coding step from a previous `interpret` (same archive / run id).")
    .requiredOption("--run-id <id>", "From `.agent-ledger/runs/<run-id>/`")
    .requiredOption("--repo <path>", "Same repo as the interpret run")
    .option("--prompt <prompt>", "Override the stored user prompt for coding")
    .option(
      "--check <command>",
      "Commands to run after the agent. Replaces any stored if one is passed. Repeatable.",
      collect,
      [] as string[]
    )
    .option("--dry-run", "Preview resume target without launching the coding agent, checks, or posting", false)
    .option("--no-post", "Do not post the completion comment to GitHub")
    .option("--cursor-model <model>", "Override the stored model for coding")
    .option("--verbose", "Print agent details", false)
    .option("--json", "JSON output", false)
    .option("--no-doctor", "Skip preflight", false)
    .addHelpText(
      "after",
      `
Examples:
  agent-ledger execute --run-id 20260102-120000-issue-184 --repo /path/to/repo --json
  agent-ledger execute --run-id 20260102-120000-issue-184 --repo /path/to/repo --check "npm test" --no-post
  agent-ledger execute --run-id 20260102-120000-issue-184 --repo /path/to/repo --dry-run --json
`
    )
    .action(async (raw: Record<string, unknown>) => {
      try {
        const { noDoctor, ...rest } = raw;
        const doctor = noDoctor ? false : (rest as { doctor?: boolean }).doctor !== false;
        await executeCommandOnly({ ...rest, doctor });
      } catch (error) {
        rethrowError(error, { json: Boolean(raw.json) });
      }
    });
}

function addRunsCommand() {
  const runs = program
    .command("runs")
    .description("Inspect AgentLedger on-disk run archives (paper trail directories).");
  runs
    .command("list")
    .description("List run ids under <repo>/.agent-ledger/runs (newest first).")
    .requiredOption("--repo <path>", "Local repository path")
    .option("--json", "Machine-readable output (e.g. for CTL or scripts).", false)
    .option(
      "--limit <n>",
      "Max runs to list (1–500).",
      (v) => parseInt(v, 10),
      200
    )
    .addHelpText(
      "after",
      `
Examples:
  agent-ledger runs list --repo /path/to/repo
  agent-ledger runs list --repo /path/to/repo --limit 20 --json
`
    )
    .action(async (raw: { repo: string; json?: boolean; limit?: number }) => {
      try {
        const limit =
          raw.limit === undefined || Number.isNaN(raw.limit)
            ? 200
            : Math.min(500, Math.max(1, raw.limit));
        await runsListCommand({ repo: raw.repo, json: Boolean(raw.json), limit });
      } catch (error) {
        rethrowError(error, { json: Boolean(raw.json) });
      }
    });
}

function addDoctorCommand() {
  program
    .command("doctor")
    .description("Check gh, auth, CURSOR_API_KEY, optional issue access, and repo dirtiness.")
    .option("--issue <issue>", "Optional issue URL/number (use with --repo)")
    .option("--repo <path>", "Optional local repo for git + dirty checks")
    .option(
      "--fail-on-dirty",
      "Exit 1 on uncommitted changes outside .agent-ledger/",
      false
    )
    .option("--json", "JSON output", false)
    .addHelpText(
      "after",
      `
Examples:
  agent-ledger doctor
  agent-ledger doctor --repo /path/to/repo --issue 184 --json
  agent-ledger doctor --repo /path/to/repo --fail-on-dirty
`
    )
    .action(async (raw) => {
      try {
        await doctorCommand(raw);
      } catch (error) {
        rethrowError(error, { json: Boolean(raw.json) });
      }
    });
}
