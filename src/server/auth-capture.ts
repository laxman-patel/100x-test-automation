import { existsSync, mkdirSync, readdirSync } from "node:fs"
import { readFile, stat, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { runCommand } from "@/src/lib/shell"

const DEFAULT_EXTENSION_ID = process.env.EXTENSION_ID?.trim() || "kipkglfnhnpbogckhlmikjlfpbngnioc"
const DEFAULT_CDP_PORT = Number(process.env.CDP_PORT ?? process.env.RUNNER_CDP_PORT ?? 9223)

interface IndexedDbStoreMeta {
  name: string
  keyPath: unknown
  autoIncrement: boolean
  indexNames: string[]
  count: number | null
  error?: string
}

interface IndexedDbMeta {
  name: string
  version: number | null
  stores: IndexedDbStoreMeta[]
  error?: string
}

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

interface CapturedAuthState {
  capturedAt: string
  url: string
  title: string
  localStorage: Record<string, string>
  sessionStorage: Record<string, string>
  chromeStorageLocal: Record<string, unknown>
  chromeStorageSync: Record<string, unknown>
  cookies: BrowserCookie[]
  indexedDb: IndexedDbMeta[]
}

interface AuthCandidate {
  source: string
  key: string
  value: string
  maskedValue: string
  isJwt: boolean
  jwtExpIso: string | null
}

export interface AuthCaptureStatus {
  status: "idle" | "awaiting-user" | "saving" | "completed" | "failed"
  startedAt?: string
  finishedAt?: string
  error?: string
  extensionUrl: string
  artifacts: {
    beforePath: string
    afterPath: string
    replayPath: string
    diffPath: string
    candidatesPath: string
  }
  savedAuthState?: {
    exists: boolean
    capturedAt?: string
    updatedAt?: string
    hasReplayableToken?: boolean
  }
}

interface ActiveAuthCaptureSession {
  status: "awaiting-user" | "saving" | "completed" | "failed"
  startedAt: string
  finishedAt?: string
  error?: string
  cdpPort: number
  chromePid: number | null
  extensionUrl: string
  base: string[]
  beforeState?: CapturedAuthState
  artifacts: AuthCaptureStatus["artifacts"]
}

let currentSession: ActiveAuthCaptureSession | null = null

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
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
  for (const candidate of fallback) {
    if (existsSync(candidate)) return candidate
  }

  throw new Error("Could not find Chromium binary. Set CHROME_PATH to continue.")
}

function getExtensionUrl(extensionId: string): string {
  return `chrome-extension://${extensionId}/src/pages/agent/index.html`
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

async function waitForCdpReady(port: number, timeoutMs = 30_000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const probe = await runCommand(["agent-browser", "--cdp", String(port), "get", "url"], 3_000)
    if (probe.exitCode === 0) return
    await sleep(300)
  }

  throw new Error(`Timed out waiting for CDP on port ${port}`)
}

async function runAgentCommand(base: string[], args: string[], timeoutMs = 120_000): Promise<string> {
  const res = await runCommand([...base, ...args], timeoutMs)
  if (res.exitCode !== 0) {
    throw new Error(res.stderr.trim() || res.stdout.trim() || `Command failed: ${args.join(" ")}`)
  }
  return res.stdout.trim()
}

async function runAgentJson<T>(base: string[], args: string[], timeoutMs = 120_000): Promise<T> {
  const raw = await runAgentCommand(base, ["--json", ...args], timeoutMs)
  return JSON.parse(raw) as T
}

function parseJsonOutput<T>(raw: string): T {
  const trimmed = raw.trim()
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  const candidate = start >= 0 && end >= start ? trimmed.slice(start, end + 1) : trimmed
  return JSON.parse(candidate) as T
}

