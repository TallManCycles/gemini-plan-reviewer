import { describe, it, expect, vi } from "vitest";
import { reviewPlan } from "./review.js";
import type { GeminiRunResult } from "./gemini.js";

function envelope(obj: unknown): GeminiRunResult {
  return { stdout: JSON.stringify({ response: JSON.stringify(obj) }), stderr: "" };
}

const good = {
  summary: "ok",
  findings: [{ severity: "minor", category: "clarity", issue: "i", suggestion: "s" }],
};

describe("reviewPlan", () => {
  it("returns parsed findings on the first try", async () => {
    const runGemini = vi.fn().mockResolvedValue(envelope(good));
    const out = await reviewPlan({ plan: "Build X" }, { runGemini });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result.findings).toHaveLength(1);
    expect(runGemini).toHaveBeenCalledTimes(1);
    // the plan is included in the stdin input
    expect(runGemini.mock.calls[0][0].input).toContain("Build X");
  });

  it("retries once with a stricter prompt when the first parse fails", async () => {
    const runGemini = vi
      .fn()
      .mockResolvedValueOnce({ stdout: JSON.stringify({ response: "garbage" }), stderr: "" })
      .mockResolvedValueOnce(envelope(good));
    const out = await reviewPlan({ plan: "Build X" }, { runGemini });
    expect(out.ok).toBe(true);
    expect(runGemini).toHaveBeenCalledTimes(2);
    // second call used the strict instructions
    const secondInput = runGemini.mock.calls[1][0].input as string;
    expect(secondInput.toLowerCase()).toContain("could not be parsed");
  });

  it("returns a parse failure with raw text when both attempts fail", async () => {
    const bad = { stdout: JSON.stringify({ response: "still garbage" }), stderr: "" };
    const runGemini = vi.fn().mockResolvedValue(bad);
    const out = await reviewPlan({ plan: "Build X" }, { runGemini });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.raw).toContain("still garbage");
    expect(runGemini).toHaveBeenCalledTimes(2);
  });

  it("passes the model through to runGemini", async () => {
    const runGemini = vi.fn().mockResolvedValue(envelope(good));
    await reviewPlan({ plan: "Build X", model: "gemini-flash" }, { runGemini });
    expect(runGemini.mock.calls[0][0].model).toBe("gemini-flash");
  });
});
