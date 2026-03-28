import { existsSync, mkdirSync, readdirSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { runCommand } from "../lib/shell"

const DEFAULT_EXTENSION_ID = "kipkglfnhnpbogckhlmikjlfpbngnioc"
const DEFAULT_CDP_PORT = 9223

interface ReplayAuthState {
  localStorage?: Record<string, string>
  sessionStorage?: Record<string, string>
  chromeStorageLocal?: Record<string, unknown>
  chromeStorageSync?: Record<string, unknown>
  cookies?: ReplayAuthCookie[]
}

interface ReplayAuthCookie {
  name: string
  value: string
  url?: string
  domain?: string
  path?: string
  expires?: number
  httpOnly?: boolean
  secure?: boolean
  sameSite?: string
}

interface AgentBrowserJsonResponse<T> {
  success?: boolean
  data?: T
  error?: string | null
}

interface ConsoleMessage {
  type?: string
  text?: string
  timestamp?: number
}

interface PageError {
  message?: string
  stack?: string
  timestamp?: number
}

function replayHasAuthToken(state: ReplayAuthState): boolean {
  const daptin = state.chromeStorageSync?.DAPTIN
  return Boolean(
    daptin
      && typeof daptin === "object"
      && typeof (daptin as { token?: unknown }).token === "string"
      && ((daptin as { token: string }).token.length > 40),
  )
}

function getExtensionUrl(extensionId: string): string {
  return `chrome-extension://${extensionId}/src/pages/agent/index.html`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

function resolveChromePath(): string {
  const fromEnv = process.env.CHROME_PATH?.trim()
  if (fromEnv && existsSync(fromEnv)) {
    return fromEnv
  }

  const home = process.env.HOME ?? ""
  const playwrightCache = resolve(home, ".cache/ms-playwright")

  if (existsSync(playwrightCache)) {
    const chromiumDirs = readdirSync(playwrightCache)
      .filter((name) => name.startsWith("chromium-"))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))

    for (const dir of chromiumDirs) {
      const chromePathA = resolve(playwrightCache, dir, "chrome-linux64/chrome")
      const chromePathB = resolve(playwrightCache, dir, "chrome-linux/chrome")
      if (existsSync(chromePathA)) return chromePathA
      if (existsSync(chromePathB)) return chromePathB
    }
  }

  const candidates = ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }

  throw new Error(
    "Could not find a Chromium binary. Set CHROME_PATH explicitly and try again.",
  )
}

async function launchChromiumWithExtension(opts: {
  chromePath: string
  extensionPath: string
  cdpPort: number
  profilePath: string
  logPath: string
}): Promise<number> {
  mkdirSync(opts.profilePath, { recursive: true })

  const pythonScript = `
import subprocess
chrome = ${JSON.stringify(opts.chromePath)}
profile = ${JSON.stringify(opts.profilePath)}
ext = ${JSON.stringify(opts.extensionPath)}
log = ${JSON.stringify(opts.logPath)}
port = ${JSON.stringify(String(opts.cdpPort))}
cmd = [
  chrome,
  f'--user-data-dir={profile}',
  f'--remote-debugging-port={port}',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-dev-shm-usage',
  f'--disable-extensions-except={ext}',
  f'--load-extension={ext}',
  'about:blank'
]
with open(log, 'ab') as f:
  p = subprocess.Popen(cmd, stdout=f, stderr=f, start_new_session=True)
print(p.pid)
`

  const res = await runCommand(["python", "-c", pythonScript], 20_000)
  if (res.exitCode !== 0) {
    throw new Error(res.stderr.trim() || res.stdout.trim() || "Failed to launch Chromium")
  }

  const pid = Number((res.stdout || "").trim().split(/\s+/).pop())
  if (!Number.isFinite(pid)) {
    throw new Error(`Could not parse Chromium PID from launcher output: ${res.stdout.trim()}`)
  }

  return pid
}

function jsonForEval(value: unknown): string {
  return JSON.stringify(value)
}

