import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

function resolveElectronBinary(appRoot) {
  const explicitBinary = process.env.ECHO_DESKTOP_LIVE2D_ELECTRON_BIN;
  if (explicitBinary) {
    return explicitBinary;
  }
  if (process.platform === "win32") {
    const candidate = path.resolve(appRoot, "node_modules", ".bin", "electron.cmd");
    return fs.existsSync(candidate) ? candidate : null;
  }
  const candidate = path.resolve(appRoot, "node_modules", ".bin", "electron");
  return fs.existsSync(candidate) ? candidate : null;
}

async function main() {
  if (process.env.ECHO_DESKTOP_LIVE2D_VERIFY_ELECTRON !== "1") {
    process.stdout.write(
      "desktop-live2d three-window electron verification skipped (set ECHO_DESKTOP_LIVE2D_VERIFY_ELECTRON=1 to run)\n"
    );
    return;
  }

  const appRoot = path.resolve(import.meta.dirname, "..");
  const electronMainPath = path.resolve(appRoot, "electron", "main.mjs");
  const electronBinary = resolveElectronBinary(appRoot);
  if (!electronBinary) {
    process.stdout.write(
      "desktop-live2d three-window electron verification skipped (Electron binary is not installed in apps/desktop-live2d)\n"
    );
    return;
  }

  await new Promise((resolve, reject) => {
    const child = spawn(electronBinary, [electronMainPath], {
      cwd: appRoot,
      env: {
        ...process.env,
        ECHO_DESKTOP_LIVE2D_AUTORUN_ELECTRON_VERIFICATION: "1"
      },
      stdio: "inherit",
      windowsHide: true
    });
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`desktop-live2d three-window verification exited with code ${code}`));
    });
    child.once("error", reject);
  });
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack || error.message : String(error)}\n`
  );
  process.exit(1);
});
