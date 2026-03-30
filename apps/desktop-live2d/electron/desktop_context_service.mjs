/**
 * Desktop context collector for ambient perception.
 *
 * Collects structured information about the user's current desktop state:
 *   - foreground application name
 *   - window title
 *   - URL (for browsers, via window title heuristic)
 *   - idle duration
 *
 * Windows-only for now. Uses PowerShell to query foreground window info.
 */

import { execFile } from "node:child_process";
import { powerMonitor } from "electron";

/**
 * @typedef {object} DesktopContext
 * @property {string} appName
 * @property {string} windowTitle
 * @property {string | null} url
 * @property {number} idleSeconds
 * @property {string} timestampUtc
 * @property {"high" | "low"} confidence
 * @property {boolean} isGenericShell
 * @property {boolean} isOwnWindow
 */

// PowerShell one-liner to get foreground window info.
// Returns JSON with ProcessName, WindowTitle, and WindowClass.
const PS_GET_FOREGROUND = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class FgWin {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetClassName(IntPtr hWnd, StringBuilder className, int maxCount);
  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool IsWindowVisible(IntPtr hWnd);
}
"@
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$hwnd = [FgWin]::GetForegroundWindow()
$pid = 0
[void][FgWin]::GetWindowThreadProcessId($hwnd, [ref]$pid)
if ($pid -gt 0 -and [FgWin]::IsWindowVisible($hwnd)) {
    $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
    if ($proc) {
    $titleLength = [FgWin]::GetWindowTextLength($hwnd)
    $titleBuilder = New-Object System.Text.StringBuilder ($titleLength + 1)
    [void][FgWin]::GetWindowText($hwnd, $titleBuilder, $titleBuilder.Capacity)
    $classBuilder = New-Object System.Text.StringBuilder 256
    [void][FgWin]::GetClassName($hwnd, $classBuilder, $classBuilder.Capacity)
    @{
      ProcessName = $proc.ProcessName
      WindowTitle = $titleBuilder.ToString()
      WindowClass = $classBuilder.ToString()
    } | ConvertTo-Json -Compress
    } else {
    '{"ProcessName":"","WindowTitle":"","WindowClass":""}'
    }
} else {
  '{"ProcessName":"","WindowTitle":"","WindowClass":""}'
}
`.trim();

const GENERIC_SHELL_APPS = new Set([
    "powershell",
    "pwsh",
    "cmd",
    "windowsterminal",
    "wt",
]);

const GENERIC_SHELL_TITLE_PATTERNS = [
    /^powershell$/i,
    /^windows powershell$/i,
    /^pwsh$/i,
    /^command prompt$/i,
    /^cmd(?:\.exe)?$/i,
    /^terminal$/i,
    /^windows terminal$/i,
    /^administrator:\s*(windows powershell|command prompt|pwsh)$/i,
];

const OWN_WINDOW_TITLE_PATTERNS = [
    /^echo avatar$/i,
    /^echo chat$/i,
    /^echo bubble$/i,
    /^echo avatar window$/i,
    /^echo bubble window$/i,
    /^current session$/i,
];

/**
 * Query the foreground window on Windows via PowerShell.
 * Returns { processName, windowTitle }.
 *
 * @returns {Promise<{ processName: string, windowTitle: string }>}
 */
function queryForegroundWindow() {
    return new Promise((resolve) => {
        execFile(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-Command", PS_GET_FOREGROUND],
            { timeout: 3000, windowsHide: true },
            (error, stdout) => {
                if (error || !stdout.trim()) {
                    resolve({ processName: "", windowTitle: "" });
                    return;
                }
                try {
                    const parsed = JSON.parse(stdout.trim());
                    resolve({
                        processName: parsed.ProcessName || "",
                        windowTitle: parsed.WindowTitle || "",
                        windowClass: parsed.WindowClass || "",
                    });
                } catch {
                    resolve({ processName: "", windowTitle: "", windowClass: "" });
                }
            }
        );
    });
}

function isGenericShellContext(processName, windowTitle) {
    const appLower = (processName || "").toLowerCase().replace(/\.exe$/, "");
    const normalizedTitle = (windowTitle || "").trim();
    if (!GENERIC_SHELL_APPS.has(appLower)) {
        return false;
    }
    if (normalizedTitle === "") {
        return true;
    }
    return GENERIC_SHELL_TITLE_PATTERNS.some((pattern) => pattern.test(normalizedTitle));
}

function isOwnWindowContext(processName, windowTitle) {
    const appLower = (processName || "").toLowerCase().replace(/\.exe$/, "");
    const normalizedTitle = (windowTitle || "").trim();
    if (normalizedTitle !== "" && OWN_WINDOW_TITLE_PATTERNS.some((pattern) => pattern.test(normalizedTitle))) {
        return true;
    }
    return appLower === "echo-desktop-live2d" && normalizedTitle.toLowerCase().startsWith("echo ");
}

function computeContextConfidence(processName, windowTitle) {
    if (!processName && !windowTitle) {
        return "low";
    }
    if (isOwnWindowContext(processName, windowTitle)) {
        return "low";
    }
    if (isGenericShellContext(processName, windowTitle)) {
        return "low";
    }
    return "high";
}

/**
 * Extract URL from browser window titles.
 * Many browsers include the URL or page title in the window title.
 * This is a heuristic — not always accurate.
 *
 * @param {string} windowTitle
 * @param {string} processName
 * @returns {string | null}
 */
function extractUrlFromTitle(windowTitle, processName) {
    const browserProcesses = new Set([
        "chrome", "msedge", "firefox", "brave", "opera", "vivaldi", "arc",
    ]);
    if (!browserProcesses.has(processName.toLowerCase())) return null;

    // Some browsers show "Page Title - Browser Name" or "Page Title — Browser Name"
    // We can't reliably extract a URL from the title alone, but we return
    // the title for keyword matching in the mode classifier.
    // If the title itself contains a URL-like pattern, extract it.
    const urlMatch = windowTitle.match(/https?:\/\/[^\s]+/);
    if (urlMatch) return urlMatch[0];

    return null;
}

/**
 * Collect the current desktop context.
 *
 * @returns {Promise<DesktopContext>}
 */
export async function collectDesktopContext() {
    const { processName, windowTitle } = await queryForegroundWindow();
    const url = extractUrlFromTitle(windowTitle, processName);
    const idleSeconds = Math.floor(powerMonitor.getSystemIdleTime());
    const isGenericShell = isGenericShellContext(processName, windowTitle);
    const isOwnWindow = isOwnWindowContext(processName, windowTitle);

    return {
        appName: processName,
        windowTitle,
        url,
        idleSeconds,
        timestampUtc: new Date().toISOString(),
        confidence: computeContextConfidence(processName, windowTitle),
        isGenericShell,
        isOwnWindow,
    };
}