function getPromptAnalysisScript(): string {
  return `(() => {
    const selectors = [
      'div[role="textbox"][aria-label="Message input"]',
      '[aria-label="Message input"]',
      'div[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"][aria-multiline="true"]',
      '[contenteditable="true"]'
    ];

    let prompt = null;
    let selectorUsed = null;

    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node) {
        prompt = node;
        selectorUsed = selector;
        break;
      }
    }

    const sendButton = document.querySelector('button[title="Send message (Enter)"]');
    const roots = Array.from(document.body.children)
      .slice(0, 8)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        role: el.getAttribute('role') || null,
        className: (el.className || '').toString().slice(0, 120)
      }));

    return {
      url: location.href,
      title: document.title,
      rootNodes: roots,
      promptFound: Boolean(prompt),
      promptSelector: selectorUsed,
      promptAttributes: prompt
        ? {
            role: prompt.getAttribute('role'),
            ariaLabel: prompt.getAttribute('aria-label'),
            ariaMultiline: prompt.getAttribute('aria-multiline'),
            contentEditable: prompt.getAttribute('contenteditable') || String(prompt.isContentEditable),
            className: (prompt.className || '').toString().slice(0, 200)
          }
        : null,
      hasSendButton: Boolean(sendButton),
      sendButtonTitle: sendButton ? sendButton.getAttribute('title') : null
    };
  })()`
}

function getTypePromptScript(text: string): string {
  return `(() => {
    const text = ${jsonForEval(text)};
    const selectors = [
      'div[role="textbox"][aria-label="Message input"]',
      '[aria-label="Message input"]',
      'div[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"][aria-multiline="true"]',
      '[contenteditable="true"]'
    ];

    let prompt = null;
    let selectorUsed = null;

    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node) {
        prompt = node;
        selectorUsed = selector;
        break;
      }
    }

    if (!prompt) {
      return { ok: false, reason: 'prompt-not-found', selectorUsed: null };
    }

    prompt.focus();

    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(prompt);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    try {
      document.execCommand('selectAll', false);
      document.execCommand('delete', false);
      document.execCommand('insertText', false, text);
    } catch {
      prompt.textContent = text;
    }

    if (!prompt.textContent || !prompt.textContent.includes(text.slice(0, Math.min(8, text.length)))) {
      prompt.textContent = text;
    }

    prompt.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    prompt.dispatchEvent(new Event('change', { bubbles: true }));

    return {
      ok: true,
      selectorUsed,
      textLength: text.length,
      preview: (prompt.textContent || '').slice(0, 120)
    };
  })()`
}

function getAuthBootstrapScript(token: string, email: string): string {
  return `(() => {
    const token = ${jsonForEval(token)};
    const email = ${jsonForEval(email)};

    localStorage.setItem('token', token);
    localStorage.setItem('email', email);
    localStorage.setItem('userEmail', email);

    let jwtExpIso = null;
    try {
      const payload = token.split('.')[1] || '';
      const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
      const json = atob(padded);
      const decoded = JSON.parse(json);
      if (decoded && typeof decoded.exp === 'number') {
        jwtExpIso = new Date(decoded.exp * 1000).toISOString();
      }
    } catch {
      // ignore decode errors
    }

    return {
      ok: true,
      tokenStored: Boolean(localStorage.getItem('token')),
      emailStored: localStorage.getItem('email'),
      userEmailStored: localStorage.getItem('userEmail'),
      jwtExpIso,
      keys: Object.keys(localStorage)
    };
  })()`
}

