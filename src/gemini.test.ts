import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { buildGeminiArgs, runGemini, PROMPT_TRIGGER } from "./gemini.js";

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
  it("includes the fixed prompt trigger, plan-mode, skip-trust and json output by default", () => {
    expect(buildGeminiArgs()).toEqual([
      "-p", PROMPT_TRIGGER,
      "--approval-mode", "plan",
      "--skip-trust",
      "-o", "json",
    ]);
  });

  it("appends -m when a model is given", () => {
    const args = buildGeminiArgs("gemini-3.1-pro-preview");
    expect(args).toContain("-m");
    expect(args).toContain("gemini-3.1-pro-preview");
  });
});

describe("runGemini", () => {
  it("resolves and writes input to stdin on exit 0, spawning via the shell", async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn(() => child) as any;
    const p = runGemini({ input: "MY INPUT", spawnFn });

    child.stdout.emit("data", Buffer.from('{"response":"ok"}'));
    child.stderr.emit("data", Buffer.from("Warning: harmless"));
    child.emit("close", 0);

    await expect(p).resolves.toEqual({
      stdout: '{"response":"ok"}',
      stderr: "Warning: harmless",
    });
    expect(child._stdin.join("")).toBe("MY INPUT");

    const [cmd, args, options] = spawnFn.mock.calls[0];
    expect(cmd).toContain("gemini");
    expect(args).toEqual([]);
    expect(options.shell).toBe(true);
  });

  it("rejects on a non-zero exit code, including stderr", async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn(() => child) as any;
    const p = runGemini({ input: "P", spawnFn });

    child.stderr.emit("data", Buffer.from("boom"));
    child.emit("close", 2);

    await expect(p).rejects.toThrow(/code 2/);
    await expect(p).rejects.toThrow(/boom/);
  });

  it("rejects with a clear message when the binary is missing", async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn(() => child) as any;
    const p = runGemini({ input: "P", spawnFn });

    child.emit("error", new Error("spawn gemini ENOENT"));

    await expect(p).rejects.toThrow(/failed to start gemini/);
  });

  it("rejects an unsafe model id before spawning", async () => {
    const spawnFn = vi.fn(() => makeFakeChild()) as any;
    await expect(
      runGemini({ input: "P", model: "x; rm -rf /", spawnFn }),
    ).rejects.toThrow(/invalid model/);
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it("kills the process and rejects on timeout", async () => {
    vi.useFakeTimers();
    const child = makeFakeChild();
    const spawnFn = vi.fn(() => child) as any;
    const p = runGemini({ input: "P", spawnFn, timeoutMs: 1000 });

    vi.advanceTimersByTime(1001);

    await expect(p).rejects.toThrow(/timed out/);
    expect(child.kill).toHaveBeenCalled();
  });
});
