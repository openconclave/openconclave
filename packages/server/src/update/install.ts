import { writeFile, rename, unlink, chmod } from "fs/promises";
import path from "path";
import { VERSION } from "@openconclave/shared";
import { checkForUpdate } from "./check";

export async function runUpdate(): Promise<void> {
  const execPath = process.execPath;

  console.log(`OpenConclave updater`);
  console.log(`Current: v${VERSION} (${execPath})`);
  console.log(`Checking for updates...`);

  const status = await checkForUpdate();
  if (status.error) {
    console.error(`\nUpdate check failed: ${status.error}`);
    process.exit(1);
  }
  if (!status.latest) {
    console.error(`\nManifest returned no version.`);
    process.exit(1);
  }
  if (!status.hasUpdate) {
    console.log(`\nAlready up to date (v${status.current}).`);
    return;
  }
  if (!status.downloadUrl) {
    const platform = `${process.platform}-${process.arch}`;
    console.error(`\nNo download available for ${platform} in manifest.`);
    console.error(`Update manually from https://openconclave.com.`);
    process.exit(1);
  }

  console.log(`\nUpdating v${status.current} -> v${status.latest}`);
  console.log(`Downloading ${status.downloadUrl}...`);

  const dir = path.dirname(execPath);
  const tmpPath = path.join(dir, `.oc-update-${Date.now()}.download`);

  try {
    const res = await fetch(status.downloadUrl);
    if (!res.ok) throw new Error(`http ${res.status} ${res.statusText}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(tmpPath, buf);

    const sizeMb = (buf.length / 1024 / 1024).toFixed(1);
    console.log(`Downloaded ${sizeMb} MB, installing...`);

    // Windows cannot overwrite the running exe; rename it aside first.
    // Unix allows overwriting running binaries directly (old inode held until exit).
    const oldPath = `${execPath}.old`;
    try { await unlink(oldPath); } catch {}
    try {
      await rename(execPath, oldPath);
    } catch (err) {
      if (process.platform === "win32") throw err;
      // ignore on unix — overwrite will work
    }

    await rename(tmpPath, execPath);
    if (process.platform !== "win32") await chmod(execPath, 0o755);

    console.log(`\n✓ Installed v${status.latest}`);
    console.log(`Restart any running 'oc' processes to use the new version.`);
  } catch (err) {
    try { await unlink(tmpPath); } catch {}
    console.error(`\nUpdate failed: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && /EACCES|EPERM/.test(err.message)) {
      console.error(`Permission denied. Try running with elevated privileges (sudo / Administrator).`);
    }
    process.exit(1);
  }
}

/**
 * Called on server startup. If a previous `oc update` left `<exe>.old` on disk
 * (because the old exe was still running at swap time), best-effort delete it now.
 * Silent on failure — the file is harmless if it sticks around.
 */
export async function cleanupOldBinary(): Promise<void> {
  const oldPath = `${process.execPath}.old`;
  try { await unlink(oldPath); } catch {}
}