function getAuthReplayScript(state: ReplayAuthState, strict: boolean): string {
  return `
(async () => {
  const state = ${jsonForEval(state)};
  const strict = ${jsonForEval(strict)};

  const setStorage = (storage, data) => {
    const source = data || {};
    if (strict) storage.clear();
    for (const [key, value] of Object.entries(source)) {
      storage.setItem(key, String(value));
    }
  };

  const setChromeStorage = async (area, data) => {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage[area]) {
        return { available: false, keys: 0 };
      }

      if (strict) {
        await new Promise((resolve) => chrome.storage[area].clear(() => resolve(undefined)));
      }

      const payload = data || {};
      await new Promise((resolve) => chrome.storage[area].set(payload, () => resolve(undefined)));
      return { available: true, keys: Object.keys(payload).length };
    } catch {
      return { available: false, keys: 0 };
    }
  };

  setStorage(localStorage, state.localStorage);
  setStorage(sessionStorage, state.sessionStorage);

  const daptin = state?.chromeStorageSync && typeof state.chromeStorageSync === 'object'
    ? state.chromeStorageSync.DAPTIN
    : null;

  if (daptin && typeof daptin === 'object' && typeof daptin.token === 'string') {
    localStorage.setItem('token', daptin.token);
    if (daptin.user && typeof daptin.user === 'object' && typeof daptin.user.email === 'string') {
      localStorage.setItem('email', daptin.user.email);
      localStorage.setItem('userEmail', daptin.user.email);
    }
  }

  const localResult = await setChromeStorage('local', state.chromeStorageLocal);
  const syncResult = await setChromeStorage('sync', state.chromeStorageSync);

  return {
    ok: true,
    strict,
    localStorageKeys: Object.keys(state.localStorage || {}).length,
    sessionStorageKeys: Object.keys(state.sessionStorage || {}).length,
    chromeStorageLocal: localResult,
    chromeStorageSync: syncResult,
    currentLocalStorageKeys: Object.keys(localStorage),
  };
})()
`
}

function getSendPromptScript(): string {
  return `(() => {
    const selectors = [
      'button[title="Send message (Enter)"]',
      'button[aria-label="Send message (Enter)"]',
      'button[title*="Send message"]'
    ];

    let button = null;
    let selectorUsed = null;
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node) {
        button = node;
        selectorUsed = selector;
        break;
      }
    }

    if (!button) {
      return { ok: false, reason: 'send-button-not-found' };
    }

    button.click();
    return { ok: true, selectorUsed };
  })()`
}

function isValidSameSite(value: string | undefined): value is "Strict" | "Lax" | "None" {
  return value === "Strict" || value === "Lax" || value === "None"
}

function buildCookieSetArgs(cookie: ReplayAuthCookie): string[] {
  const args = ["cookies", "set", cookie.name, cookie.value]

  if (cookie.url) {
    args.push("--url", cookie.url)
  } else if (cookie.domain) {
    args.push("--domain", cookie.domain)
  }

  if (cookie.path) args.push("--path", cookie.path)
  if (cookie.httpOnly) args.push("--httpOnly")
  if (cookie.secure) args.push("--secure")
  if (isValidSameSite(cookie.sameSite)) args.push("--sameSite", cookie.sameSite)

  if (typeof cookie.expires === "number" && Number.isFinite(cookie.expires) && cookie.expires > 0) {
    args.push("--expires", String(Math.floor(cookie.expires)))
  }

  return args
}

async function applyAuthCookies(base: string[], cookies: ReplayAuthCookie[]): Promise<void> {
  let applied = 0
  let skipped = 0

  for (const cookie of cookies) {
    if (!cookie?.name) {
      skipped += 1
      continue
    }

    try {
      await runAgentCommand(base, buildCookieSetArgs(cookie), 30_000)
      applied += 1
    } catch {
      skipped += 1
    }
  }

  console.log(`Cookie replay: applied=${applied}, skipped=${skipped}`)
}

async function runAgentCommand(base: string[], args: string[], timeoutMs = 120_000) {
  const res = await runCommand([...base, ...args], timeoutMs)
  if (res.exitCode !== 0) {
    throw new Error(res.stderr.trim() || res.stdout.trim() || `Command failed: ${args.join(" ")}`)
  }
  return res
}

