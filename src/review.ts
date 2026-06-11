import { buildReviewPrompt } from "./prompt.js";
import { parseGeminiOutput, type ParseOutcome } from "./parse.js";
import type { GeminiRunOptions, GeminiRunResult } from "./gemini.js";
import type { ReviewPlanInput } from "./schema.js";

export interface ReviewDeps {
  runGemini: (opts: GeminiRunOptions) => Promise<GeminiRunResult>;
}

/** Combine the plan and review instructions into a single stdin payload. */
function composeInput(plan: string, focusAreas: string[] | undefined, strict: boolean): string {
  return `${plan}\n\n${buildReviewPrompt(focusAreas, strict)}`;
}

/**
 * Orchestrate one review: build the input, run gemini, parse. If parsing fails,
 * retry once with a stricter prompt. Subprocess errors (timeout, non-zero exit,
 * missing binary) propagate as thrown errors.
 */
export async function reviewPlan(
  input: ReviewPlanInput,
  deps: ReviewDeps,
): Promise<ParseOutcome> {
  const first = await deps.runGemini({
    input: composeInput(input.plan, input.focus_areas, false),
    model: input.model,
  });
  const firstOutcome = parseGeminiOutput(first.stdout);
  if (firstOutcome.ok) return firstOutcome;

  const second = await deps.runGemini({
    input: composeInput(input.plan, input.focus_areas, true),
    model: input.model,
  });
  return parseGeminiOutput(second.stdout);
}
