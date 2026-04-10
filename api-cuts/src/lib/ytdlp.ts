import { spawn } from "node:child_process";
import { mkdirSync, chmodSync, createWriteStream } from "node:fs";
import { join } from "node:path";
import https from "node:https";

const BIN_DIR = join(process.cwd(), "bin");

function getBinName(): string {
  if (process.platform === "win32") return "yt-dlp.exe";
  if (process.platform === "darwin") return "yt-dlp_macos";
  return "yt-dlp_linux";
}

const BIN_PATH = join(BIN_DIR, getBinName());

let resolvedPath: string | null = null;

function checkSystemYtDlp(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("yt-dlp", ["--version"], { stdio: "ignore" });
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });
}

function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath);
    const follow = (location: string) => {
      https.get(location, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          follow(res.headers.location!);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed with status ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve()));
        file.on("error", reject);
      }).on("error", reject);
    };
    follow(url);
  });
}

export async function ensureYtDlp(): Promise<string> {
  if (resolvedPath) return resolvedPath;

  if (await checkSystemYtDlp()) {
    resolvedPath = "yt-dlp";
    return resolvedPath;
  }

  console.info("[ytdlp] yt-dlp not found in PATH — downloading native binary…");
  mkdirSync(BIN_DIR, { recursive: true });

  const assetName = getBinName();
  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${assetName}`;
  await downloadFile(url, BIN_PATH);
  chmodSync(BIN_PATH, 0o755);

  console.info(`[ytdlp] binary ready at ${BIN_PATH}`);
  resolvedPath = BIN_PATH;
  return resolvedPath;
}
