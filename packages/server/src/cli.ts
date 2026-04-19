#!/usr/bin/env bun
export {};
/**
 * Unified CLI entry point for OpenConclave.
 *
 * Usage:
 *   openconclave              — Start the server (API + UI)
 *   openconclave install      — Install to ~/.openconclave/ and configure PATH + MCP
 *   openconclave update       — Download and install the latest release
 *   openconclave mcp          — Start the MCP server (for Claude Code)
 *   openconclave channel      — Start the channel bridge (for Claude Code)
 */

const command = process.argv[2];

switch (command) {
  case "install": {
    const { runInstall } = await import("./install");
    await runInstall();
    break;
  }
  case "update": {
    const { runUpdate } = await import("./update/install");
    await runUpdate();
    break;
  }
  case "mcp": {
    const { startStdio } = await import("./mcp/server");
    await startStdio();
    break;
  }
  case "channel":
    await import("./channel/openconclave-channel");
    break;
  default:
    await import("./index");
    break;
}
