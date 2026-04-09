#!/usr/bin/env bun
/**
 * Unified CLI entry point for OpenConclave.
 *
 * Usage:
 *   openconclave              — Start the server (API + UI)
 *   openconclave install      — Install to ~/.openconclave/ and configure PATH + MCP
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
