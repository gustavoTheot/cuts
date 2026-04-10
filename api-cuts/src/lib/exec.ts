import { spawn } from "node:child_process";
import { AppError } from "../shared/errors.js";

export interface ExecOptions {
  /** Max time to wait in ms (default: 5 minutes) */
  timeoutMs?: number;
  /** Called with each stderr chunk for live logging */
  onStderr?: (line: string) => void;
}

/**
 * Runs a command as a child process and resolves when it exits with code 0.
 * Rejects with AppError(502) on non-zero exit or spawn failure.
 */
export function exec(
  cmd: string,
  args: string[],
  options: ExecOptions = {}
): Promise<void> {
  const { timeoutMs = 5 * 60 * 1000, onStderr } = options;

  return new Promise((resolve, reject) => {
    // detached=true puts the child in its own process group so it survives
    // a tsx watch restart (which only kills the Node.js process, not child groups)
    const proc = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"], detached: true });

    const stderrLines: string[] = [];

    proc.stderr.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trimEnd();
      stderrLines.push(line);
      onStderr?.(line);
    });

    const timer = setTimeout(() => {
      // Kill the entire process group (negative pid) to clean up child processes too
      try { process.kill(-(proc.pid!), "SIGKILL"); } catch { proc.kill("SIGKILL"); }
      reject(
        new AppError(504, `${cmd} timed out after ${timeoutMs / 1000}s`)
      );
    }, timeoutMs);

    proc.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        const tail = stderrLines.slice(-10).join("\n");
        const reason = code !== null ? `code ${code}` : `signal ${signal ?? "null"}`;
        reject(
          new AppError(
            502,
            `${cmd} exited with ${reason}:\n${tail}`
          )
        );
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(
        new AppError(
          502,
          `Failed to spawn "${cmd}": ${err.message}. Is it installed?`
        )
      );
    });
  });
}
