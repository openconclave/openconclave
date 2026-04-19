import { homedir } from "os";
import path from "path";
import crypto from "crypto";
import { writeFile, mkdir } from "fs/promises";
import { db } from "../db/client";
import { settings as settingsTable } from "../db/schema";

const CONTAINER_NAME = "searxng";
const DEFAULT_PORT = 8080;
const IMAGE = "searxng/searxng:latest";
const HEALTH_TIMEOUT_MS = 30_000;

export type DockerState = "missing" | "daemon-down" | "ready";
export type ContainerState = "not-found" | "stopped" | "running";

export interface ManagerStatus {
  docker: DockerState;
  container: ContainerState;
  healthy: boolean;
  port: number;
}

export async function getManagerStatus(): Promise<ManagerStatus> {
  const version = await dockerExec(["--version"]);
  if (version.code !== 0) return { docker: "missing", container: "not-found", healthy: false, port: DEFAULT_PORT };

  const info = await dockerExec(["info"]);
  if (info.code !== 0) return { docker: "daemon-down", container: "not-found", healthy: false, port: DEFAULT_PORT };

  const inspect = await dockerExec(["inspect", CONTAINER_NAME, "--format", "{{.State.Running}}"]);
  if (inspect.code !== 0) return { docker: "ready", container: "not-found", healthy: false, port: DEFAULT_PORT };

  const running = inspect.stdout.trim() === "true";
  return {
    docker: "ready",
    container: running ? "running" : "stopped",
    healthy: running ? await probeHealth() : false,
    port: DEFAULT_PORT,
  };
}

export async function startContainer(): Promise<{ ok: boolean; error?: string }> {
  await writeSettingsYml();
  await dockerExec(["rm", "-f", CONTAINER_NAME]);
  const mount = dockerMountPath();
  const run = await dockerExec([
    "run", "-d",
    "--name", CONTAINER_NAME,
    "-p", `${DEFAULT_PORT}:8080`,
    "--restart", "unless-stopped",
    "-v", `${mount}:/etc/searxng`,
    IMAGE,
  ]);
  if (run.code !== 0) {
    return { ok: false, error: simplifyDockerError(run.stderr) };
  }
  const healthy = await waitHealthy();
  if (!healthy) {
    const logs = await dockerExec(["logs", "--tail", "20", CONTAINER_NAME]);
    return { ok: false, error: `container started but didn't become healthy in ${HEALTH_TIMEOUT_MS / 1000}s. Logs:\n${logs.stdout.slice(-800)}` };
  }
  await persistUrlSetting();
  return { ok: true };
}

export async function stopContainer(): Promise<{ ok: boolean; error?: string }> {
  const res = await dockerExec(["stop", CONTAINER_NAME]);
  if (res.code !== 0) return { ok: false, error: simplifyDockerError(res.stderr) };
  return { ok: true };
}

export async function restartContainer(): Promise<{ ok: boolean; error?: string }> {
  const res = await dockerExec(["restart", CONTAINER_NAME]);
  if (res.code !== 0) return { ok: false, error: simplifyDockerError(res.stderr) };
  const healthy = await waitHealthy();
  if (!healthy) return { ok: false, error: "container restarted but didn't become healthy" };
  return { ok: true };
}

export async function removeContainer(): Promise<{ ok: boolean; error?: string }> {
  const res = await dockerExec(["rm", "-f", CONTAINER_NAME]);
  if (res.code !== 0) return { ok: false, error: simplifyDockerError(res.stderr) };
  return { ok: true };
}

// ── internals ──────────────────────────────────────────────────────

async function dockerExec(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const proc = Bun.spawn({ cmd: ["docker", ...args], stdout: "pipe", stderr: "pipe" });
    await proc.exited;
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { code: proc.exitCode ?? -1, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err) {
    return { code: -1, stdout: "", stderr: err instanceof Error ? err.message : String(err) };
  }
}

function settingsDir(): string {
  return path.join(homedir(), ".openconclave", "searxng");
}

function dockerMountPath(): string {
  // Docker Desktop on Windows accepts forward-slash paths; Linux/macOS already use them.
  return settingsDir().replace(/\\/g, "/");
}

async function writeSettingsYml(): Promise<void> {
  const dir = settingsDir();
  await mkdir(dir, { recursive: true });
  const secret = crypto.randomBytes(32).toString("hex");
  const yml = `use_default_settings: true
search:
  formats: [html, json]
server:
  secret_key: "${secret}"
  limiter: false
`;
  await writeFile(path.join(dir, "settings.yml"), yml);
}

async function probeHealth(): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${DEFAULT_PORT}/`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitHealthy(): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < HEALTH_TIMEOUT_MS) {
    if (await probeHealth()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function persistUrlSetting(): Promise<void> {
  const key = "web_search_searxng_url";
  const value = `http://localhost:${DEFAULT_PORT}`;
  const now = new Date().toISOString();
  await db
    .insert(settingsTable)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: now } });
}

function simplifyDockerError(stderr: string): string {
  if (!stderr) return "docker command failed";
  const firstLine = stderr.split("\n")[0] ?? stderr;
  if (firstLine.includes("Cannot connect to the Docker daemon")) {
    return "Docker Desktop is not running. Start it and try again.";
  }
  if (firstLine.includes("port is already allocated") || firstLine.includes("address already in use")) {
    return `Port ${DEFAULT_PORT} is in use. Stop whatever is bound to it and retry.`;
  }
  return firstLine.slice(0, 240);
}
