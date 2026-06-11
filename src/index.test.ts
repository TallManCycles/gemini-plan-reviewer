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