async function runAgentJson<T>(base: string[], args: string[], timeoutMs = 120_000): Promise<AgentBrowserJsonResponse<T>> {
  const res = await runAgentCommand(base, ["--json", ...args], timeoutMs)
  return JSON.parse(res.stdout) as AgentBrowserJsonResponse<T>
}

async function captureConsoleDiagnostics(base: string[], outPath: string): Promise<void> {
  const [consoleRes, errorsRes] = await Promise.all([
    runAgentJson<{ messages?: ConsoleMessage[] }>(base, ["console"]),
    runAgentJson<{ errors?: PageError[] }>(base, ["errors"]),
  ])

  const payload = {
    capturedAt: new Date().toISOString(),
    messages: consoleRes.data?.messages ?? [],
    pageErrors: errorsRes.data?.errors ?? [],
  }

  mkdirSync(dirname(outPath), { recursive: true })
  await writeFile(outPath, JSON.stringify(payload, null, 2), "utf8")

  const errorCount = payload.messages.filter((msg) => (msg.type ?? "").toLowerCase() === "error").length
  console.log(
    `Console diagnostics saved -> ${outPath} (${payload.messages.length} messages, ${payload.pageErrors.length} page errors, ${errorCount} console errors)`,
  )
}

async function waitForCdpReady(port: number, timeoutMs = 30_000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const probe = await runCommand(["agent-browser", "--cdp", String(port), "get", "url"], 3_000)
    if (probe.exitCode === 0) {
      return
    }
    await sleep(300)
  }

  throw new Error(`Timed out waiting for CDP on port ${port}`)
}

