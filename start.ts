import { spawn } from "bun";

const port = process.env.PORT ?? "4000";
const clientPort = process.env.CLIENT_PORT ?? "5173";

console.log(`
  ╔═══════════════════════════════════════╗
  ║         OpenConclave v0.1.0           ║
  ╠═══════════════════════════════════════╣
  ║  UI:     http://localhost:${clientPort.padEnd(12)}║
  ║  API:    http://localhost:${port.padEnd(13)}║
  ╚═══════════════════════════════════════╝
`);

// Open browser once server is ready
async function openBrowser(url: string) {
  const cmd = process.platform === "win32"
    ? ["powershell.exe", "-Command", `Start-Process '${url}'`]
    : process.platform === "darwin"
    ? ["open", url]
    : ["xdg-open", url];
  spawn({ cmd, stdout: "ignore", stderr: "ignore" });
}

async function waitAndOpenBrowser() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://localhost:${port}/api/health`);
      if (res.ok) {
        openBrowser(`http://localhost:${clientPort}`);
        return;
      }
    } catch {}
    await Bun.sleep(500);
  }
}

waitAndOpenBrowser();

const server = spawn({
  cmd: ["bun", "run", "--watch", "packages/server/src/index.ts"],
  cwd: import.meta.dir,
  stdout: "inherit",
  stderr: "inherit",
  env: { ...process.env, PORT: port },
});

const client = spawn({
  cmd: ["bun", "run", "--cwd", "packages/client", "dev"],
  cwd: import.meta.dir,
  stdout: "inherit",
  stderr: "inherit",
  env: { ...process.env, CLIENT_PORT: clientPort },
});

process.on("SIGINT", () => {
  server.kill();
  client.kill();
  process.exit(0);
});

process.on("SIGTERM", () => {
  server.kill();
  client.kill();
  process.exit(0);
});

await Promise.all([server.exited, client.exited]);
