import { describe, it, expect } from "vitest";
import { extractResponseText, extractJsonObject, parseGeminiOutput } from "./parse.js";

const findings = {
  summary: "Decent plan",
  findings: [
    { severity: "major", category: "risk", issue: "No rollback", suggestion: "Add one" },
  ],
};

function envelope(responseText: string): string {
  return JSON.stringify({ session_id: "abc", response: responseText, stats: {} });
}

describe("extractResponseText", () => {
  it("returns the response field from the envelope", () => {
    expect(extractResponseText(envelope("hello"))).toBe("hello");
  });

  it("throws when response field is missing", () => {
    expect(() => extractResponseText(JSON.stringify({ session_id: "x" }))).toThrow();
  });
});

describe("extractJsonObject", () => {
  it("returns plain JSON unchanged", () => {
    const s = '{"a":1}';
    expect(extractJsonObject(s)).toBe(s);
  });

  it("strips ```json fences", () => {
    const fenced = "```json\n{\"a\":1}\n```";
    expect(JSON.parse(extractJsonObject(fenced))).toEqual({ a: 1 });
  });

  it("extracts an object embedded in prose", () => {
    const prose = 'Here is the review:\n{"a":1}\nThanks!';
    expect(JSON.parse(extractJsonObject(prose))).toEqual({ a: 1 });
  });

  it("throws when no object is present", () => {
    expect(() => extractJsonObject("no json here")).toThrow();
  });
});

describe("parseGeminiOutput", () => {
  it("parses clean structured findings", () => {
    const out = parseGeminiOutput(envelope(JSON.stringify(findings)));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result.findings[0].issue).toBe("No rollback");
  });

  it("parses findings wrapped in markdown fences", () => {
    const fenced = "```json\n" + JSON.stringify(findings) + "\n```";
    const out = parseGeminiOutput(envelope(fenced));
    expect(out.ok).toBe(true);
  });

  it("fails gracefully on malformed findings", () => {
    const out = parseGeminiOutput(envelope("not json at all"));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.raw).toContain("not json at all");
  });

  it("fails when the inner JSON violates the schema", () => {
    const bad = JSON.stringify({ summary: "x", findings: [{ severity: "blocker" }] });
    const out = parseGeminiOutput(envelope(bad));
    expect(out.ok).toBe(false);
  });
});
