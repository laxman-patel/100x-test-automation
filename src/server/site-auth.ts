import { existsSync, mkdirSync, readdirSync } from "node:fs"
import { readFile, stat, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { runCommand } from "@/src/lib/shell"

const SITE_AUTH_DIR = resolve(process.cwd(), "artifacts/site-auth")

interface BrowserCookie {
  name: string
  value: string
  domain?: string
  path?: string
  expires?: number
  httpOnly?: boolean
  secure?: boolean
  sameSite?: string
}

export interface SiteAuthState {
  domain: string
  capturedAt: string
  url: string
  title: string
  localStorage: Record<string, string>
  sessionStorage: Record<string, string>
  cookies: BrowserCookie[]
}

export interface SiteAuthStatus {
  domain: string
  status: "idle" | "awaiting-user" | "saving" | "completed" | "failed"
  startedAt?: string
  finishedAt?: string
  error?: string
  savedState?: {
    exists: boolean
    capturedAt?: string
    updatedAt?: string
    cookieCount?: number
    localStorageKeyCount?: number
  }
}

interface ActiveSiteAuthSession {
  domain: string
  startUrl: string
  status: "awaiting-user" | "saving" | "completed" | "failed"
  startedAt: string
  finishedAt?: string
  error?: string
  cdpPort: number
  chromePid: number | null
  base: string[]
  beforeState?: SiteAuthState
}

// One active session per domain
const activeSessions = new Map<string, ActiveSiteAuthSession>()

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
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

  const fallback = ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]
  for (const f of fallback) {
    if (existsSync(f)) return f
  }
  throw new Error("Could not find Chromium. Set CHROME_PATH.")
}

function domainSlug(domain: string): string {
  return domain.toLowerCase().replace(/[^a-z0-9.-]/g, "_")
}

function siteAuthPath(domain: string): string {
  return resolve(SITE_AUTH_DIR, `${domainSlug(domain)}.json`)
}

// Pick a CDP port that won't clash with extension auth (9223) or other site captures
function cdpPortForDomain(domain: string): number {
  let hash = 0
  for (const ch of domain) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0
  return 9300 + (Math.abs(hash) % 200)
}

function getCaptureScript(domain: string): string {
  return `
(async () => {
  const readStorage = (storage) => {
    const out = {};
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key == null) continue;
        out[key] = storage.getItem(key);
      }
    } catch {}
    return out;
  };
  return {
    domain: ${JSON.stringify(domain)},
    capturedAt: new Date().toISOString(),
    url: location.href,
    title: document.title,
    localStorage: readStorage(localStorage),
    sessionStorage: readStorage(sessionStorage),
  };
})()
`
}

async function launchPlainChrome(opts: {
  chromePath: string
  cdpPort: number
  profilePath: string
  startUrl: string
}): Promise<number> {
  mkdirSync(opts.profilePath, { recursive: true })
  const logPath = resolve(process.cwd(), "artifacts/site-auth-capture.log")
  mkdirSync(resolve(process.cwd(), "artifacts"), { recursive: true })

  const pythonScript = `
import subprocess
chrome = ${JSON.stringify(opts.chromePath)}
profile = ${JSON.stringify(opts.profilePath)}
log = ${JSON.stringify(logPath)}
port = ${JSON.stringify(String(opts.cdpPort))}
url = ${JSON.stringify(opts.startUrl)}
cmd = [
  chrome,
  f'--user-data-dir={profile}',
  f'--remote-debugging-port={port}',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-dev-shm-usage',
  url
]
with open(log, 'ab') as f:
  p = subprocess.Popen(cmd, stdout=f, stderr=f, start_new_session=True)
print(p.pid)
`

  const res = await runCommand(["python", "-c", pythonScript], 20_000)
  if (res.exitCode !== 0) {
    throw new Error(res.stderr.trim() || res.stdout.trim() || "Failed to launch Chrome")
  }
  const pid = Number((res.stdout || "").trim().split(/\s+/).pop())
  if (!Number.isFinite(pid)) {
    throw new Error(`Could not parse Chrome PID: ${res.stdout.trim()}`)
  }
  return pid
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

async function captureSiteState(base: string[], domain: string): Promise<SiteAuthState> {
  const evalRes = await runCommand([...base, "eval", getCaptureScript(domain)], 60_000)
  if (evalRes.exitCode !== 0) {
    throw new Error(`eval failed: ${evalRes.stderr || evalRes.stdout}`)
  }

  const raw = evalRes.stdout.trim()
  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")
  const jsonStr = start >= 0 && end > start ? raw.slice(start, end + 1) : raw
  const state = JSON.parse(jsonStr) as Omit<SiteAuthState, "cookies">

  // Get cookies via agent-browser
  const cookieRes = await runCommand([...base, "--json", "cookies", "get"], 30_000)
  let cookies: BrowserCookie[] = []
  if (cookieRes.exitCode === 0) {
    try {
      const parsed = JSON.parse(cookieRes.stdout.trim()) as { success?: boolean; data?: { cookies?: BrowserCookie[] } }
      cookies = parsed.data?.cookies ?? []
    } catch {
      // ignore parse failure
    }
  }

  return { ...state, cookies }
}

async function closeSession(session: ActiveSiteAuthSession): Promise<void> {
  try {
    await runCommand([...session.base, "close"], 15_000)
  } catch {
    // ignore
  }
  if (session.chromePid) {
    try {
      await runCommand(["kill", "-TERM", String(session.chromePid)], 10_000)
    } catch {
      // ignore
    }
  }
}

function hasUsefulAuthState(state: SiteAuthState): boolean {
  const hasCookies = state.cookies.length > 0
  const hasStorage = Object.keys(state.localStorage).length > 0
  return hasCookies || hasStorage
}

// --- Public API ---

export async function getSiteAuthStatus(domain: string): Promise<SiteAuthStatus> {
  const session = activeSessions.get(domainSlug(domain))
  const filePath = siteAuthPath(domain)
  let savedState: SiteAuthStatus["savedState"] = undefined

  if (existsSync(filePath)) {
    try {
      const [raw, info] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)])
      const parsed = JSON.parse(raw) as SiteAuthState
      savedState = {
        exists: true,
        capturedAt: parsed.capturedAt,
        updatedAt: info.mtime.toISOString(),
        cookieCount: parsed.cookies.length,
        localStorageKeyCount: Object.keys(parsed.localStorage).length,
      }
    } catch {
      savedState = { exists: false }
    }
  } else {
    savedState = { exists: false }
  }

  if (!session) {
    return { domain, status: "idle", savedState }
  }

  return {
    domain,
    status: session.status,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    error: session.error,
    savedState,
  }
}

