# Gemini Plan Reviewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a stdio MCP server in TypeScript that lets Claude send a plan/spec to the Gemini CLI and get back structured review findings (severity + category + issue + suggestion).

**Architecture:** A thin MCP server exposing one tool, `review_plan`. Each call builds a review instruction, spawns the `gemini` CLI headlessly (plan piped via stdin, `-o json` envelope out), then unwraps, parses, and validates the findings. Logic is split into small pure modules (`prompt`, `parse`, `render`, `gemini`, `review`) so each is unit-testable; `index.ts` is thin wiring.

**Tech Stack:** Node 22, TypeScript (ES modules, `Node16` resolution), `@modelcontextprotocol/sdk`, `zod` v3, `vitest` for tests, `tsx` for dev.

**Notes / deviations from the spec (intentional, verified against the installed CLI v0.46):**
- **Default model:** The CLI's own default is `gemini-3.1-pro-preview`. Rather than hard-code a (now stale) `gemini-2.5-pro`, the server passes **no `-m` flag by default** and lets the gemini CLI use its configured default. `GEMINI_MODEL` env or a per-call `model` argument still override by adding `-m`.
- **Failure detection keys off exit code only.** Gemini prints harmless warnings (true-color, ripgrep) to stderr while exiting 0. stderr is captured for diagnostics but never used to decide success.
- **Two extra modules** beyond the spec's five — `render.ts` (findings → markdown) and `review.ts` (orchestration + parse-retry) — keep `index.ts` thin and make the retry/render logic unit-testable.

**Verified envelope shape** from `gemini ... -o json`:
```json
{ "session_id": "…", "response": "<model text>", "stats": { … } }
```
The model's answer is the `response` string; our findings JSON lives inside it.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `package.json` | Package metadata, scripts, `bin`, deps |
| `tsconfig.json` | TS compiler config (ESM, Node16) |
| `vitest.config.ts` | Test config |
| `.gitignore` | Ignore `node_modules`, `dist` |
| `src/schema.ts` | zod schemas + types: tool input, finding, review result |
| `src/prompt.ts` | `buildReviewPrompt()` — pure instruction builder |
| `src/parse.ts` | Unwrap envelope, strip fences, parse + validate findings |
| `src/render.ts` | `renderFindings()` — review result → markdown |
| `src/gemini.ts` | `buildGeminiArgs()`, `runGemini()` — subprocess (injectable spawn) |
| `src/review.ts` | `reviewPlan()` — orchestrate prompt → run → parse → retry |
| `src/index.ts` | `createServer()` + `main()` — MCP tool registration & stdio transport |
| `src/*.test.ts` | Unit/integration tests per module |
| `src/gemini.live.test.ts` | Optional live smoke test, gated by `GEMINI_LIVE_TEST` |
| `README.md` | Usage + Claude Code registration snippet |

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`

- [ ] **Step 1: Create `.gitignore`**

```
node_modules/
dist/
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "gemini-plan-reviewer",
  "version": "0.1.0",
  "description": "MCP server that sends plans to the Gemini CLI for structured review",
  "type": "module",
  "bin": {
    "gemini-plan-reviewer": "dist/index.js"
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "license": "MIT"
}
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "src/**/*.test.ts", "src/**/*.live.test.ts"]
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Install dependencies**

Run:
```bash
npm install @modelcontextprotocol/sdk zod@3
npm install -D typescript tsx vitest @types/node
```
Expected: both complete without errors; `node_modules/` and `package-lock.json` created.