function getCaptureStorageScript(): string {
  return `
(async () => {
  const readStorage = (storage) => {
    const out = {};
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key == null) continue;
      out[key] = storage.getItem(key);
    }
    return out;
  };

  const readChromeStorage = async (area) => {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage[area]) return {};
      return await new Promise((resolve) => {
        chrome.storage[area].get(null, (items) => {
          resolve(items || {});
        });
      });
    } catch {
      return {};
    }
  };

  const indexedDbMeta = [];
  try {
    const dbs = indexedDB.databases ? await indexedDB.databases() : [];
    for (const info of dbs) {
      const dbName = info.name;
      if (!dbName) continue;

      const dbDump = await new Promise((resolve) => {
        const req = indexedDB.open(dbName);
        req.onerror = () => resolve({
          name: dbName,
          version: info.version ?? null,
          stores: [],
          error: String(req.error || 'open failed')
        });
        req.onsuccess = () => {
          const db = req.result;
          const stores = [];
          const names = Array.from(db.objectStoreNames || []);
          if (names.length === 0) {
            db.close();
            resolve({ name: dbName, version: db.version ?? null, stores });
            return;
          }

          try {
            const tx = db.transaction(names, 'readonly');
            let pending = names.length;
            const done = () => {
              pending -= 1;
              if (pending <= 0) {
                db.close();
                resolve({ name: dbName, version: db.version ?? null, stores });
              }
            };

            for (const storeName of names) {
              const store = tx.objectStore(storeName);
              const countReq = store.count();
              countReq.onsuccess = () => {
                stores.push({
                  name: storeName,
                  keyPath: store.keyPath ?? null,
                  autoIncrement: Boolean(store.autoIncrement),
                  indexNames: Array.from(store.indexNames || []),
                  count: Number(countReq.result || 0)
                });
                done();
              };
              countReq.onerror = () => {
                stores.push({
                  name: storeName,
                  keyPath: store.keyPath ?? null,
                  autoIncrement: Boolean(store.autoIncrement),
                  indexNames: Array.from(store.indexNames || []),
                  count: null,
                  error: String(countReq.error || 'count failed')
                });
                done();
              };
            }
          } catch (error) {
            db.close();
            resolve({
              name: dbName,
              version: db.version ?? null,
              stores: [],
              error: String(error)
            });
          }
        };
      });

      indexedDbMeta.push(dbDump);
    }
  } catch {
    // ignore indexeddb introspection failures
  }

  return {
    capturedAt: new Date().toISOString(),
    url: location.href,
    title: document.title,
    localStorage: readStorage(localStorage),
    sessionStorage: readStorage(sessionStorage),
    chromeStorageLocal: await readChromeStorage('local'),
    chromeStorageSync: await readChromeStorage('sync'),
    indexedDb: indexedDbMeta
  };
})()
`
}

function stringifyStable(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function diffMap(before: Record<string, unknown>, after: Record<string, unknown>) {
  const beforeKeys = new Set(Object.keys(before))
  const afterKeys = new Set(Object.keys(after))

  const added = [...afterKeys].filter((key) => !beforeKeys.has(key)).sort()
  const removed = [...beforeKeys].filter((key) => !afterKeys.has(key)).sort()
  const changed = [...afterKeys]
    .filter((key) => beforeKeys.has(key) && stringifyStable(before[key]) !== stringifyStable(after[key]))
    .sort()

  return { added, removed, changed }
}

function cookieIdentity(cookie: BrowserCookie): string {
  return `${cookie.name}|${cookie.domain ?? ""}|${cookie.path ?? ""}`
}

function diffCookies(before: BrowserCookie[], after: BrowserCookie[]) {
  const beforeMap = new Map(before.map((cookie) => [cookieIdentity(cookie), cookie]))
  const afterMap = new Map(after.map((cookie) => [cookieIdentity(cookie), cookie]))

  const added = [...afterMap.keys()].filter((key) => !beforeMap.has(key)).sort()
  const removed = [...beforeMap.keys()].filter((key) => !afterMap.has(key)).sort()
  const changed = [...afterMap.keys()]
    .filter((key) => beforeMap.has(key) && stringifyStable(beforeMap.get(key)) !== stringifyStable(afterMap.get(key)))
    .sort()

  return { added, removed, changed }
}

function looksLikeJwt(value: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
}

function decodeJwtExpIso(value: string): string | null {
  if (!looksLikeJwt(value)) return null
  try {
    const payload = value.split(".")[1] ?? ""
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/")
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4)
    const raw = Buffer.from(padded, "base64").toString("utf8")
    const parsed = JSON.parse(raw) as { exp?: number }
    return typeof parsed.exp === "number" ? new Date(parsed.exp * 1000).toISOString() : null
  } catch {
    return null
  }
}

