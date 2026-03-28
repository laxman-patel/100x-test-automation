import { existsSync, mkdirSync, readdirSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { createInterface } from "node:readline"
import { stdin as input, stdout as output } from "node:process"
import { runCommand } from "../lib/shell"

const DEFAULT_EXTENSION_ID = "kipkglfnhnpbogckhlmikjlfpbngnioc"
const DEFAULT_CDP_PORT = 9223

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

interface AuthCandidate {
  source: string
  key: string
  value: string
  maskedValue: string
  isJwt: boolean
  jwtExpIso: string | null
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

function hasReplayableAuthToken(state: CapturedAuthState): boolean {
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
    if (typeof parsed.exp === "number") {
      return new Date(parsed.exp * 1000).toISOString()
    }
    return null
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
  if (value.length >= 48 && /[A-Za-z]/.test(value) && /[0-9]/.test(value)) return true
  return false
}

function collectAuthCandidates(state: CapturedAuthState): AuthCandidate[] {
  const candidates: AuthCandidate[] = []

  const walk = (source: string, prefix: string, raw: unknown, depth = 0) => {
    if (depth > 6 || raw == null) return

    if (typeof raw === "string") {
      const keyHint = prefix.split(".").pop() ?? prefix
      if (!isLikelyAuthKey(keyHint) && !isLikelyAuthValue(raw)) return
      const jwtExpIso = decodeJwtExpIso(raw)
      candidates.push({
        source,
        key: prefix,
        value: raw,
        maskedValue: maskSecret(raw),
        isJwt: looksLikeJwt(raw),
        jwtExpIso,
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
        const nextPrefix = prefix ? `${prefix}.${key}` : key
        walk(source, nextPrefix, value, depth + 1)
      }
    }
  }

  const collectMap = (source: string, data: Record<string, unknown>) => {
    for (const [key, raw] of Object.entries(data)) {
      walk(source, key, raw)
    }
  }

  collectMap("localStorage", state.localStorage)
  collectMap("sessionStorage", state.sessionStorage)
  collectMap("chromeStorageLocal", state.chromeStorageLocal)
  collectMap("chromeStorageSync", state.chromeStorageSync)

  for (const cookie of state.cookies) {
    if (!isLikelyAuthKey(cookie.name) && !isLikelyAuthValue(cookie.value)) continue
    const jwtExpIso = decodeJwtExpIso(cookie.value)
    candidates.push({
      source: `cookie:${cookie.domain ?? "unknown"}`,
      key: cookie.name,
      value: cookie.value,
      maskedValue: maskSecret(cookie.value),
      isJwt: looksLikeJwt(cookie.value),
      jwtExpIso,
    })
  }

  return candidates
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

function parseJsonOutput<T>(raw: string): T {
  const trimmed = raw.trim()
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  const candidate = start >= 0 && end >= start ? trimmed.slice(start, end + 1) : trimmed
  return JSON.parse(candidate) as T
}

function stringifyStable(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function diffMap(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { added: string[]; removed: string[]; changed: string[] } {
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

function diffCookies(
  before: BrowserCookie[],
  after: BrowserCookie[],
): { added: string[]; removed: string[]; changed: string[] } {
  const beforeMap = new Map(before.map((cookie) => [cookieIdentity(cookie), cookie]))
  const afterMap = new Map(after.map((cookie) => [cookieIdentity(cookie), cookie]))

  const added = [...afterMap.keys()].filter((key) => !beforeMap.has(key)).sort()
  const removed = [...beforeMap.keys()].filter((key) => !afterMap.has(key)).sort()
  const changed = [...afterMap.keys()]
    .filter((key) => beforeMap.has(key) && stringifyStable(beforeMap.get(key)) !== stringifyStable(afterMap.get(key)))
    .sort()

  return { added, removed, changed }
}

async function main() {
  const extensionId = process.env.EXTENSION_ID?.trim() || DEFAULT_EXTENSION_ID
  const extensionUrl = getExtensionUrl(extensionId)
  const cdpPort = Number(process.env.CDP_PORT ?? DEFAULT_CDP_PORT)

  const extensionPath = resolve(process.cwd(), "100x-extension-build")
  const chromePath = resolveChromePath()
  const profilePath = resolve(process.cwd(), `artifacts/auth-capture-profile-${Date.now()}`)
  const logPath = resolve(process.cwd(), "artifacts/auth-capture.log")

  const beforePath = resolve(process.cwd(), "artifacts/auth-state-before.json")
  const afterPath = resolve(process.cwd(), "artifacts/auth-state-after.json")
  const replayPath = resolve(process.cwd(), "artifacts/extension-auth-state.json")
  const diffPath = resolve(process.cwd(), "artifacts/extension-auth-state.diff.json")
  const candidatesPath = resolve(process.cwd(), "artifacts/extension-auth-candidates.json")

  const base = ["agent-browser", "--cdp", String(cdpPort)]
  let chromePid: number | null = null

  try {
    await runCommand(["pkill", "-f", `remote-debugging-port=${cdpPort}`], 10_000)
  } catch {
    // ignore if no process matched
  }

  console.log("Launching Chromium for auth capture...")
  console.log(`Extension URL: ${extensionUrl}`)
  console.log(`CDP port: ${cdpPort}`)

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
    await runAgentCommand(base, ["wait", "2000"])

    console.log("Capturing BEFORE state...")
    const beforeRaw = await runAgentCommand(base, ["eval", getCaptureStorageScript()], 120_000)
    const beforeEvalState = parseJsonOutput<Omit<CapturedAuthState, "cookies">>(beforeRaw)
    const beforeCookiesRes = await runAgentJson<{ success: boolean; data?: { cookies?: BrowserCookie[] } }>(
      base,
      ["cookies", "get"],
      60_000,
    )
    const beforeState: CapturedAuthState = {
      ...beforeEvalState,
      cookies: beforeCookiesRes.data?.cookies ?? [],
    }
    await writeFile(beforePath, JSON.stringify(beforeState, null, 2), "utf8")

    if (process.env.AUTO_CONTINUE === "1") {
      console.log("AUTO_CONTINUE=1 set, skipping manual pause.")
      await runAgentCommand(base, ["wait", "1000"])
    } else {
      const rl = createInterface({ input, output })
      await new Promise<void>((resolveQuestion) => {
        rl.question(
          "Log in manually in the opened Chromium window, then press Enter here to capture AFTER state...",
          () => resolveQuestion(),
        )
      })
      rl.close()
    }

    console.log("Capturing AFTER state...")
    const afterRaw = await runAgentCommand(base, ["eval", getCaptureStorageScript()], 120_000)
    const afterEvalState = parseJsonOutput<Omit<CapturedAuthState, "cookies">>(afterRaw)
    const afterCookiesRes = await runAgentJson<{ success: boolean; data?: { cookies?: BrowserCookie[] } }>(
      base,
      ["cookies", "get"],
      60_000,
    )
    const afterState: CapturedAuthState = {
      ...afterEvalState,
      cookies: afterCookiesRes.data?.cookies ?? [],
    }

    await writeFile(afterPath, JSON.stringify(afterState, null, 2), "utf8")

    const hasAuthToken = hasReplayableAuthToken(afterState)
    const forceReplayWrite = process.env.FORCE_REPLAY_WRITE === "1"

    if (hasAuthToken || forceReplayWrite) {
      if (existsSync(replayPath)) {
        const backupPath = resolve(
          process.cwd(),
          `artifacts/extension-auth-state.backup-${Date.now()}.json`,
        )
        const currentReplay = await readFile(replayPath, "utf8")
        await writeFile(backupPath, currentReplay, "utf8")
        console.log(`Backed up previous replay file -> ${backupPath}`)
      }

      await writeFile(replayPath, JSON.stringify(afterState, null, 2), "utf8")
    } else {
      console.log("Warning: no replayable auth token found (chromeStorageSync.DAPTIN.token missing).")
      console.log("Replay file was NOT overwritten to avoid losing a good auth state.")
      console.log("If you want to force overwrite, run with FORCE_REPLAY_WRITE=1.")
    }

    const candidates = collectAuthCandidates(afterState)
    await writeFile(candidatesPath, JSON.stringify(candidates, null, 2), "utf8")

    const diff = {
      capturedAt: new Date().toISOString(),
      extensionUrl,
      localStorage: diffMap(beforeState.localStorage, afterState.localStorage),
      sessionStorage: diffMap(beforeState.sessionStorage, afterState.sessionStorage),
      chromeStorageLocal: diffMap(beforeState.chromeStorageLocal, afterState.chromeStorageLocal),
      chromeStorageSync: diffMap(beforeState.chromeStorageSync, afterState.chromeStorageSync),
      cookies: diffCookies(beforeState.cookies, afterState.cookies),
      indexedDbBefore: beforeState.indexedDb,
      indexedDbAfter: afterState.indexedDb,
    }

    await writeFile(diffPath, JSON.stringify(diff, null, 2), "utf8")

    console.log("Auth state capture complete.")
    console.log(`- BEFORE: ${beforePath}`)
    console.log(`- AFTER:  ${afterPath}`)
    if (hasAuthToken || forceReplayWrite) {
      console.log(`- REPLAY: ${replayPath}`)
    } else {
      console.log(`- REPLAY: unchanged (${replayPath})`)
    }
    console.log(`- DIFF:   ${diffPath}`)
    console.log(`- CANDIDATES: ${candidatesPath}`)

    console.log("Changed keys summary:")
    console.log(`- localStorage changed: ${diff.localStorage.changed.length}, added: ${diff.localStorage.added.length}, removed: ${diff.localStorage.removed.length}`)
    console.log(`- sessionStorage changed: ${diff.sessionStorage.changed.length}, added: ${diff.sessionStorage.added.length}, removed: ${diff.sessionStorage.removed.length}`)
    console.log(`- chrome.storage.local changed: ${diff.chromeStorageLocal.changed.length}, added: ${diff.chromeStorageLocal.added.length}, removed: ${diff.chromeStorageLocal.removed.length}`)
    console.log(`- chrome.storage.sync changed: ${diff.chromeStorageSync.changed.length}, added: ${diff.chromeStorageSync.added.length}, removed: ${diff.chromeStorageSync.removed.length}`)
    console.log(`- cookies changed: ${diff.cookies.changed.length}, added: ${diff.cookies.added.length}, removed: ${diff.cookies.removed.length}`)

    if (candidates.length > 0) {
      console.log("Likely auth candidates:")
      for (const candidate of candidates.slice(0, 20)) {
        const exp = candidate.jwtExpIso ? ` exp=${candidate.jwtExpIso}` : ""
        console.log(`- [${candidate.source}] ${candidate.key}=${candidate.maskedValue}${exp}`)
      }
      if (candidates.length > 20) {
        console.log(`- ... ${candidates.length - 20} more (see ${candidatesPath})`)
      }
    } else {
      console.log("No obvious auth token candidates found. Check diff file for full key changes.")
    }
  } finally {
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

await main()
