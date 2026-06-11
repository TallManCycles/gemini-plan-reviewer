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
