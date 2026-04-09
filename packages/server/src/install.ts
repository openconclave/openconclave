/**
 * Self-installer for OpenConclave.
 *
 * Called via: openconclave install
 *
 * 1. Copies the running binary to ~/.openconclave/bin/
 * 2. Adds ~/.openconclave/bin to PATH
 * 3. Shows Claude Code plugin install instructions
 */
import { existsSync, mkdirSync, copyFileSync, readFileSync, appendFileSync, chmodSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const HOME = homedir();
const INSTALL_DIR = join(HOME, ".openconclave");
const BIN_DIR = join(INSTALL_DIR, "bin");
const isWindows = process.platform === "win32";
const EXE = isWindows ? "oc.exe" : "oc";
const BINARY_PATH = join(BIN_DIR, EXE);

function log(msg: string) {
  console.log(`  ${msg}`);
}

function copyBinary() {
  mkdirSync(BIN_DIR, { recursive: true });

  const src = process.execPath;
  if (src === BINARY_PATH) {
    log("Binary already installed.");
    return;
  }

  log(`Copying binary to ${BIN_DIR}/`);
  copyFileSync(src, BINARY_PATH);
  if (!isWindows) {
    chmodSync(BINARY_PATH, 0o755);
  }
}

function addToPathWindows() {
  try {
    const result = Bun.spawnSync({
      cmd: ["powershell.exe", "-Command",
        `[Environment]::GetEnvironmentVariable('Path', 'User')`],
      stdout: "pipe",
    });
    const userPath = result.stdout.toString().trim();

    if (userPath.toLowerCase().includes(BIN_DIR.toLowerCase())) {
      log("PATH already configured.");
      return;
    }

    log("Adding to PATH (user environment)...");
    Bun.spawnSync({
      cmd: ["powershell.exe", "-Command",
        `[Environment]::SetEnvironmentVariable('Path', '${BIN_DIR};' + [Environment]::GetEnvironmentVariable('Path', 'User'), 'User')`],
    });
    log("Restart your terminal for PATH to take effect.");
  } catch (err) {
    log(`Warning: Could not update PATH automatically. Add ${BIN_DIR} to your PATH manually.`);
  }
}

function addToPathUnix() {
  const exportLine = `export PATH="$HOME/.openconclave/bin:$PATH"`;

  // Detect shell RC file
  const shell = process.env.SHELL ?? "";
  let rcFile: string;
  if (shell.includes("zsh") || existsSync(join(HOME, ".zshrc"))) {
    rcFile = join(HOME, ".zshrc");
  } else if (existsSync(join(HOME, ".bash_profile"))) {
    rcFile = join(HOME, ".bash_profile");
  } else {
    rcFile = join(HOME, ".bashrc");
  }

  // Check if already added
  if (existsSync(rcFile)) {
    const content = readFileSync(rcFile, "utf-8");
    if (content.includes(".openconclave/bin")) {
      log("PATH already configured.");
      return;
    }
  }

  log(`Adding to PATH in ${rcFile}`);
  appendFileSync(rcFile, `\n# OpenConclave\n${exportLine}\n`);
  log("Restart your terminal for PATH to take effect.");
}

function showPluginInstructions() {
  const a = "\x1b[38;5;214m";
  const r = "\x1b[0m";
  const d = "\x1b[2m";

  log(`${d}Claude Code plugins:${r}`);
  log(`  ${d}1.${r} /plugin marketplace add ${a}openconclave/claude-plugin${r}`);
  log(`  ${d}2.${r} /plugin install ${a}openconclave-channel@openconclave${r}`);
  log(`  ${d}3.${r} /plugin install ${a}openconclave-dev@openconclave${r}`);
}

export async function runInstall() {
  const a = "\x1b[38;5;214m";
  const r = "\x1b[0m";
  const d = "\x1b[2m";

  console.log(`
  ${a}◆${r}  O P E N C O N C L A V E  ${d}Installer${r}
`);

  // 1. Copy binary
  copyBinary();

  // 2. Add to PATH
  if (isWindows) {
    addToPathWindows();
  } else {
    addToPathUnix();
  }

  // Done
  console.log(`
  ${a}◆${r}  Installed!

  ${d}Run:${r}   oc
  ${d}Open:${r}  ${a}http://localhost:4000${r}
`);

  // 3. Show Claude Code plugin instructions
  showPluginInstructions();
  console.log();
}
