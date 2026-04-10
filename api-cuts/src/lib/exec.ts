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
    const proc = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });

    const stderrLines: string[] = [];

    proc.stderr.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trimEnd();
      stderrLines.push(line);
      onStderr?.(line);
    });

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(
        new AppError(504, `${cmd} timed out after ${timeoutMs / 1000}s`)
      );
    }, timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        const tail = stderrLines.slice(-5).join("\n");
        reject(
          new AppError(
            502,
            `${cmd} exited with code ${code ?? "null"}:\n${tail}`
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
