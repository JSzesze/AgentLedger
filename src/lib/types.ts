export type Runtime = "local" | "cloud";
export type ClarityMode = "off" | "auto" | "required";
export type InterpreterMode = "cursor" | "cursor-cloud";

export type IssueRef = {
  owner: string;
  repo: string;
  issueNumber: number;
};

export type IssueComment = {
  author: string;
  body: string;
  createdAt: string;
};

export type IssueContext = IssueRef & {
  title: string;
  body: string;
  url: string;
  comments: IssueComment[];
};

export type RunArchive = {
  runId: string;
  dir: string;
  runMetaFile: string;
  attachmentsDir: string;
  attachmentsManifestFile: string;
  issueFile: string;
  repoContextFile: string;
  repoContextJsonFile: string;
  interpretationFile: string;
  workOrderFile: string;
  cursorPromptFile: string;
  promptFile: string;
  cursorInterpreterAgentFile: string;
  interpreterEventsFile: string;
  interpreterTranscriptFile: string;
  interpreterToolCallsFile: string;
  cursorAgentFile: string;
  eventsFile: string;
  transcriptFile: string;
  toolCallsFile: string;
  gitStatusBeforeFile: string;
  gitStatusAfterFile: string;
  changedFilesFile: string;
  diffFile: string;
  checksFile: string;
  reconciliationFile: string;
  summaryFile: string;
  githubCommentsFile: string;
};

export type IssueAttachment = {
  index: number;
  source: string;
  url: string;
  altText?: string;
  localPath?: string;
  mimeType?: string;
  sizeBytes?: number;
  status: "downloaded" | "skipped" | "failed";
  reason?: string;
};

export type RepoContextFile = {
  path: string;
  score: number;
  reasons: string[];
  excerpts: string[];
};

export type RepoContext = {
  repoPath: string;
  packageFiles: Array<{
    path: string;
    name?: string;
    scripts: Record<string, string>;
  }>;
  likelyFiles: RepoContextFile[];
  findings: string[];
  commandsRun: string[];
};

export type WorkOrderConfidence = "high" | "medium" | "low";

export type AcceptanceCriterion = {
  id: string;
  text: string;
};

export type WorkOrder = {
  runKey: string;
  taskType: string;
  interpretedGoal: string;
  problemStatement: string;
  acceptanceCriteria: AcceptanceCriterion[];
  nonGoals: string[];
  constraints: string[];
  openQuestions: string[];
  confidence: WorkOrderConfidence;
  implementationNotes: string[];
  source: {
    issueUrl: string;
    issueTitle: string;
    userPrompt: string;
    commentsConsidered: number;
  };
  repoContext?: {
    likelyFiles: string[];
    findings: string[];
    packageScripts: string[];
  };
};

export type ReconciliationItem = AcceptanceCriterion & {
  status: "likely_matched" | "needs_review" | "not_assessed";
  evidence?: string;
};

export type Reconciliation = {
  result: string;
  acceptanceCriteria: ReconciliationItem[];
  drift: string[];
  reviewNotes: string[];
};

export type CheckResult = {
  command: string;
  status: "passed" | "failed" | "skipped";
  exitCode?: number;
};

export type CursorRunResult = {
  agentId?: string;
  runId?: string;
  status: string;
  durationMs?: number;
  usage?: unknown;
  git?: unknown;
};

export type RunCommandOptions = {
  issue: string;
  repo: string;
  prompt: string;
  check: string[];
  dryRun?: boolean;
  post?: boolean;
  runtime: Runtime;
  branch?: string;
  verbose?: boolean;
  clarity: ClarityMode;
  interpreter: InterpreterMode;
  interpreterModel: string;
  cursorModel: string;
  /** Skip local approval prompt; required for non-TTY (e.g. OpenClaw). */
  yes?: boolean;
  /** Machine-readable output for OpenClaw / scripts. */
  json?: boolean;
  /** Run `agent-ledger doctor` checks first (default true for `run`). */
  doctor?: boolean;
};

export type BasePipelineOptions = {
  issue: string;
  repo: string;
  prompt: string;
  check: string[];
  dryRun?: boolean;
  post?: boolean;
  runtime: Runtime;
  branch?: string;
  verbose?: boolean;
  clarity: ClarityMode;
  interpreter: InterpreterMode;
  interpreterModel: string;
  cursorModel: string;
  json?: boolean;
  doctor?: boolean;
  /** Used by `run` to skip the approval step when true. */
  yes?: boolean;
};
