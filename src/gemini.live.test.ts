import { describe, it, expect } from "vitest";
import { runGemini } from "./gemini.js";
import { reviewPlan } from "./review.js";

const RUN = !!process.env.GEMINI_LIVE_TEST;

describe.skipIf(!RUN)("live gemini review", () => {
  it("returns structured findings for a small plan", async () => {
    const plan = [
      "Plan: Add user login.",
      "1. Add a /login endpoint that checks username and password.",
      "2. Store passwords in the users table.",
      "3. Return a session cookie on success.",
    ].join("\n");

    const out = await reviewPlan(
      { plan },
      { runGemini: (o) => runGemini({ ...o, timeoutMs: 120_000 }) },
    );

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(Array.isArray(out.result.findings)).toBe(true);
      expect(typeof out.result.summary).toBe("string");
    }
  }, 130_000);
});
