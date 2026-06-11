import { spawn as nodeSpawn } from "node:child_process";

/**
 * Fixed, side-effect-free -p value. It only triggers headless mode and points
 * the model at the document on stdin. All plan/instruction text is delivered
 * via stdin, never the command line.
 */
export const PROMPT_TRIGGER =
  "Follow the instructions in the document provided above and respond now with only the requested JSON object.";

export interface GeminiRunOptions {
  /** Full text written to gemini's stdin (plan + review instructions). */
  input: string;
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

/** Conservative whitelist for model ids that reach the shell command line. */
const SAFE_MODEL = /^[A-Za-z0-9._:-]+$/;

export function buildGeminiArgs(model?: string): string[] {
  const args = [
    "-p", PROMPT_TRIGGER,
    "--approval-mode", "plan",
    "--skip-trust",
    "-o", "json",
  ];
  if (model) {
    args.push("-m", model);
  }
  return args;
}

/**
 * Double-quote a token for the shell. Every token built here is either a fixed
 * literal or a model id validated against SAFE_MODEL, so none contain quotes or
 * shell metacharacters — simple double-quoting is safe on cmd.exe and POSIX sh.
 */
function shellQuote(token: string): string {
  return `"${token}"`;
}

export function buildCommandLine(geminiPath: string, model?: string): string {
  return [geminiPath, ...buildGeminiArgs(model).map(shellQuote)].join(" ");
}

export function runGemini(opts: GeminiRunOptions): Promise<GeminiRunResult> {
  const spawnFn = opts.spawnFn ?? nodeSpawn;
  const geminiPath = opts.geminiPath ?? "gemini";
  const timeoutMs = opts.timeoutMs ?? 120_000;

  if (opts.model && !SAFE_MODEL.test(opts.model)) {
    return Promise.reject(new Error(`invalid model id: ${opts.model}`));
  }

  const commandLine = buildCommandLine(geminiPath, opts.model);

  return new Promise<GeminiRunResult>((resolve, reject) => {
    // shell:true so the OS resolves the gemini launcher (e.g. gemini.cmd on
    // Windows, which Node cannot spawn directly). Only fixed tokens and a
    // validated model id reach the command line; all plan/instruction text is
    // sent via stdin, so there is no command-injection path.
    const child = spawnFn(commandLine, [], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
    });

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

    child.stdin?.write(opts.input);
    child.stdin?.end();
  });
}