function maskSecret(value: string): string {
  if (value.length <= 12) return value
  return `${value.slice(0, 6)}...${value.slice(-6)}`
}

function isLikelyAuthKey(key: string): boolean {
  return /(token|auth|session|jwt|bearer|refresh|access|sid|id_token|csrf|cookie)/i.test(key)
}

function isLikelyAuthValue(value: string): boolean {
  if (!value) return false
  if (looksLikeJwt(value)) return true
  if (/^bearer\s+[A-Za-z0-9._-]+$/i.test(value)) return true
  return value.length >= 48 && /[A-Za-z]/.test(value) && /[0-9]/.test(value)
}

function collectAuthCandidates(state: CapturedAuthState): AuthCandidate[] {
  const candidates: AuthCandidate[] = []

  const walk = (source: string, prefix: string, raw: unknown, depth = 0) => {
    if (depth > 6 || raw == null) return

    if (typeof raw === "string") {
      const keyHint = prefix.split(".").pop() ?? prefix
      if (!isLikelyAuthKey(keyHint) && !isLikelyAuthValue(raw)) return
      candidates.push({
        source,
        key: prefix,
        value: raw,
        maskedValue: maskSecret(raw),
        isJwt: looksLikeJwt(raw),
        jwtExpIso: decodeJwtExpIso(raw),
      })
      return
    }

    if (typeof raw === "number" || typeof raw === "boolean") {
      const asString = String(raw)
      const keyHint = prefix.split(".").pop() ?? prefix
      if (!isLikelyAuthKey(keyHint) && !isLikelyAuthValue(asString)) return
      candidates.push({
        source,
        key: prefix,
        value: asString,
        maskedValue: maskSecret(asString),
        isJwt: false,
        jwtExpIso: null,
      })
      return
    }

    if (Array.isArray(raw)) {
      raw.forEach((item, idx) => walk(source, `${prefix}[${idx}]`, item, depth + 1))
      return
    }

    if (typeof raw === "object") {
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        walk(source, prefix ? `${prefix}.${key}` : key, value, depth + 1)
      }
    }
  }

  for (const [key, raw] of Object.entries(state.localStorage)) walk("localStorage", key, raw)
  for (const [key, raw] of Object.entries(state.sessionStorage)) walk("sessionStorage", key, raw)
  for (const [key, raw] of Object.entries(state.chromeStorageLocal)) walk("chromeStorageLocal", key, raw)
  for (const [key, raw] of Object.entries(state.chromeStorageSync)) walk("chromeStorageSync", key, raw)

  for (const cookie of state.cookies) {
    if (!isLikelyAuthKey(cookie.name) && !isLikelyAuthValue(cookie.value)) continue
    candidates.push({
      source: `cookie:${cookie.domain ?? "unknown"}`,
      key: cookie.name,
      value: cookie.value,
      maskedValue: maskSecret(cookie.value),
      isJwt: looksLikeJwt(cookie.value),
      jwtExpIso: decodeJwtExpIso(cookie.value),
    })
  }

  return candidates
}

function hasReplayableAuthToken(state: CapturedAuthState): boolean {
  const daptin = state.chromeStorageSync?.DAPTIN
  return Boolean(
    daptin
      && typeof daptin === "object"
      && typeof (daptin as { token?: unknown }).token === "string"
      && ((daptin as { token: string }).token.length > 40),
  )
}

