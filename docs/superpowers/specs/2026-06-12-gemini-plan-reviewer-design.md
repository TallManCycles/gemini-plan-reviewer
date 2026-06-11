# Gemini Plan Reviewer — MCP Server Design

**Date:** 2026-06-12
**Status:** Approved

## Purpose

An MCP server that lets Claude hand a plan/spec to the Gemini CLI for an
independent review. Claude passes the plan as text; Gemini reviews it and
returns structured, actionable findings (severity + category + issue +
suggestion) that Claude can triage and act on.

## Goals

- Give Claude a second, independent reviewer for plans and specs.
- Return findings in a structured shape Claude can act on point-by-point.
- Stay stateless and simple: one tool, one subprocess per call.

## Non-Goals

- Multi-turn conversations with Gemini (no ACP / persistent agent).
- Gemini mutating the filesystem or running tools (reviews are read-only).
- Reading plans from disk by path (plan is passed as text; file context can
  be folded into the plan text by the caller).

## Tool

### `review_plan`

**Input**

| Field         | Type       | Required | Description                                                        |
|---------------|------------|----------|--------------------------------------------------------------------|
| `plan`        | string     | yes      | The plan/spec text to review. Must be non-empty.                   |
| `focus_areas` | string[]   | no       | Areas to weight, e.g. `["security", "edge cases"]`.               |
| `model`       | string     | no       | Gemini model override. Falls back to the configured default.       |

**Output** — returned to Claude as **both** human-readable markdown (findings
grouped by severity) **and** `structuredContent` matching:

```jsonc
{
  "summary": "string — one-paragraph overall assessment",
  "findings": [
    {
      "severity": "critical" | "major" | "minor",
      "category": "string — e.g. completeness, risk, feasibility, security",
      "issue": "string — what is wrong or missing",
      "suggestion": "string — concrete improvement"
    }
  ]
}
```

## Architecture

A stdio MCP server built on `@modelcontextprotocol/sdk`, exposing the single
`review_plan` tool. Split into focused, independently testable modules:

- **`src/schema.ts`** — zod schemas + inferred types for tool input and the
  findings output. One source of truth for shape and validation.
- **`src/prompt.ts`** — pure function building the review instruction from the
  focus areas and the required JSON output shape. No I/O.
- **`src/gemini.ts`** — runs the gemini subprocess: builds args, writes the
  plan to stdin, captures stdout/stderr, enforces a timeout, maps exit codes
  to errors. The `spawn` function is injectable so tests need no real gemini.
- **`src/parse.ts`** — pure function: unwraps gemini's `-o json` envelope,
  strips markdown code fences, extracts the inner findings JSON, validates it
  against the schema.
- **`src/index.ts`** — wires the tool handler and the stdio transport.

### Data flow

```
review_plan({ plan, focus_areas?, model? })
  → prompt.ts builds review instructions (incl. JSON output spec)
  → gemini.ts spawns:
       gemini -p <instructions> --approval-mode plan --skip-trust \
              -m <model | default> -o json
     with <plan> written to stdin
  → parse.ts unwraps envelope → strips fences → parse → validate
  → index.ts returns markdown + structuredContent to Claude
```

## Gemini Invocation

- **Headless:** `-p <instructions>` triggers non-interactive mode; the plan is
  piped via stdin (avoids arg-length and shell-escaping limits). Per the CLI,
  stdin input is appended to the `-p` prompt.
- **Read-only:** `--approval-mode plan` ensures Gemini cannot mutate files or
  run side-effecting tools.
- **No trust prompt:** `--skip-trust` so a headless run never hangs waiting for
  workspace-trust confirmation.
- **Structured envelope:** `-o json` returns a JSON envelope; we extract the
  model's response text from it, then parse the inner findings JSON.

## Configuration & Defaults

- **Default model:** `gemini-2.5-pro` (strongest reasoning for review).
- **`GEMINI_MODEL`** env var overrides the default; per-call `model` overrides
  both.
- **Timeout:** default 120s, configurable via env (e.g. `GEMINI_TIMEOUT_MS`).

## Error Handling

| Condition                     | Behavior                                                                 |
|-------------------------------|--------------------------------------------------------------------------|
| Empty/whitespace plan         | Validation error returned before spawning anything.                      |
| gemini binary not found       | Clear error naming the missing binary and how to install it.             |
| Non-zero exit from gemini     | Error surfaced to Claude including captured stderr.                      |
| Timeout                       | Subprocess killed; timeout error returned.                               |
| JSON parse/validation failure | One stricter retry ("return ONLY valid JSON"); if it still fails, return Gemini's raw text with a `parse_error: true` flag so Claude still gets something useful. |

## Testing

- **`prompt.ts`** — unit tests asserting focus areas and the JSON output spec
  are included correctly.
- **`parse.ts`** — unit tests over sample outputs: clean JSON, fenced JSON,
  prose-wrapped JSON, malformed JSON.
- **`gemini.ts`** — tests with an injected mock spawn: assert constructed args
  and stdin content; simulate clean exit, non-zero exit, and timeout.
- **Live smoke test** — one optional end-to-end test against the real gemini
  CLI, gated behind an env flag so it is skipped by default / in CI.

## Deliverables

- Buildable TypeScript package (`tsc`), with `bin` entry for the server.
- README including the exact config snippet to register the server in Claude
  Code (`mcpServers` entry / `claude mcp add`).

## Open Questions / To Verify During Implementation

- Exact shape of the `gemini -o json` envelope in CLI v0.46 (field holding the
  response text) — confirm before finalizing `parse.ts`.
- Whether `--skip-trust` is required in practice for a pure text review, or
  whether `--approval-mode plan` alone avoids the trust prompt.
- Confirm `gemini-2.5-pro` is a valid model id for the installed CLI.
