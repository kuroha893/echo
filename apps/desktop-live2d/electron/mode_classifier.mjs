/**
 * Mode classifier for ambient perception.
 *
 * Classifies the user's current desktop activity into:
 *   - "entertainment" (videos, games, social media, chat)
 *   - "work" (IDE, documents, terminals, spreadsheets)
 *   - "uncertain" (ambiguous — treated as work)
 *
 * All classification is local. No network calls.
 */

/** @typedef {"entertainment" | "work" | "uncertain"} ActivityMode */

// ── App identity lists ──────────────────────────────────────────────────────

const ENTERTAINMENT_APPS = new Set([
    // media players
    "vlc", "mpv", "potplayer", "potplayermini", "potplayermini64",
    "mpc-hc", "mpc-hc64", "wmplayer", "iina",
    "spotify", "neteasemusic", "cloudmusic", "qqmusic",
    // games / launchers
    "steam", "steamwebhelper", "epicgameslauncher", "wegame",
    "genshinimpact", "yuanshen", "starrail", "zzz",
    "minecraft", "javaw",
    // social / chat
    "discord", "telegram", "wechat", "weixin", "qq", "tim",
    "slack", "line", "whatsapp",
    // streaming tools
    "obs64", "obs", "streamlabs",
]);

const WORK_APPS = new Set([
    // editors / IDEs
    "code", "code - insiders", "cursor",
    "idea64", "idea", "pycharm64", "pycharm", "webstorm64", "webstorm",
    "goland64", "goland", "clion64", "clion", "rider64", "rider",
    "sublime_text", "notepad++", "vim", "nvim", "emacs",
    "devenv", "visual studio",
    // terminals
    "windowsterminal", "wt", "cmd", "powershell", "pwsh",
    "iterm2", "terminal", "alacritty", "wezterm-gui",
    // office
    "winword", "excel", "powerpnt", "onenote",
    "word", "pages", "numbers", "keynote",
    "libreoffice", "soffice",
    // documents
    "acrobat", "acrord32", "foxitreader", "sumatrapdf",
    // utilities
    "explorer", "finder",
]);

// ── URL pattern lists ───────────────────────────────────────────────────────

const ENTERTAINMENT_URL_PATTERNS = [
    /youtube\.com/i,
    /twitch\.tv/i,
    /bilibili\.com/i,
    /netflix\.com/i,
    /disneyplus\.com/i,
    /crunchyroll\.com/i,
    /niconico\.jp/i,
    /nicovideo\.jp/i,
    /twitter\.com/i,
    /x\.com/i,
    /reddit\.com/i,
    /instagram\.com/i,
    /tiktok\.com/i,
    /douyin\.com/i,
    /weibo\.com/i,
    /zhihu\.com\/hot/i,
    /pixiv\.net/i,
    /steam(community|powered)\.com/i,
    /twitch\.tv/i,
    /v\.qq\.com/i,
    /iqiyi\.com/i,
    /youku\.com/i,
    /music\.163\.com/i,
];

const WORK_URL_PATTERNS = [
    /github\.com/i,
    /gitlab\.com/i,
    /bitbucket\.org/i,
    /stackoverflow\.com/i,
    /stackexchange\.com/i,
    /docs\.google\.com/i,
    /notion\.so/i,
    /confluence/i,
    /jira/i,
    /linear\.app/i,
    /figma\.com/i,
    /vercel\.com/i,
    /netlify\.com/i,
    /aws\.amazon\.com/i,
    /console\.cloud\.google/i,
    /portal\.azure\.com/i,
    /npmjs\.com/i,
    /pypi\.org/i,
    /developer\./i,
    /devdocs\.io/i,
    /mdn.*mozilla/i,
    /learn\.microsoft/i,
];

// ── Window title keywords ───────────────────────────────────────────────────

const ENTERTAINMENT_TITLE_KEYWORDS = [
    /\bep\.?\s*\d+/i,              // episode numbers
    /第\s*\d+\s*[集话期回]/,       // Chinese episode markers
    /\b(s\d+e\d+)\b/i,            // S01E01 format
    /bilibili/i,
    /哔哩哔哩|b站/i,
    /youtube/i,
    /netflix/i,
    /直播|番剧|弹幕|投稿|追番|视频/i,
    /playing|正在播放|正在观看/i,
    /\bgame\b|游戏/i,
];

const WORK_TITLE_KEYWORDS = [
    /\.(py|js|ts|mjs|jsx|tsx|rs|go|java|cpp|c|h|cs|rb|php|swift|kt)\b/i,
    /\.(md|txt|doc|docx|pdf|xlsx|pptx)\b/i,
    /visual studio|vs code|vscode/i,
    /terminal|命令行|终端/i,
    /debug|调试/i,
    /untitled|无标题/i,
];

// ── Classification logic ────────────────────────────────────────────────────

/**
 * Classify the user's current activity mode based on desktop context.
 *
 * @param {object} context
 * @param {string} context.appName - Process or application name
 * @param {string} context.windowTitle - Active window title
 * @param {string} [context.url] - Active browser URL (if available)
 * @returns {ActivityMode}
 */
export function classifyMode({ appName, windowTitle, url }) {
    const appLower = (appName || "").toLowerCase().replace(/\.exe$/, "");

    // 1. App identity (highest priority after explicit override)
    if (ENTERTAINMENT_APPS.has(appLower)) return "entertainment";
    if (WORK_APPS.has(appLower)) return "work";

    // 2. URL patterns (for browsers)
    if (url) {
        for (const pattern of ENTERTAINMENT_URL_PATTERNS) {
            if (pattern.test(url)) return "entertainment";
        }
        for (const pattern of WORK_URL_PATTERNS) {
            if (pattern.test(url)) return "work";
        }
    }

    // 3. Window title keywords
    for (const pattern of ENTERTAINMENT_TITLE_KEYWORDS) {
        if (pattern.test(windowTitle || "")) return "entertainment";
    }
    for (const pattern of WORK_TITLE_KEYWORDS) {
        if (pattern.test(windowTitle || "")) return "work";
    }

    // 4. Browser without matching URL → uncertain
    if (isBrowserApp(appLower)) return "uncertain";

    return "uncertain";
}

/**
 * @param {string} appLower - Lowercased app name without .exe
 * @returns {boolean}
 */
function isBrowserApp(appLower) {
    return (
        appLower === "chrome" ||
        appLower === "msedge" ||
        appLower === "firefox" ||
        appLower === "brave" ||
        appLower === "opera" ||
        appLower === "safari" ||
        appLower === "vivaldi" ||
        appLower === "arc" ||
        appLower.includes("browser")
    );
}