async function main() {
  const message =
    process.argv.slice(2).join(" ") ||
    "Create a simple workflow that captures page title and current URL, then outputs both fields."

  const extensionId = process.env.EXTENSION_ID?.trim() || DEFAULT_EXTENSION_ID
  const extensionUrl = getExtensionUrl(extensionId)
  const cdpPort = Number(process.env.CDP_PORT ?? DEFAULT_CDP_PORT)
  const authToken = process.env.AUTH_TOKEN?.trim()
  const authEmail = process.env.AUTH_EMAIL?.trim() || "laxmanlp777@gmail.com"
  const authStateFile = process.env.AUTH_STATE_FILE?.trim() || resolve(process.cwd(), "artifacts/extension-auth-state.json")
  const authStateStrict = process.env.AUTH_STATE_STRICT === "1"
  const keepOpen = process.env.KEEP_OPEN === "1"
  const autoSend = process.env.AUTO_SEND === "1"
  const captureConsole = process.env.CAPTURE_CONSOLE !== "0"
  const consoleOut = process.env.CONSOLE_OUT?.trim() || resolve(process.cwd(), `artifacts/extension-console-${Date.now()}.json`)

  const extensionPath = resolve(process.cwd(), "100x-extension-build")
  const chromePath = resolveChromePath()
  const profilePath = resolve(process.cwd(), `artifacts/manual-chrome-profile-${Date.now()}`)
  const logPath = resolve(process.cwd(), "artifacts/manual-chrome.log")
  const base = ["agent-browser", "--cdp", String(cdpPort)]
  let chromePid: number | null = null
  let authState: ReplayAuthState | null = null
  const allowPartialAuthState = process.env.ALLOW_PARTIAL_AUTH_STATE === "1"

  if (existsSync(authStateFile)) {
    try {
      const rawState = await readFile(authStateFile, "utf8")
      authState = JSON.parse(rawState) as ReplayAuthState
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to parse AUTH_STATE_FILE (${authStateFile}): ${message}`)
    }

    if (!replayHasAuthToken(authState) && !authToken && !allowPartialAuthState) {
      throw new Error(
        `Auth replay file exists but has no DAPTIN token: ${authStateFile}\n`
          + `This usually causes 'Your session has expired'.\n`
          + `Re-run: bun run capture:auth-state (login manually), then retry.\n`
          + `If you intentionally want partial replay, set ALLOW_PARTIAL_AUTH_STATE=1.`,
      )
    }
  }

  try {
    await runCommand(["pkill", "-f", `remote-debugging-port=${cdpPort}`], 10_000)
  } catch {
    // ignore if no process matched
  }

  console.log("Launching Chromium with extension loaded...")
  console.log(`Using extension ID: ${extensionId}`)
  console.log(`Using Chromium: ${chromePath}`)
  console.log(`Using CDP port: ${cdpPort}`)

  try {
    try {
      chromePid = await launchChromiumWithExtension({
        chromePath,
        extensionPath,
        cdpPort,
        profilePath,
        logPath,
      })

    await waitForCdpReady(cdpPort)
    await runAgentCommand(base, ["tab", "new", extensionUrl])
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error)
      throw new Error(
        `Could not open extension page.\n`
          + `1) Ensure EXTENSION_ID is correct.\n`
          + `2) Verify extension path: ${extensionPath}\n`
          + `3) Verify Chromium path: ${chromePath}\n`
          + `Current extension URL: ${extensionUrl}\n`
          + `${messageText}`,
      )
    }

    await runAgentCommand(base, ["wait", "2500"])

    if (captureConsole) {
      await runAgentJson(base, ["console", "--clear"])
      await runAgentJson(base, ["errors", "--clear"])
    }

    if (authState) {
      console.log(`Applying auth state from: ${authStateFile}`)

      if (!authState.chromeStorageSync?.DAPTIN) {
        console.log("Warning: auth state has no chromeStorageSync.DAPTIN token payload.")
      }

      if (Array.isArray(authState.cookies) && authState.cookies.length > 0) {
        await applyAuthCookies(base, authState.cookies)
      }

      const replayResult = await runAgentCommand(base, ["eval", getAuthReplayScript(authState, authStateStrict)], 60_000)
      console.log("Auth replay:")
      console.log(replayResult.stdout.trim())

      await runAgentCommand(base, ["eval", "location.reload(); 'reloaded'"], 30_000)
      await runAgentCommand(base, ["wait", "2500"])
    } else if (authToken) {
      const authResult = await runAgentCommand(base, ["eval", getAuthBootstrapScript(authToken, authEmail)])
      console.log("Auth bootstrap:")
      console.log(authResult.stdout.trim())

      await runAgentCommand(base, ["eval", "location.reload(); 'reloaded'"], 30_000)
      await runAgentCommand(base, ["wait", "2500"])
    } else {
      console.log("Auth bootstrap skipped (provide AUTH_STATE_FILE or AUTH_TOKEN).")
    }

    const analysis = await runAgentCommand(base, ["eval", getPromptAnalysisScript()])
    console.log("DOM analysis:")
    console.log(analysis.stdout.trim())

    const typing = await runAgentCommand(base, ["eval", getTypePromptScript(message)])
    console.log("Typing result:")
    console.log(typing.stdout.trim())

    if (autoSend) {
      const sendRes = await runAgentCommand(base, ["eval", getSendPromptScript()])
      console.log("Send result:")
      console.log(sendRes.stdout.trim())
      await runAgentCommand(base, ["wait", "1200"])
    }

    const snapshot = await runAgentCommand(base, ["snapshot", "-i", "--json"])
    console.log("Interactive snapshot:")
    console.log(snapshot.stdout.trim())

    await runAgentCommand(base, ["screenshot", resolve(process.cwd(), "artifacts/extension-agent-page.png")])

    if (captureConsole) {
      await captureConsoleDiagnostics(base, consoleOut)
    }
  } finally {
    if (keepOpen) {
      console.log(`Keeping browser open (KEEP_OPEN=1). CDP port: ${cdpPort}`)
      if (chromePid) {
        console.log(`Chromium PID: ${chromePid}`)
      }
    } else {
      try {
        await runAgentCommand(base, ["close"], 15_000)
      } catch {
        // ignore close errors
      }

      if (chromePid) {
        await runCommand(["kill", "-TERM", String(chromePid)], 10_000)
      }
    }
  }
}

await main()