async function captureState(base: string[]): Promise<CapturedAuthState> {
  const evalRaw = await runAgentCommand(base, ["eval", getCaptureStorageScript()], 120_000)
  const evalState = parseJsonOutput<Omit<CapturedAuthState, "cookies">>(evalRaw)
  const cookiesRes = await runAgentJson<{ success: boolean; data?: { cookies?: BrowserCookie[] } }>(
    base,
    ["cookies", "get"],
    60_000,
  )

  return {
    ...evalState,
    cookies: cookiesRes.data?.cookies ?? [],
  }
}

async function closeSessionBrowser(session: ActiveAuthCaptureSession): Promise<void> {
  try {
    await runAgentCommand(session.base, ["close"], 15_000)
  } catch {
    // ignore close errors
  }

  if (session.chromePid) {
    try {
      await runCommand(["kill", "-TERM", String(session.chromePid)], 10_000)
    } catch {
      // ignore kill failures
    }
  }
}

function buildArtifacts() {
  return {
    beforePath: resolve(process.cwd(), "artifacts/auth-state-before.json"),
    afterPath: resolve(process.cwd(), "artifacts/auth-state-after.json"),
    replayPath: resolve(process.cwd(), "artifacts/extension-auth-state.json"),
    diffPath: resolve(process.cwd(), "artifacts/extension-auth-state.diff.json"),
    candidatesPath: resolve(process.cwd(), "artifacts/extension-auth-candidates.json"),
  }
}

async function readSavedAuthSummary() {
  const replayPath = buildArtifacts().replayPath
  if (!existsSync(replayPath)) {
    return { exists: false as const }
  }

  const [raw, info] = await Promise.all([readFile(replayPath, "utf8"), stat(replayPath)])
  const parsed = JSON.parse(raw) as CapturedAuthState

  return {
    exists: true as const,
    capturedAt: parsed.capturedAt,
    updatedAt: info.mtime.toISOString(),
    hasReplayableToken: hasReplayableAuthToken(parsed),
  }
}

export function isAuthCaptureActive(): boolean {
  return currentSession?.status === "awaiting-user" || currentSession?.status === "saving"
}

export async function assertNoActiveAuthCapture(): Promise<void> {
  if (isAuthCaptureActive()) {
    throw new Error("Finish or cancel the active authentication capture before running workflows.")
  }
}

export async function getAuthCaptureStatus(): Promise<AuthCaptureStatus> {
  const savedAuthState = await readSavedAuthSummary()
  if (!currentSession) {
    return {
      status: "idle",
      extensionUrl: getExtensionUrl(DEFAULT_EXTENSION_ID),
      artifacts: buildArtifacts(),
      savedAuthState,
    }
  }

  return {
    status: currentSession.status,
    startedAt: currentSession.startedAt,
    finishedAt: currentSession.finishedAt,
    error: currentSession.error,
    extensionUrl: currentSession.extensionUrl,
    artifacts: currentSession.artifacts,
    savedAuthState,
  }
}

