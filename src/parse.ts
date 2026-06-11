import { ReviewResultSchema, type ReviewResult } from "./schema.js";

export interface ParseSuccess {
  ok: true;
  result: ReviewResult;
}

export interface ParseFailure {
  ok: false;
  raw: string;
  error: string;
}

export type ParseOutcome = ParseSuccess | ParseFailure;

/** Unwrap the `gemini -o json` envelope and return the model's response text. */
export function extractResponseText(stdout: string): string {
  const envelope = JSON.parse(stdout);
  if (typeof envelope?.response !== "string") {
    throw new Error("gemini JSON envelope is missing a string 'response' field");
  }
  return envelope.response;
}

/** Strip markdown fences and extract the outermost {...} JSON object substring. */
export function extractJsonObject(text: string): string {
  let t = text.trim();

  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) {
    t = fence[1].trim();
  }

  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("no JSON object found in model response");
  }
  return t.slice(start, end + 1);
}

/** Full pipeline: envelope -> response text -> JSON object -> validated findings. */
export function parseGeminiOutput(stdout: string): ParseOutcome {
  try {
    const responseText = extractResponseText(stdout);
    const jsonStr = extractJsonObject(responseText);
    const parsed = JSON.parse(jsonStr);
    const result = ReviewResultSchema.parse(parsed);
    return { ok: true, result };
  } catch (err) {
    return {
      ok: false,
      raw: stdout,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
