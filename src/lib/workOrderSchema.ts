import { z, prettifyError } from "zod";
import type { WorkOrder } from "./types.js";

const confidenceSchema = z.enum(["high", "medium", "low"]);

const acceptanceCriterionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
});

const sourceSchema = z.object({
  issueUrl: z.string().min(1),
  issueTitle: z.string().min(1),
  userPrompt: z.string().min(1),
  commentsConsidered: z.number().int().min(0),
});

const repoContextSchema = z.object({
  likelyFiles: z.array(z.string()),
  findings: z.array(z.string()),
  packageScripts: z.array(z.string()),
});

export const workOrderSchema = z.object({
  runKey: z.string().min(1),
  taskType: z.string().min(1),
  interpretedGoal: z.string().min(1),
  problemStatement: z.string().min(1),
  acceptanceCriteria: z.array(acceptanceCriterionSchema),
  nonGoals: z.array(z.string()),
  constraints: z.array(z.string()),
  openQuestions: z.array(z.string()),
  confidence: confidenceSchema,
  implementationNotes: z.array(z.string()),
  source: sourceSchema,
  repoContext: repoContextSchema.optional(),
});

export function parseAndValidateWorkOrder(value: unknown, label = "work-order.json"): WorkOrder {
  const parsed = workOrderSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid work order in ${label}: ${prettifyError(parsed.error)}`);
  }
  return parsed.data as WorkOrder;
}

export function tryParseWorkOrderJson(raw: string, label: string): WorkOrder {
  let data: unknown;
  try {
    data = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(
      `Failed to parse JSON in ${label}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return parseAndValidateWorkOrder(data, label);
}