export async function startAuthCapture(): Promise<AuthCaptureStatus> {
  if (isAuthCaptureActive()) {
    throw new Error("An authentication capture is already in progress.")
  }

  const extensionUrl = getExtensionUrl(DEFAULT_EXTENSION_ID)
  const cdpPort = DEFAULT_CDP_PORT
  const extensionPath = resolve(process.cwd(), "100x-extension-build")
  const chromePath = resolveChromePath()
  const profilePath = resolve(process.cwd(), `artifacts/auth-capture-profile-${Date.now()}`)
  const logPath = resolve(process.cwd(), "artifacts/auth-capture.log")
  const artifacts = buildArtifacts()
  const base = ["agent-browser", "--cdp", String(cdpPort)]

  try {
    await runCommand(["pkill", "-f", `remote-debugging-port=${cdpPort}`], 10_000)
  } catch {
    // ignore if no process matched
  }

  const chromePid = await launchChromiumWithExtension({
    chromePath,
    extensionPath,
    cdpPort,
    profilePath,
    logPath,
  })

  try {
    await waitForCdpReady(cdpPort)
    await runAgentCommand(base, ["tab", "new", extensionUrl], 30_000)
    await runAgentCommand(base, ["wait", "2000"], 30_000)
    const beforeState = await captureState(base)
    await writeFile(artifacts.beforePath, JSON.stringify(beforeState, null, 2), "utf8")

    currentSession = {
      status: "awaiting-user",
      startedAt: new Date().toISOString(),
      cdpPort,
      chromePid,
      extensionUrl,
      base,
      beforeState,
      artifacts,
    }

    return await getAuthCaptureStatus()
  } catch (error) {
    const failedSession: ActiveAuthCaptureSession = {
      status: "failed",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      cdpPort,
      chromePid,
      extensionUrl,
      base,
      artifacts,
    }

    await closeSessionBrowser(failedSession)
    currentSession = failedSession
    return await getAuthCaptureStatus()
  }
}

export async function finishAuthCapture(): Promise<AuthCaptureStatus> {
  if (!currentSession || currentSession.status !== "awaiting-user") {
    throw new Error("No active authentication capture is waiting for manual login.")
  }

  currentSession.status = "saving"

  try {
    const afterState = await captureState(currentSession.base)
    await writeFile(currentSession.artifacts.afterPath, JSON.stringify(afterState, null, 2), "utf8")

    const hasAuthToken = hasReplayableAuthToken(afterState)
    if (hasAuthToken) {
      await writeFile(currentSession.artifacts.replayPath, JSON.stringify(afterState, null, 2), "utf8")
    }

    const candidates = collectAuthCandidates(afterState)
    await writeFile(currentSession.artifacts.candidatesPath, JSON.stringify(candidates, null, 2), "utf8")

    const diff = {
      capturedAt: new Date().toISOString(),
      extensionUrl: currentSession.extensionUrl,
      localStorage: diffMap(currentSession.beforeState?.localStorage ?? {}, afterState.localStorage),
      sessionStorage: diffMap(currentSession.beforeState?.sessionStorage ?? {}, afterState.sessionStorage),
      chromeStorageLocal: diffMap(currentSession.beforeState?.chromeStorageLocal ?? {}, afterState.chromeStorageLocal),
      chromeStorageSync: diffMap(currentSession.beforeState?.chromeStorageSync ?? {}, afterState.chromeStorageSync),
      cookies: diffCookies(currentSession.beforeState?.cookies ?? [], afterState.cookies),
      indexedDbBefore: currentSession.beforeState?.indexedDb ?? [],
      indexedDbAfter: afterState.indexedDb,
      hasReplayableToken: hasAuthToken,
      authCandidateCount: candidates.length,
    }
    await writeFile(currentSession.artifacts.diffPath, JSON.stringify(diff, null, 2), "utf8")

    currentSession.status = hasAuthToken ? "completed" : "failed"
    currentSession.finishedAt = new Date().toISOString()
    currentSession.error = hasAuthToken ? undefined : "No replayable token was found in chromeStorageSync.DAPTIN.token."
  } catch (error) {
    currentSession.status = "failed"
    currentSession.finishedAt = new Date().toISOString()
    currentSession.error = error instanceof Error ? error.message : String(error)
  } finally {
    await closeSessionBrowser(currentSession)
  }

  return await getAuthCaptureStatus()
}

export async function cancelAuthCapture(): Promise<AuthCaptureStatus> {
  if (!currentSession || (currentSession.status !== "awaiting-user" && currentSession.status !== "saving")) {
    return await getAuthCaptureStatus()
  }

  currentSession.status = "failed"
  currentSession.finishedAt = new Date().toISOString()
  currentSession.error = "Authentication capture was cancelled."
  await closeSessionBrowser(currentSession)

  return await getAuthCaptureStatus()
}
