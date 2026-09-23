/**
 * The agent's live task checklist.
 *
 * ACP's `plan` update carries the agent's whole multi-step plan, replaced
 * wholesale on every update rather than patched (GG Coder's own comment: "the
 * client REPLACES its copy on every update rather than patching it"). This
 * module treats it exactly like `contextUsage.ts` treats `usage_update`: a
 * session-level datum, held until replaced, not a per-turn artifact.
 *
 * Pure and Expo-free, so `bun test` can load it.
 */

/** A step's progress. ACP allows other strings; unrecognised ones fold to "pending". */
export type PlanStepStatus = "pending" | "in_progress" | "completed";

export interface PlanStep {
  content: string;
  status: PlanStepStatus;
}

const STATUSES = new Set<PlanStepStatus>(["pending", "in_progress", "completed"]);

/**
 * Pull a `plan` update's step list out of a `session/update` payload.
 *
 * Entries with blank/non-string content are dropped rather than rendered as
 * an empty row. An empty `entries` array is a valid result — that is how the
 * agent clears the plan.
 */
export function readPlan(payload: any): PlanStep[] | undefined {
  const update = payload?.update;
  if (update?.sessionUpdate !== "plan") return undefined;
  if (!Array.isArray(update.entries)) return undefined;
  const steps: PlanStep[] = [];
  for (const entry of update.entries) {
    const content = typeof entry?.content === "string" ? entry.content.trim() : "";
    if (!content) continue;
    const status = STATUSES.has(entry?.status) ? (entry.status as PlanStepStatus) : "pending";
    steps.push({ content, status });
  }
  return steps;
}

/** True when every step is done — used to auto-collapse/fade the checklist. */
export function planComplete(steps: PlanStep[] | undefined): boolean {
  return !!steps && steps.length > 0 && steps.every((s) => s.status === "completed");
}

/** How far through the checklist the agent is, for the card's own heading. */
export function planProgress(steps: PlanStep[]): { done: number; total: number } {
  return { done: steps.filter((s) => s.status === "completed").length, total: steps.length };
}