export async function listSiteAuthDomains(): Promise<SiteAuthStatus[]> {
  if (!existsSync(SITE_AUTH_DIR)) return []
  const files = readdirSync(SITE_AUTH_DIR).filter((f) => f.endsWith(".json"))
  const results: SiteAuthStatus[] = []
  for (const file of files) {
    const domain = file.replace(/\.json$/, "").replace(/_/g, ".")
    results.push(await getSiteAuthStatus(domain))
  }
  return results
}

export async function startSiteAuthCapture(domain: string, startUrl: string): Promise<SiteAuthStatus> {
  const slug = domainSlug(domain)
  const existing = activeSessions.get(slug)
  if (existing && (existing.status === "awaiting-user" || existing.status === "saving")) {
    throw new Error(`Site auth capture already in progress for ${domain}`)
  }

  const cdpPort = cdpPortForDomain(domain)
  const chromePath = resolveChromePath()
  const profilePath = resolve(process.cwd(), `artifacts/site-auth-profile-${slug}-${Date.now()}`)
  const base = ["agent-browser", "--cdp", String(cdpPort)]

  // Kill any leftover chrome on this port
  try {
    await runCommand(["pkill", "-f", `remote-debugging-port=${cdpPort}`], 10_000)
  } catch {
    // ignore
  }

  const chromePid = await launchPlainChrome({ chromePath, cdpPort, profilePath, startUrl })

  try {
    await waitForCdpReady(cdpPort)

    const session: ActiveSiteAuthSession = {
      domain,
      startUrl,
      status: "awaiting-user",
      startedAt: new Date().toISOString(),
      cdpPort,
      chromePid,
      base,
    }
    activeSessions.set(slug, session)

    return await getSiteAuthStatus(domain)
  } catch (error) {
    const failedSession: ActiveSiteAuthSession = {
      domain,
      startUrl,
      status: "failed",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      cdpPort,
      chromePid,
      base,
    }
    await closeSession(failedSession)
    activeSessions.set(slug, failedSession)
    return await getSiteAuthStatus(domain)
  }
}

export async function finishSiteAuthCapture(domain: string): Promise<SiteAuthStatus> {
  const slug = domainSlug(domain)
  const session = activeSessions.get(slug)
  if (!session || session.status !== "awaiting-user") {
    throw new Error(`No active site auth capture waiting for ${domain}`)
  }

  session.status = "saving"

  try {
    const state = await captureSiteState(session.base, domain)

    if (!hasUsefulAuthState(state)) {
      session.status = "failed"
      session.finishedAt = new Date().toISOString()
      session.error = "No cookies or localStorage found. Did you complete login?"
      return await getSiteAuthStatus(domain)
    }

    // Save to disk
    mkdirSync(SITE_AUTH_DIR, { recursive: true })
    await writeFile(siteAuthPath(domain), JSON.stringify(state, null, 2), "utf8")

    session.status = "completed"
    session.finishedAt = new Date().toISOString()
  } catch (error) {
    session.status = "failed"
    session.finishedAt = new Date().toISOString()
    session.error = error instanceof Error ? error.message : String(error)
  } finally {
    await closeSession(session)
  }

  return await getSiteAuthStatus(domain)
}

export async function cancelSiteAuthCapture(domain: string): Promise<SiteAuthStatus> {
  const slug = domainSlug(domain)
  const session = activeSessions.get(slug)
  if (!session || (session.status !== "awaiting-user" && session.status !== "saving")) {
    return await getSiteAuthStatus(domain)
  }

  session.status = "failed"
  session.finishedAt = new Date().toISOString()
  session.error = "Capture cancelled."
  await closeSession(session)

  return await getSiteAuthStatus(domain)
}

/**
 * Load saved site auth state for a domain. Returns null if none exists.
 */
export async function loadSiteAuth(domain: string): Promise<SiteAuthState | null> {
  const filePath = siteAuthPath(domain)
  if (!existsSync(filePath)) return null
  const raw = await readFile(filePath, "utf8")
  return JSON.parse(raw) as SiteAuthState
}

/**
 * Build the JS script to replay cookies/localStorage into a page.
 */
export function buildSiteAuthReplayScript(state: SiteAuthState): string {
  return `
(async () => {
  const state = ${JSON.stringify(state)};
  const setStorage = (storage, data) => {
    for (const [key, value] of Object.entries(data || {})) {
      try { storage.setItem(key, String(value)); } catch {}
    }
  };
  setStorage(localStorage, state.localStorage);
  setStorage(sessionStorage, state.sessionStorage);
  return { ok: true, localStorageKeys: Object.keys(state.localStorage).length };
})()
`
}
