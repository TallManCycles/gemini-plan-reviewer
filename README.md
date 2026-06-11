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
      "args": ["C:\\Projects\\gemini-plan-reviewer\\dist\\index.js"]
    }
  }
}
```

Then ask Claude to "review this plan with Gemini" and it will call `review_plan`.

## How it works

Each call spawns the gemini CLI headlessly in read-only plan mode
(`--approval-mode plan --skip-trust -o json`). The plan and review instructions
are delivered via **stdin** (never the command line), and the model is asked to
return findings as a single JSON object. The server unwraps the CLI's JSON
envelope, strips any stray markdown fences, validates the findings against a
schema, and returns both a readable markdown rendering and the structured
object. If the model's output can't be parsed, it retries once with a stricter
prompt, then falls back to returning the raw text.

## Development

```bash
npm test          # run unit/integration tests
npm run test:watch

# real end-to-end check against the installed gemini CLI:
GEMINI_LIVE_TEST=1 npx vitest run src/gemini.live.test.ts
# PowerShell: $env:GEMINI_LIVE_TEST=1; npx vitest run src/gemini.live.test.ts
```