(zod is pinned to v3 because the MCP SDK's tool-schema integration targets zod 3.)

- [ ] **Step 6: Commit**

```bash
git add .gitignore package.json package-lock.json tsconfig.json vitest.config.ts
git commit -m "chore: scaffold gemini-plan-reviewer project"
```

---

## Task 2: Schemas (`src/schema.ts`)

**Files:**
- Create: `src/schema.ts`
- Test: `src/schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/schema.test.ts
import { describe, it, expect } from "vitest";
import {
  FindingSchema,
  ReviewResultSchema,
  ReviewPlanInputSchema,
} from "./schema.js";

describe("FindingSchema", () => {
  it("accepts a well-formed finding", () => {
    const f = {
      severity: "major",
      category: "risk",
      issue: "No rollback plan",
      suggestion: "Add a rollback section",
    };
    expect(FindingSchema.parse(f)).toEqual(f);
  });

  it("rejects an unknown severity", () => {
    const f = { severity: "blocker", category: "risk", issue: "x", suggestion: "y" };
    expect(() => FindingSchema.parse(f)).toThrow();
  });
});

describe("ReviewResultSchema", () => {
  it("accepts an empty findings list", () => {
    const r = { summary: "Looks good", findings: [] };
    expect(ReviewResultSchema.parse(r)).toEqual(r);
  });
});

describe("ReviewPlanInputSchema", () => {
  it("rejects an empty plan", () => {
    expect(() => ReviewPlanInputSchema.parse({ plan: "   " })).toThrow();
  });

  it("accepts plan with optional fields", () => {
    const input = { plan: "Build X", focus_areas: ["security"], model: "gemini-3.1-pro-preview" };
    expect(ReviewPlanInputSchema.parse(input)).toEqual(input);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/schema.test.ts`
Expected: FAIL — cannot find module `./schema.js`.

- [ ] **Step 3: Write `src/schema.ts`**

```ts
import { z } from "zod";

export const SeveritySchema = z.enum(["critical", "major", "minor"]);

export const FindingSchema = z.object({
  severity: SeveritySchema,
  category: z.string().min(1),
  issue: z.string().min(1),
  suggestion: z.string().min(1),
});

export const ReviewResultSchema = z.object({
  summary: z.string(),
  findings: z.array(FindingSchema),
});

// Raw shape reused directly as the MCP tool inputSchema.
export const reviewPlanInputShape = {
  plan: z.string().trim().min(1, "plan must not be empty"),
  focus_areas: z.array(z.string()).optional(),
  model: z.string().optional(),
} as const;

export const ReviewPlanInputSchema = z.object(reviewPlanInputShape);

export type Severity = z.infer<typeof SeveritySchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type ReviewResult = z.infer<typeof ReviewResultSchema>;
export type ReviewPlanInput = z.infer<typeof ReviewPlanInputSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/schema.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/schema.ts src/schema.test.ts
git commit -m "feat: add zod schemas for input and findings"
```

---

## Task 3: Prompt builder (`src/prompt.ts`)

**Files:**
- Create: `src/prompt.ts`
- Test: `src/prompt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/prompt.test.ts
import { describe, it, expect } from "vitest";
import { buildReviewPrompt } from "./prompt.js";

describe("buildReviewPrompt", () => {
  it("includes the JSON output contract", () => {
    const p = buildReviewPrompt();
    expect(p).toContain('"summary"');
    expect(p).toContain('"findings"');
    expect(p).toContain("critical");
    expect(p).toContain("ONLY");
  });

  it("includes focus areas when provided", () => {
    const p = buildReviewPrompt(["security", "edge cases"]);
    expect(p).toContain("security");
    expect(p).toContain("edge cases");
  });

  it("omits the focus line when no areas given", () => {
    const p = buildReviewPrompt();
    expect(p).not.toContain("Pay particular attention");
  });

  it("adds a stricter reminder in strict mode", () => {
    const p = buildReviewPrompt(undefined, true);
    expect(p.toLowerCase()).toContain("could not be parsed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/prompt.test.ts`
Expected: FAIL — cannot find module `./prompt.js`.

- [ ] **Step 3: Write `src/prompt.ts`**

```ts
const JSON_CONTRACT = `Respond with ONLY a single JSON object and nothing else. Do not include explanatory prose. Do not wrap it in markdown code fences or backticks. The JSON object MUST match this exact shape:

{
  "summary": "<one-paragraph overall assessment of the plan>",
  "findings": [
    {
      "severity": "critical" | "major" | "minor",
      "category": "<short category, e.g. completeness, risk, feasibility, security, clarity>",
      "issue": "<what is wrong, missing, or risky>",
      "suggestion": "<a concrete, actionable improvement>"
    }
  ]
}

If the plan is already solid, return an empty "findings" array and say so in the summary.`;

export function buildReviewPrompt(focusAreas?: string[], strict = false): string {
  const strictPrefix = strict
    ? "IMPORTANT: Your previous response could not be parsed as JSON. Return ONLY raw JSON — no prose, no markdown fences, no backticks.\n\n"
    : "";

  const focusLine =
    focusAreas && focusAreas.length > 0
      ? `\n\nPay particular attention to these focus areas: ${focusAreas.join(", ")}.`
      : "";

  return `${strictPrefix}The text above (provided via stdin) is a software implementation plan or specification.

Review it as an experienced staff engineer. Identify gaps, risks, incorrect assumptions, missing edge cases, unclear requirements, and concrete opportunities to make the plan stronger. For every point, give an actionable suggestion.${focusLine}

${JSON_CONTRACT}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/prompt.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/prompt.ts src/prompt.test.ts
git commit -m "feat: add review prompt builder"
```

---

## Task 4: Output parser (`src/parse.ts`)

**Files:**
- Create: `src/parse.ts`
- Test: `src/parse.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/parse.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/parse.test.ts`
Expected: FAIL — cannot find module `./parse.js`.

- [ ] **Step 3: Write `src/parse.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/parse.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/parse.ts src/parse.test.ts
git commit -m "feat: add gemini output parser"
```

---

## Task 5: Markdown renderer (`src/render.ts`)

**Files:**
- Create: `src/render.ts`
- Test: `src/render.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/render.test.ts
import { describe, it, expect } from "vitest";
import { renderFindings } from "./render.js";
import type { ReviewResult } from "./schema.js";

describe("renderFindings", () => {
  it("renders summary and groups by severity in order", () => {
    const result: ReviewResult = {
      summary: "Overall solid.",
      findings: [
        { severity: "minor", category: "clarity", issue: "Vague naming", suggestion: "Rename" },
        { severity: "critical", category: "risk", issue: "Data loss", suggestion: "Add backups" },
      ],
    };
    const md = renderFindings(result);
    expect(md).toContain("Overall solid.");
    expect(md).toContain("Critical");
    expect(md).toContain("Minor");
    // critical section appears before minor section
    expect(md.indexOf("Critical")).toBeLessThan(md.indexOf("Minor"));
    expect(md).toContain("Data loss");
    expect(md).toContain("Add backups");
  });

  it("states when there are no findings", () => {
    const md = renderFindings({ summary: "Great plan.", findings: [] });
    expect(md).toContain("Great plan.");
    expect(md.toLowerCase()).toContain("no issues");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/render.test.ts`
Expected: FAIL — cannot find module `./render.js`.

- [ ] **Step 3: Write `src/render.ts`**

```ts
import type { ReviewResult, Severity } from "./schema.js";

const SEVERITY_ORDER: Severity[] = ["critical", "major", "minor"];
const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  major: "Major",
  minor: "Minor",
};

export function renderFindings(result: ReviewResult): string {
  const lines: string[] = ["## Gemini Plan Review", "", result.summary, ""];

  if (result.findings.length === 0) {
    lines.push("No issues found.");
    return lines.join("\n");
  }

  for (const severity of SEVERITY_ORDER) {
    const group = result.findings.filter((f) => f.severity === severity);
    if (group.length === 0) continue;

    lines.push(`### ${SEVERITY_LABEL[severity]}`, "");
    for (const f of group) {
      lines.push(`- **${f.category}** — ${f.issue}`);
      lines.push(`  - Suggestion: ${f.suggestion}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/render.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render.ts src/render.test.ts
git commit -m "feat: add markdown renderer for findings"
```

---

## Task 6: Gemini subprocess runner (`src/gemini.ts`)

**Files:**
- Create: `src/gemini.ts`
- Test: `src/gemini.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/gemini.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { buildGeminiArgs, runGemini } from "./gemini.js";

function makeFakeChild() {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child._stdin = [] as string[];
  child.stdin = {
    write: (d: string) => child._stdin.push(d),
    end: () => {},
  };
  child.kill = vi.fn();
  return child;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("buildGeminiArgs", () => {
  it("includes plan-mode, skip-trust, json output and no -m by default", () => {
    const args = buildGeminiArgs("INSTRUCTIONS");
    expect(args).toEqual([
      "-p", "INSTRUCTIONS",
      "--approval-mode", "plan",
      "--skip-trust",
      "-o", "json",
    ]);
  });

  it("appends -m when a model is given", () => {
    const args = buildGeminiArgs("I", "gemini-3.1-pro-preview");
    expect(args).toContain("-m");
    expect(args).toContain("gemini-3.1-pro-preview");
  });
});

describe("runGemini", () => {
  it("resolves with stdout/stderr and writes the plan to stdin on exit 0", async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn(() => child) as any;
    const p = runGemini({ plan: "MY PLAN", instructions: "I", spawnFn });

    child.stdout.emit("data", Buffer.from('{"response":"ok"}'));
    child.stderr.emit("data", Buffer.from("Warning: harmless"));
    child.emit("close", 0);

    await expect(p).resolves.toEqual({
      stdout: '{"response":"ok"}',
      stderr: "Warning: harmless",
    });
    expect(child._stdin.join("")).toBe("MY PLAN");
    expect(spawnFn).toHaveBeenCalledWith("gemini", expect.any(Array), expect.any(Object));
  });

  it("rejects on a non-zero exit code, including stderr", async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn(() => child) as any;
    const p = runGemini({ plan: "P", instructions: "I", spawnFn });

    child.stderr.emit("data", Buffer.from("boom"));
    child.emit("close", 2);

    await expect(p).rejects.toThrow(/code 2/);
    await expect(p).rejects.toThrow(/boom/);
  });

  it("rejects with a clear message when the binary is missing", async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn(() => child) as any;
    const p = runGemini({ plan: "P", instructions: "I", spawnFn });

    child.emit("error", new Error("spawn gemini ENOENT"));

    await expect(p).rejects.toThrow(/failed to start gemini/);
  });

  it("kills the process and rejects on timeout", async () => {
    vi.useFakeTimers();
    const child = makeFakeChild();
    const spawnFn = vi.fn(() => child) as any;
    const p = runGemini({ plan: "P", instructions: "I", spawnFn, timeoutMs: 1000 });

    vi.advanceTimersByTime(1001);

    await expect(p).rejects.toThrow(/timed out/);
    expect(child.kill).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/gemini.test.ts`
Expected: FAIL — cannot find module `./gemini.js`.

- [ ] **Step 3: Write `src/gemini.ts`**

```ts
import { spawn as nodeSpawn } from "node:child_process";

export interface GeminiRunOptions {
  /** Plan text written to the gemini process stdin. */
  plan: string;
  /** Review instructions passed via -p. */
  instructions: string;
  /** Optional model id; when set, adds `-m <model>`. */
  model?: string;
  /** Kill the subprocess after this many ms. Default 120000. */
  timeoutMs?: number;
  /** Injectable spawn for testing. Defaults to node:child_process spawn. */
  spawnFn?: typeof nodeSpawn;
  /** Path/command for the gemini binary. Default "gemini". */
  geminiPath?: string;
}

export interface GeminiRunResult {
  stdout: string;
  stderr: string;
}

export function buildGeminiArgs(instructions: string, model?: string): string[] {
  const args = [
    "-p", instructions,
    "--approval-mode", "plan",
    "--skip-trust",
    "-o", "json",
  ];
  if (model) {
    args.push("-m", model);
  }
  return args;
}

export function runGemini(opts: GeminiRunOptions): Promise<GeminiRunResult> {
  const spawnFn = opts.spawnFn ?? nodeSpawn;
  const geminiPath = opts.geminiPath ?? "gemini";
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const args = buildGeminiArgs(opts.instructions, opts.model);

  return new Promise<GeminiRunResult>((resolve, reject) => {
    const child = spawnFn(geminiPath, args, { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => {
        child.kill("SIGKILL");
        reject(new Error(`gemini timed out after ${timeoutMs}ms`));
      });
    }, timeoutMs);

    child.on("error", (err) => {
      finish(() => reject(new Error(`failed to start gemini: ${err.message}`)));
    });

    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });

    // Success/failure is decided by exit code only — gemini prints warnings to
    // stderr while still exiting 0.
    child.on("close", (code) => {
      finish(() => {
        if (code !== 0) {
          reject(new Error(`gemini exited with code ${code}: ${stderr.trim()}`));
          return;
        }
        resolve({ stdout, stderr });
      });
    });

    child.stdin?.write(opts.plan);
    child.stdin?.end();
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/gemini.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/gemini.ts src/gemini.test.ts
git commit -m "feat: add gemini subprocess runner"
```

---

## Task 7: Review orchestration (`src/review.ts`)

**Files:**
- Create: `src/review.ts`
- Test: `src/review.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/review.test.ts
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
    const secondInstructions = runGemini.mock.calls[1][0].instructions as string;
    expect(secondInstructions.toLowerCase()).toContain("could not be parsed");
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/review.test.ts`
Expected: FAIL — cannot find module `./review.js`.

- [ ] **Step 3: Write `src/review.ts`**

```ts
import { buildReviewPrompt } from "./prompt.js";
import { parseGeminiOutput, type ParseOutcome } from "./parse.js";
import type { GeminiRunOptions, GeminiRunResult } from "./gemini.js";
import type { ReviewPlanInput } from "./schema.js";

export interface ReviewDeps {
  runGemini: (opts: GeminiRunOptions) => Promise<GeminiRunResult>;
}

/**
 * Orchestrate one review: build the prompt, run gemini, parse. If parsing
 * fails, retry once with a stricter prompt. Subprocess errors (timeout,
 * non-zero exit, missing binary) propagate as thrown errors.
 */
export async function reviewPlan(
  input: ReviewPlanInput,
  deps: ReviewDeps,
): Promise<ParseOutcome> {
  const first = await deps.runGemini({
    plan: input.plan,
    instructions: buildReviewPrompt(input.focus_areas),
    model: input.model,
  });
  const firstOutcome = parseGeminiOutput(first.stdout);
  if (firstOutcome.ok) return firstOutcome;

  const second = await deps.runGemini({
    plan: input.plan,
    instructions: buildReviewPrompt(input.focus_areas, true),
    model: input.model,
  });
  return parseGeminiOutput(second.stdout);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/review.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/review.ts src/review.test.ts
git commit -m "feat: add review orchestration with parse retry"
```

---

## Task 8: MCP server wiring (`src/index.ts`)

**Files:**
- Create: `src/index.ts`
- Test: `src/index.test.ts`

- [ ] **Step 1: Write the failing test**

This test connects a real MCP client to the server in-process via the SDK's in-memory transport, injecting a fake `runGemini` so no real subprocess runs.

```ts
// src/index.test.ts
import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "./index.js";
import type { GeminiRunResult } from "./gemini.js";

function fakeRun(obj: unknown) {
  return async (): Promise<GeminiRunResult> => ({
    stdout: JSON.stringify({ response: JSON.stringify(obj) }),
    stderr: "",
  });
}

const good = {
  summary: "Solid plan.",
  findings: [{ severity: "major", category: "risk", issue: "No rollback", suggestion: "Add one" }],
};

async function connect(runGemini: any) {
  const server = createServer({ runGemini });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientT);
  return client;
}

describe("review_plan tool", () => {
  it("is registered", async () => {
    const client = await connect(fakeRun(good));
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain("review_plan");
    await client.close();
  });

  it("returns structured findings and markdown for a valid plan", async () => {
    const client = await connect(fakeRun(good));
    const res: any = await client.callTool({
      name: "review_plan",
      arguments: { plan: "Build a thing" },
    });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent.findings).toHaveLength(1);
    expect(res.content[0].text).toContain("No rollback");
    await client.close();
  });

  it("returns raw text (no structuredContent) when parsing fails twice", async () => {
    const garbage = async () => ({
      stdout: JSON.stringify({ response: "totally not json" }),
      stderr: "",
    });
    const client = await connect(garbage);
    const res: any = await client.callTool({
      name: "review_plan",
      arguments: { plan: "Build a thing" },
    });
    expect(res.structuredContent).toBeUndefined();
    expect(res.content[0].text.toLowerCase()).toContain("could not be parsed");
    await client.close();
  });

  it("reports an error when gemini throws", async () => {
    const throwing = async () => {
      throw new Error("gemini exited with code 1: boom");
    };
    const client = await connect(throwing);
    const res: any = await client.callTool({
      name: "review_plan",
      arguments: { plan: "Build a thing" },
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("boom");
    await client.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/index.test.ts`
Expected: FAIL — cannot find module `./index.js`.

- [ ] **Step 3: Write `src/index.ts`**

```ts
import { fileURLToPath } from "node:url";
import { spawn as nodeSpawn } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { reviewPlanInputShape } from "./schema.js";
import { runGemini, type GeminiRunOptions, type GeminiRunResult } from "./gemini.js";
import { reviewPlan } from "./review.js";
import { renderFindings } from "./render.js";

export interface ServerDeps {
  runGemini: (opts: GeminiRunOptions) => Promise<GeminiRunResult>;
  /** Default model used when the caller doesn't supply one. */
  defaultModel?: string;
}

export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer({
    name: "gemini-plan-reviewer",
    version: "0.1.0",
  });

  server.registerTool(
    "review_plan",
    {
      title: "Review Plan with Gemini",
      description:
        "Send a plan or spec to the Gemini CLI for an independent review. " +
        "Returns structured findings (severity, category, issue, suggestion). " +
        "Optionally steer the review with focus_areas or override the model.",
      inputSchema: reviewPlanInputShape,
    },
    async ({ plan, focus_areas, model }) => {
      try {
        const outcome = await reviewPlan(
          { plan, focus_areas, model: model ?? deps.defaultModel },
          { runGemini: deps.runGemini },
        );

        if (outcome.ok) {
          return {
            content: [{ type: "text", text: renderFindings(outcome.result) }],
            structuredContent: outcome.result,
          };
        }

        return {
          content: [
            {
              type: "text",
              text:
                "Gemini returned a review, but it could not be parsed into " +
                `structured findings (${outcome.error}). Raw response:\n\n${outcome.raw}`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Gemini review failed: ${message}` }],
          isError: true,
        };
      }
    },
  );

  return server;
}

async function main(): Promise<void> {
  const timeoutMs = Number(process.env.GEMINI_TIMEOUT_MS ?? 120_000);
  const deps: ServerDeps = {
    runGemini: (opts) => runGemini({ ...opts, timeoutMs, spawnFn: nodeSpawn }),
    defaultModel: process.env.GEMINI_MODEL,
  };
  const server = createServer(deps);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Only run the server when executed directly (not when imported by tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/index.test.ts`
Expected: PASS (4 tests).

If `InMemoryTransport` import path errors, confirm the export with:
`node -e "import('@modelcontextprotocol/sdk/inMemory.js').then(m=>console.log(Object.keys(m)))"`
Expected output includes `InMemoryTransport`.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all tests across all files PASS.

- [ ] **Step 6: Build and verify compilation**

Run: `npm run build`
Expected: `dist/` is produced with no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts src/index.test.ts
git commit -m "feat: wire up MCP server with review_plan tool"
```

---

## Task 9: Live smoke test (`src/gemini.live.test.ts`)

**Files:**
- Create: `src/gemini.live.test.ts`

This test calls the real gemini CLI and is skipped unless `GEMINI_LIVE_TEST` is set, so it never runs in normal `npm test`/CI.

- [ ] **Step 1: Write the test**

```ts
// src/gemini.live.test.ts
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
```

- [ ] **Step 2: Verify it skips by default**

Run: `npx vitest run src/gemini.live.test.ts`
Expected: the suite is reported as skipped (0 failures).

- [ ] **Step 3: Run it for real (manual verification)**

Run: `GEMINI_LIVE_TEST=1 npx vitest run src/gemini.live.test.ts`
(PowerShell: `$env:GEMINI_LIVE_TEST=1; npx vitest run src/gemini.live.test.ts`)
Expected: PASS — Gemini reviews the (intentionally weak) login plan and returns findings. This confirms the end-to-end path against the real CLI.

- [ ] **Step 4: Commit**

```bash
git add src/gemini.live.test.ts
git commit -m "test: add gated live smoke test against real gemini"
```

---

## Task 10: README and registration

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

````markdown
# gemini-plan-reviewer

An MCP server that sends a plan/spec to the [Gemini CLI](https://geminicli.com)
for an independent review and returns structured findings
(severity, category, issue, suggestion).

## Requirements

- Node.js 22+
- The `gemini` CLI installed and authenticated (`gemini --version` should work)

## Install & build

```bash
npm install
npm run build
```

## Tool

### `review_plan`

| Argument      | Type     | Required | Description                                   |
|---------------|----------|----------|-----------------------------------------------|
| `plan`        | string   | yes      | The plan/spec text to review.                 |
| `focus_areas` | string[] | no       | Areas to emphasize, e.g. `["security"]`.      |
| `model`       | string   | no       | Gemini model override.                        |

Returns markdown (grouped by severity) plus `structuredContent`:

```json
{
  "summary": "…",
  "findings": [
    { "severity": "critical|major|minor", "category": "…", "issue": "…", "suggestion": "…" }
  ]
}
```

## Configuration

| Env var              | Default                        | Description                              |
|----------------------|--------------------------------|------------------------------------------|
| `GEMINI_MODEL`       | (the gemini CLI's own default) | Model used when no `model` arg is given. |
| `GEMINI_TIMEOUT_MS`  | `120000`                       | Subprocess timeout in milliseconds.      |

## Register with Claude Code

```bash
claude mcp add gemini-plan-reviewer -- node /absolute/path/to/gemini-plan-reviewer/dist/index.js
```

Or add to your MCP settings JSON:

```json
{
  "mcpServers": {
    "gemini-plan-reviewer": {
      "command": "node",
      "args": ["/absolute/path/to/gemini-plan-reviewer/dist/index.js"]
    }
  }
}
```

Then ask Claude to "review this plan with Gemini" and it will call `review_plan`.

## Development

```bash
npm test          # run unit/integration tests
npm run test:watch
GEMINI_LIVE_TEST=1 npx vitest run src/gemini.live.test.ts   # real end-to-end check
```
````

- [ ] **Step 2: Verify the built server starts and lists the tool**

Run:
```bash
node -e "const{Client}=require('@modelcontextprotocol/sdk/client/index.js');" 2>/dev/null; echo "(smoke check is the index.test.ts integration test)"
```
The authoritative check is `npm test` (Task 8) — `index.test.ts` already verifies the tool is registered and callable. No separate manual step needed.

- [ ] **Step 3: Final full-suite run**

Run: `npm test`
Expected: all suites PASS.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add README with usage and registration"
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Text-in / structured-out contract → Tasks 2, 8 ✓
- Severity + category + issue + suggestion → `FindingSchema` (Task 2) ✓
- Optional focus areas + model override → `reviewPlanInputShape` (Task 2), threaded through Tasks 7–8 ✓
- TypeScript/Node + MCP SDK → Tasks 1, 8 ✓
- One-shot subprocess, plan via stdin, `--approval-mode plan`, `--skip-trust`, `-o json` → Task 6 ✓
- Envelope unwrap + fence stripping + validation → Task 4 ✓
- Both markdown + structuredContent returned → Tasks 5, 8 ✓
- Error handling (empty plan, missing binary, non-zero exit, timeout, parse failure + retry) → Tasks 2, 6, 7, 8 ✓
- Tests for prompt/parse/gemini(mock)/+ gated live test → Tasks 3, 4, 6, 9 ✓
- README + registration snippet → Task 10 ✓
- Default model deviation (CLI default vs hard-coded) documented and implemented → header + Task 8 ✓

**Placeholder scan:** No TBD/TODO; every code step contains complete code. ✓

**Type consistency:** `GeminiRunOptions`/`GeminiRunResult` (Task 6) used identically in Tasks 7–8; `ParseOutcome` (Task 4) returned by `reviewPlan` (Task 7) and consumed in Task 8; `reviewPlanInputShape` (Task 2) used as `inputSchema` (Task 8); `ReviewResult` (Task 2) rendered (Task 5) and returned as `structuredContent` (Task 8). ✓
