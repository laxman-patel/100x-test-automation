import { existsSync, mkdirSync, readdirSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { runCommand } from "./shell"

const DEFAULT_EXTENSION_ID = process.env.EXTENSION_ID?.trim() || "kipkglfnhnpbogckhlmikjlfpbngnioc"
const DEFAULT_CDP_PORT = Number(process.env.CDP_PORT ?? process.env.RUNNER_CDP_PORT ?? 9223)
const DEFAULT_AUTH_STATE_FILE = resolve(process.cwd(), "artifacts/extension-auth-state.json")

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

interface PageState {
  ready: boolean
  fullText: string
  codeBlocks: string[]
  cellCount: number
  cellTexts: string[]
  url: string
}

// Keep for backward compat with ExtensionPromptResult
interface ConversationState {
  messages: { author: string; text: string }[]
  lastResponse: string | null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

function getExtensionUrl(extensionId: string): string {
  return `chrome-extension://${extensionId}/src/pages/agent/index.html`
}

function resolveChromePath(): string {
  const fromEnv = process.env.CHROME_PATH?.trim()
  if (fromEnv && existsSync(fromEnv)) return fromEnv

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

  throw new Error("Could not find Chromium binary. Set CHROME_PATH and retry.")
}

async function launchChromiumWithExtension(opts: {
  chromePath: string
  extensionPath: string
  cdpPort: number
  profilePath: string
  logPath: string
}): Promise<number> {
  mkdirSync(opts.profilePath, { recursive: true })
  mkdirSync(dirname(opts.logPath), { recursive: true })

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

function getAuthReplayScript(state: ReplayAuthState): string {
  return `
(async () => {
  const state = ${JSON.stringify(state)};
  const setStorage = (storage, data) => {
    const source = data || {};
    for (const [key, value] of Object.entries(source)) {
      storage.setItem(key, String(value));
    }
  };

  const setChromeStorage = async (area, data) => {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage[area]) {
        return { available: false };
      }
      const payload = data || {};
      await new Promise((resolve) => chrome.storage[area].set(payload, () => resolve(undefined)));
      return { available: true, keys: Object.keys(payload).length };
    } catch {
      return { available: false };
    }
  };

  setStorage(localStorage, state.localStorage);
  setStorage(sessionStorage, state.sessionStorage);
  await setChromeStorage('local', state.chromeStorageLocal);
  await setChromeStorage('sync', state.chromeStorageSync);
  return {
    ok: true,
    localStorageKeys: Object.keys(localStorage),
    sessionStorageKeys: Object.keys(sessionStorage)
  };
})()
`
}

function getTypePromptScript(text: string): string {
  return `(() => {
    const text = ${JSON.stringify(text)};
    const selectors = [
      'div[role="textbox"][aria-label="Message input"]',
      '[aria-label="Message input"]',
      'div[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"][aria-multiline="true"]',
      '[contenteditable="true"]'
    ];

    let prompt = null;
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node) {
        prompt = node;
        break;
      }
    }

    if (!prompt) {
      return { ok: false, reason: 'prompt-not-found' };
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

    prompt.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    prompt.dispatchEvent(new Event('change', { bubbles: true }));

    return {
      ok: true,
      preview: (prompt.textContent || '').slice(0, 120)
    };
  })()`
}

function getSendPromptScript(): string {
  return `(() => {
    const selectors = [
      'button[title="Send message (Enter)"]',
      'button[aria-label="Send message (Enter)"]',
      'button[title*="Send message"]'
    ];

    for (const selector of selectors) {
      const button = document.querySelector(selector);
      if (button) {
        button.click();
        return { ok: true, selector };
      }
    }

    return { ok: false, reason: 'send-button-not-found' };
  })()`
}

function getPageStateScript(): string {
  return `(() => {
    const body = document.body || document.documentElement;
    const innerText = body.innerText || '';
    const ready = innerText.includes('Agent is ready');

    // Use textContent (captures ALL text including hidden/styled elements)
    // innerText may miss code block content due to CSS rendering
    const fullText = body.textContent || '';

    // Find code blocks specifically — the extension renders JSON in <pre><code> with dangerouslySetInnerHTML
    const codeBlocks = [];
    const codeEls = document.querySelectorAll('pre code, code[class*="language-"], .markdown-content pre, .markdown-content code');
    for (const el of codeEls) {
      const text = (el.textContent || '').trim();
      if (text.length > 20) codeBlocks.push(text);
    }

    // Also try data-cell-id cells
    const cells = document.querySelectorAll('[data-cell-id]');
    const cellTexts = [];
    for (const cell of cells) {
      const clone = cell.cloneNode(true);
      if (clone.querySelectorAll) {
        clone.querySelectorAll('button, [role="button"]').forEach(b => b.remove());
      }
      const text = (clone.textContent || '').replace(/\\s+/g, ' ').trim();
      if (text.length > 2) cellTexts.push(text);
    }

    return JSON.stringify({
      ready,
      fullText: fullText.substring(0, 50000),
      codeBlocks,
      cellCount: cells.length,
      cellTexts,
      url: location.href,
    });
  })()`
}

async function waitForCdpReady(port: number, timeoutMs = 30_000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const probe = await runCommand(["agent-browser", "--cdp", String(port), "get", "url"], 3_000)
    if (probe.exitCode === 0) return
    await sleep(300)
  }

  throw new Error(`Timed out waiting for CDP on port ${port}`)
}

async function loadAuthState(path: string): Promise<ReplayAuthState | null> {
  if (!existsSync(path)) return null
  const raw = await readFile(path, "utf8")
  return JSON.parse(raw) as ReplayAuthState
}

export interface ExtensionPromptResult {
  prompt: string
  responseText: string
  rawConversation: ConversationState
}

export class ExtensionAgentSession {
  private readonly cdpPort: number
  private readonly extensionId: string
  private readonly extensionPath: string
  private readonly authStateFile: string
  private chromePid: number | null = null

  constructor(opts?: {
    cdpPort?: number
    extensionId?: string
    extensionPath?: string
    authStateFile?: string
  }) {
    this.cdpPort = opts?.cdpPort ?? DEFAULT_CDP_PORT
    this.extensionId = opts?.extensionId ?? DEFAULT_EXTENSION_ID
    this.extensionPath = resolve(process.cwd(), opts?.extensionPath ?? "100x-extension-build")
    this.authStateFile = resolve(process.cwd(), opts?.authStateFile ?? DEFAULT_AUTH_STATE_FILE)
  }

  private async raw(args: string[], timeoutMs = 120_000) {
    const result = await runCommand(["agent-browser", "--cdp", String(this.cdpPort), ...args], timeoutMs)
    if (result.exitCode !== 0) {
      throw new Error(
        result.stderr.trim() || result.stdout.trim() || `Command failed: agent-browser --cdp ${this.cdpPort} ${args.join(" ")}`,
      )
    }
    return result.stdout.trim()
  }

  // agent-browser eval double-stringifies: JS returning JSON.stringify(obj)
  // produces '"{\\"key\\":\\"val\\"}"' on stdout. This unwraps it.
  private parseEvalJson<T>(raw: string): T {
    let value: unknown = raw
    // Unwrap up to 2 layers of JSON string encoding
    for (let i = 0; i < 2; i++) {
      if (typeof value === "string") {
        try { value = JSON.parse(value) } catch { break }
      } else {
        break
      }
    }
    return value as T
  }

  async start(log?: (line: string) => void): Promise<void> {
    const chromePath = resolveChromePath()
    const profilePath = resolve(process.cwd(), `artifacts/workflow-browser-${Date.now()}`)
    const logPath = resolve(process.cwd(), "artifacts/workflow-browser.log")

    try {
      await runCommand(["pkill", "-f", `remote-debugging-port=${this.cdpPort}`], 10_000)
      log?.(`Cleared prior CDP browser on port ${this.cdpPort}`)
      await sleep(500)
    } catch {
      log?.(`No existing CDP browser found on port ${this.cdpPort}`)
    }

    this.chromePid = await launchChromiumWithExtension({
      chromePath,
      extensionPath: this.extensionPath,
      cdpPort: this.cdpPort,
      profilePath,
      logPath,
    })
    log?.(`Launched Chromium with extension on CDP ${this.cdpPort}`)

    await waitForCdpReady(this.cdpPort)
    const extensionUrl = getExtensionUrl(this.extensionId)

    try {
      await this.raw(["open", extensionUrl], 30_000)
    } catch {
      await this.raw(["tab", "new", extensionUrl], 30_000)
    }
    await this.raw(["wait", "2500"], 30_000)

    const authState = await loadAuthState(this.authStateFile)
    if (authState) {
      if (Array.isArray(authState.cookies)) {
        for (const cookie of authState.cookies) {
          if (!cookie?.name) continue
          try {
            await this.raw(buildCookieSetArgs(cookie), 20_000)
          } catch {
            // ignore partial cookie failures
          }
        }
      }

      await this.raw(["eval", getAuthReplayScript(authState)], 60_000)
      await this.raw(["eval", "location.reload(); 'reloaded'"], 30_000)
      await this.raw(["wait", "2500"], 30_000)
      log?.(`Applied auth state from ${this.authStateFile}`)
    } else {
      log?.(`No auth state file found at ${this.authStateFile}`)
    }
  }

  private async getPageState(): Promise<PageState> {
    const raw = await this.raw(["eval", getPageStateScript()], 30_000)
    const parsed = this.parseEvalJson<PageState>(raw)
    if (!parsed || typeof parsed !== "object") {
      throw new Error(`Could not parse page state (${raw.length} chars): ${raw.slice(0, 200)}`)
    }
    return parsed
  }

  // Extract the most meaningful response text from the page state.
  // Prioritizes: code blocks > cell texts > full body text
  private extractResponseText(page: PageState, promptText: string): string {
    // Best: code blocks from <pre><code> — this is where the JSON response lives
    if (page.codeBlocks.length > 0) {
      // Pick the longest code block (the schema JSON will be the biggest)
      const sorted = [...page.codeBlocks].sort((a, b) => b.length - a.length)
      return sorted[0]
    }

    // Next: cell texts that aren't the user prompt
    if (page.cellTexts.length > 1) {
      const promptNorm = promptText.replace(/\s+/g, " ").trim()
      const candidates = page.cellTexts
        .filter((t) => !promptNorm.includes(t) && !t.includes(promptNorm))
        .sort((a, b) => b.length - a.length)
      if (candidates.length > 0) return candidates[0]
    }

    // Fallback: use full body text
    return page.fullText.trim()
  }

  async prompt(message: string, log?: (line: string) => void): Promise<ExtensionPromptResult> {
    const baselinePage = await this.getPageState()
    const baselineText = baselinePage.fullText.trim()
    await this.raw(["eval", getTypePromptScript(message)], 45_000)
    await this.raw(["eval", getSendPromptScript()], 30_000)
    log?.(`Prompt sent (${message.length} chars)`)

    const started = Date.now()
    let lastSeenText = ""
    let stablePolls = 0

    let pollCount = 0
    while (Date.now() - started < 180_000) {
      await this.raw(["wait", "1500"], 15_000)
      pollCount += 1

      let page: PageState
      try {
        page = await this.getPageState()
      } catch (err) {
        if (pollCount <= 3) log?.(`Poll #${pollCount}: page state error: ${err instanceof Error ? err.message : String(err)}`)
        continue
      }

      const currentText = page.fullText.trim()
      const responseText = this.extractResponseText(page, message)
      const textChanged = currentText !== baselineText && currentText !== lastSeenText

      // Log diagnostics
      if (pollCount <= 3 || pollCount % 10 === 0) {
        log?.(`Poll #${pollCount}: ready=${page.ready} cells=${page.cellCount} codeBlocks=${page.codeBlocks.length} fullText=${currentText.length}ch response=${responseText.length}ch`)
      }

      if (!page.ready) {
        if (textChanged) {
          lastSeenText = currentText
          log?.(`Response streaming (${currentText.length} chars)`)
        }
        continue
      }

      // Agent is ready. Check if page content differs from baseline.
      if (currentText !== baselineText && currentText.length > message.length + 50) {
        log?.(`Agent ready, response complete (${responseText.length} chars)`)
        return {
          prompt: message,
          responseText,
          rawConversation: {
            messages: page.cellTexts.map((t) => ({ author: "unknown", text: t })),
            lastResponse: responseText,
          },
        }
      }

      // Stable-poll fallback
      if (currentText === lastSeenText && currentText !== baselineText) {
        stablePolls += 1
        if (stablePolls >= 2) {
          log?.(`Response stable after ${stablePolls} polls (${responseText.length} chars)`)
          return {
            prompt: message,
            responseText,
            rawConversation: {
              messages: page.cellTexts.map((t) => ({ author: "unknown", text: t })),
              lastResponse: responseText,
            },
          }
        }
      } else {
        stablePolls = 0
      }
      lastSeenText = currentText
    }

    // Timeout — return whatever we have
    try {
      const finalPage = await this.getPageState()
      const finalResponse = this.extractResponseText(finalPage, message)
      if (finalResponse.length > message.length + 50) {
        log?.(`Timeout but returning available response (${finalResponse.length} chars)`)
        return {
          prompt: message,
          responseText: finalResponse,
          rawConversation: { messages: [], lastResponse: finalResponse },
        }
      }
    } catch {
      // ignore
    }

    throw new Error("Timed out waiting for extension response.")
  }

  async close(): Promise<void> {
    try {
      await this.raw(["close"], 15_000)
    } catch {
      // ignore close errors
    }

    if (this.chromePid) {
      try {
        await runCommand(["kill", "-TERM", String(this.chromePid)], 10_000)
      } catch {
        // ignore kill failures
      }
    }
  }
}
